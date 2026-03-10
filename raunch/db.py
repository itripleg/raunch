"""SQLite database for persistent world history."""

import json
import os
import sqlite3
import threading
from typing import Dict, Any, List, Optional

from .config import SAVES_DIR

DB_PATH = os.path.join(SAVES_DIR, "history.db")

_local = threading.local()


def _get_conn() -> sqlite3.Connection:
    """Get a thread-local database connection."""
    if not hasattr(_local, "conn") or _local.conn is None:
        _local.conn = sqlite3.connect(DB_PATH)
        _local.conn.row_factory = sqlite3.Row
        _local.conn.execute("PRAGMA journal_mode=WAL")
    return _local.conn


def init_db() -> None:
    """Create tables if they don't exist."""
    conn = _get_conn()
    conn.executescript("""
        CREATE TABLE IF NOT EXISTS ticks (
            id          INTEGER PRIMARY KEY AUTOINCREMENT,
            world_id    TEXT NOT NULL,
            tick        INTEGER NOT NULL,
            narration   TEXT,
            events      TEXT,
            world_time  TEXT,
            mood        TEXT,
            created_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS character_ticks (
            id              INTEGER PRIMARY KEY AUTOINCREMENT,
            world_id        TEXT NOT NULL,
            tick            INTEGER NOT NULL,
            character_name  TEXT NOT NULL,
            inner_thoughts  TEXT,
            action          TEXT,
            dialogue        TEXT,
            emotional_state TEXT,
            desires_update  TEXT,
            raw_json        TEXT,
            created_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );

        CREATE INDEX IF NOT EXISTS idx_ticks_world ON ticks(world_id, tick);
        CREATE INDEX IF NOT EXISTS idx_char_ticks_world ON character_ticks(world_id, tick);
        CREATE INDEX IF NOT EXISTS idx_char_ticks_name ON character_ticks(world_id, character_name, tick);
    """)
    conn.commit()


def save_tick(world_id: str, tick: int, narration: str, events: List[str],
              world_time: str, mood: str) -> None:
    """Record a narrator tick."""
    conn = _get_conn()
    conn.execute(
        "INSERT INTO ticks (world_id, tick, narration, events, world_time, mood) VALUES (?, ?, ?, ?, ?, ?)",
        (world_id, tick, narration, json.dumps(events), world_time, mood),
    )
    conn.commit()


def save_character_tick(world_id: str, tick: int, character_name: str,
                        data: Dict[str, Any]) -> None:
    """Record a character's tick output."""
    conn = _get_conn()
    conn.execute(
        """INSERT INTO character_ticks
           (world_id, tick, character_name, inner_thoughts, action, dialogue,
            emotional_state, desires_update, raw_json)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)""",
        (
            world_id, tick, character_name,
            data.get("inner_thoughts"),
            data.get("action"),
            data.get("dialogue"),
            data.get("emotional_state"),
            data.get("desires_update"),
            json.dumps(data),
        ),
    )
    conn.commit()


def get_tick_history(world_id: str, limit: int = 50, offset: int = 0) -> List[Dict[str, Any]]:
    """Get narration history for a world, including character data."""
    conn = _get_conn()
    rows = conn.execute(
        "SELECT tick, narration, events, world_time, mood, created_at FROM ticks "
        "WHERE world_id = ? ORDER BY tick DESC LIMIT ? OFFSET ?",
        (world_id, limit, offset),
    ).fetchall()

    results = []
    for r in reversed(rows):  # Return in chronological order
        tick_num = r["tick"]
        # Fetch character data for this tick
        char_rows = conn.execute(
            "SELECT character_name, inner_thoughts, action, dialogue, emotional_state, desires_update "
            "FROM character_ticks WHERE world_id = ? AND tick = ?",
            (world_id, tick_num),
        ).fetchall()

        characters = {}
        for cr in char_rows:
            characters[cr["character_name"]] = {
                "inner_thoughts": cr["inner_thoughts"],
                "action": cr["action"],
                "dialogue": cr["dialogue"],
                "emotional_state": cr["emotional_state"],
                "desires_update": cr["desires_update"],
            }

        results.append({
            "tick": tick_num,
            "narration": r["narration"],
            "events": json.loads(r["events"]) if r["events"] else [],
            "world_time": r["world_time"],
            "mood": r["mood"],
            "characters": characters,
            "created_at": r["created_at"],
        })
    return results


def get_character_history(world_id: str, character_name: str,
                          limit: int = 50, offset: int = 0) -> List[Dict[str, Any]]:
    """Get a character's thought/action history."""
    conn = _get_conn()
    rows = conn.execute(
        "SELECT tick, inner_thoughts, action, dialogue, emotional_state, desires_update, created_at "
        "FROM character_ticks WHERE world_id = ? AND character_name = ? "
        "ORDER BY tick DESC LIMIT ? OFFSET ?",
        (world_id, character_name, limit, offset),
    ).fetchall()
    return [
        {
            "tick": r["tick"],
            "inner_thoughts": r["inner_thoughts"],
            "action": r["action"],
            "dialogue": r["dialogue"],
            "emotional_state": r["emotional_state"],
            "desires_update": r["desires_update"],
            "created_at": r["created_at"],
        }
        for r in reversed(rows)
    ]


def get_full_tick(world_id: str, tick: int) -> Optional[Dict[str, Any]]:
    """Get everything that happened on a specific tick."""
    conn = _get_conn()
    row = conn.execute(
        "SELECT tick, narration, events, world_time, mood FROM ticks WHERE world_id = ? AND tick = ?",
        (world_id, tick),
    ).fetchone()
    if not row:
        return None

    char_rows = conn.execute(
        "SELECT character_name, inner_thoughts, action, dialogue, emotional_state, desires_update "
        "FROM character_ticks WHERE world_id = ? AND tick = ?",
        (world_id, tick),
    ).fetchall()

    return {
        "tick": row["tick"],
        "narration": row["narration"],
        "events": json.loads(row["events"]) if row["events"] else [],
        "world_time": row["world_time"],
        "mood": row["mood"],
        "characters": {
            r["character_name"]: {
                "inner_thoughts": r["inner_thoughts"],
                "action": r["action"],
                "dialogue": r["dialogue"],
                "emotional_state": r["emotional_state"],
                "desires_update": r["desires_update"],
            }
            for r in char_rows
        },
    }
