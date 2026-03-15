"""SQLite database for persistent world history."""

import json
import os
import re
import sqlite3
import threading
from typing import Dict, Any, List, Optional

from .config import SAVES_DIR


def _extract_character_fields(data: Dict[str, Any]) -> Dict[str, Any]:
    """Extract character fields from raw JSON if needed."""
    # If already parsed, return as-is
    if data.get("inner_thoughts") or data.get("action") or data.get("dialogue"):
        return data

    # Check for raw field
    raw = data.get("raw")
    if not raw or not isinstance(raw, str):
        return data

    extracted = dict(data)

    try:
        # Strip markdown code fences
        text = raw
        if "```json" in text:
            text = text.split("```json", 1)[1]
        if "```" in text:
            text = text.split("```", 1)[0]

        # Find and parse JSON
        first = text.find("{")
        last = text.rfind("}")
        if first != -1 and last != -1:
            parsed = json.loads(text[first:last + 1])
            extracted.update(parsed)
    except (json.JSONDecodeError, IndexError, ValueError):
        # Regex fallback
        def extract_field(field: str) -> Optional[str]:
            match = re.search(rf'"{field}"\s*:\s*"((?:[^"\\]|\\.)*)"', raw, re.DOTALL)
            if match:
                return match.group(1).replace("\\n", "\n").replace('\\"', '"')
            return None

        for field in ["inner_thoughts", "action", "dialogue", "emotional_state", "desires_update"]:
            val = extract_field(field)
            if val:
                extracted[field] = val

    return extracted

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
        CREATE TABLE IF NOT EXISTS pages (
            id          INTEGER PRIMARY KEY AUTOINCREMENT,
            world_id    TEXT NOT NULL,
            page_num    INTEGER NOT NULL,
            narration   TEXT,
            events      TEXT,
            world_time  TEXT,
            mood        TEXT,
            created_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS character_pages (
            id              INTEGER PRIMARY KEY AUTOINCREMENT,
            world_id        TEXT NOT NULL,
            page_num        INTEGER NOT NULL,
            character_name  TEXT NOT NULL,
            inner_thoughts  TEXT,
            action          TEXT,
            dialogue        TEXT,
            emotional_state TEXT,
            desires_update  TEXT,
            raw_json        TEXT,
            created_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );

        CREATE INDEX IF NOT EXISTS idx_pages_world ON pages(world_id, page_num);
        CREATE INDEX IF NOT EXISTS idx_char_pages_world ON character_pages(world_id, page_num);
        CREATE INDEX IF NOT EXISTS idx_char_pages_name ON character_pages(world_id, character_name, page_num);
    """)
    conn.commit()


def save_page(world_id: str, page_num: int, narration: str, events: List[str],
              world_time: str, mood: str) -> None:
    """Record a narrator page."""
    conn = _get_conn()
    conn.execute(
        "INSERT INTO pages (world_id, page_num, narration, events, world_time, mood) VALUES (?, ?, ?, ?, ?, ?)",
        (world_id, page_num, narration, json.dumps(events), world_time, mood),
    )
    conn.commit()


def save_character_page(world_id: str, page_num: int, character_name: str,
                        data: Dict[str, Any]) -> None:
    """Record a character's page output."""
    # Extract fields from raw JSON if needed
    extracted = _extract_character_fields(data)

    conn = _get_conn()
    conn.execute(
        """INSERT INTO character_pages
           (world_id, page_num, character_name, inner_thoughts, action, dialogue,
            emotional_state, desires_update, raw_json)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)""",
        (
            world_id, page_num, character_name,
            extracted.get("inner_thoughts"),
            extracted.get("action"),
            extracted.get("dialogue"),
            extracted.get("emotional_state"),
            extracted.get("desires_update"),
            json.dumps(data),  # Still save original for debugging
        ),
    )
    conn.commit()


def get_page_history(world_id: str, limit: int = 50, offset: int = 0) -> List[Dict[str, Any]]:
    """Get narration history for a world, including character data."""
    conn = _get_conn()
    rows = conn.execute(
        "SELECT page_num, narration, events, world_time, mood, created_at FROM pages "
        "WHERE world_id = ? ORDER BY page_num DESC LIMIT ? OFFSET ?",
        (world_id, limit, offset),
    ).fetchall()

    results = []
    for r in reversed(rows):  # Return in chronological order
        page_number = r["page_num"]
        # Fetch character data for this page
        char_rows = conn.execute(
            "SELECT character_name, inner_thoughts, action, dialogue, emotional_state, desires_update "
            "FROM character_pages WHERE world_id = ? AND page_num = ?",
            (world_id, page_number),
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
            "page_num": page_number,
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
        "SELECT page_num, inner_thoughts, action, dialogue, emotional_state, desires_update, created_at "
        "FROM character_pages WHERE world_id = ? AND character_name = ? "
        "ORDER BY page_num DESC LIMIT ? OFFSET ?",
        (world_id, character_name, limit, offset),
    ).fetchall()
    return [
        {
            "page_num": r["page_num"],
            "inner_thoughts": r["inner_thoughts"],
            "action": r["action"],
            "dialogue": r["dialogue"],
            "emotional_state": r["emotional_state"],
            "desires_update": r["desires_update"],
            "created_at": r["created_at"],
        }
        for r in reversed(rows)
    ]


def get_debug_data(world_id: str, limit: int = 20, offset: int = 0,
                   include_raw: bool = True) -> Dict[str, Any]:
    """Get raw database data for debugging.

    Returns page and character_page data with full raw_json,
    identifies refusals, parsing failures, etc.
    """
    conn = _get_conn()

    # Get page data
    page_rows = conn.execute(
        "SELECT id, page_num, narration, events, world_time, mood, created_at "
        "FROM pages WHERE world_id = ? ORDER BY page_num DESC LIMIT ? OFFSET ?",
        (world_id, limit, offset),
    ).fetchall()

    pages = []
    for r in page_rows:
        pages.append({
            "id": r["id"],
            "page_num": r["page_num"],
            "narration": r["narration"],
            "events": json.loads(r["events"]) if r["events"] else [],
            "world_time": r["world_time"],
            "mood": r["mood"],
            "created_at": r["created_at"],
        })

    # Get character page data with raw_json
    char_rows = conn.execute(
        "SELECT id, page_num, character_name, inner_thoughts, action, dialogue, "
        "emotional_state, desires_update, raw_json, created_at "
        "FROM character_pages WHERE world_id = ? ORDER BY page_num DESC, id DESC LIMIT ? OFFSET ?",
        (world_id, limit * 3, offset),  # More char pages since multiple per page
    ).fetchall()

    character_pages = []
    for r in char_rows:
        raw_json = r["raw_json"]
        raw_parsed = None
        is_refusal = False
        parse_error = None

        if raw_json:
            try:
                raw_parsed = json.loads(raw_json)
                # Check if it's a refusal (raw field contains refusal text)
                raw_content = raw_parsed.get("raw", "")
                if isinstance(raw_content, str):
                    refusal_phrases = [
                        "I can't roleplay",
                        "I'm not able to engage",
                        "I appreciate your interest",
                        "I cannot continue",
                        "explicit sexual",
                    ]
                    is_refusal = any(phrase.lower() in raw_content.lower() for phrase in refusal_phrases)
            except json.JSONDecodeError as e:
                parse_error = str(e)

        entry = {
            "id": r["id"],
            "page_num": r["page_num"],
            "character_name": r["character_name"],
            "inner_thoughts": r["inner_thoughts"],
            "action": r["action"],
            "dialogue": r["dialogue"],
            "emotional_state": r["emotional_state"],
            "desires_update": r["desires_update"],
            "created_at": r["created_at"],
            "is_refusal": is_refusal,
            "parse_error": parse_error,
            "has_extracted_data": bool(r["inner_thoughts"] or r["action"] or r["dialogue"]),
        }
        if include_raw:
            entry["raw_json"] = raw_parsed
        character_pages.append(entry)

    # Get summary stats
    stats = {
        "total_pages": conn.execute(
            "SELECT COUNT(*) FROM pages WHERE world_id = ?", (world_id,)
        ).fetchone()[0],
        "total_character_pages": conn.execute(
            "SELECT COUNT(*) FROM character_pages WHERE world_id = ?", (world_id,)
        ).fetchone()[0],
        "refusals": conn.execute(
            "SELECT COUNT(*) FROM character_pages WHERE world_id = ? AND inner_thoughts IS NULL AND raw_json IS NOT NULL",
            (world_id,)
        ).fetchone()[0],
        "successfully_parsed": conn.execute(
            "SELECT COUNT(*) FROM character_pages WHERE world_id = ? AND inner_thoughts IS NOT NULL",
            (world_id,)
        ).fetchone()[0],
    }

    return {
        "world_id": world_id,
        "pages": pages,
        "character_pages": character_pages,
        "stats": stats,
    }


def get_full_page(world_id: str, page_num: int) -> Optional[Dict[str, Any]]:
    """Get everything that happened on a specific page."""
    conn = _get_conn()
    row = conn.execute(
        "SELECT page_num, narration, events, world_time, mood FROM pages WHERE world_id = ? AND page_num = ?",
        (world_id, page_num),
    ).fetchone()
    if not row:
        return None

    char_rows = conn.execute(
        "SELECT character_name, inner_thoughts, action, dialogue, emotional_state, desires_update "
        "FROM character_pages WHERE world_id = ? AND page_num = ?",
        (world_id, page_num),
    ).fetchall()

    return {
        "page_num": row["page_num"],
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
