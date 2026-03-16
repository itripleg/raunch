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

        CREATE TABLE IF NOT EXISTS potential_characters (
            id              INTEGER PRIMARY KEY AUTOINCREMENT,
            world_id        TEXT NOT NULL,
            name            TEXT NOT NULL,
            description     TEXT,
            first_page      INTEGER NOT NULL,
            times_mentioned INTEGER DEFAULT 1,
            promoted        INTEGER DEFAULT 0,
            promoted_at     TIMESTAMP,
            created_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            UNIQUE(world_id, name)
        );
        CREATE INDEX IF NOT EXISTS idx_potential_chars_world ON potential_characters(world_id, promoted);

        -- Alpha dashboard tables
        CREATE TABLE IF NOT EXISTS alpha_messages (
            id          INTEGER PRIMARY KEY AUTOINCREMENT,
            content     TEXT,
            updated_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS alpha_content (
            id          INTEGER PRIMARY KEY AUTOINCREMENT,
            slug        TEXT UNIQUE NOT NULL,
            content     TEXT,
            updated_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS feedback_items (
            id              INTEGER PRIMARY KEY AUTOINCREMENT,
            title           TEXT NOT NULL,
            notes           TEXT,
            status          TEXT CHECK(status IN ('planned','considering','requests','results')) DEFAULT 'requests',
            outcome         TEXT CHECK(outcome IN ('shipped','declined') OR outcome IS NULL),
            outcome_notes   TEXT,
            upvotes         INTEGER DEFAULT 0,
            created_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS feedback_votes (
            id          INTEGER PRIMARY KEY AUTOINCREMENT,
            item_id     INTEGER REFERENCES feedback_items(id) ON DELETE CASCADE,
            voter_id    TEXT NOT NULL,
            created_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            UNIQUE(item_id, voter_id)
        );

        CREATE TABLE IF NOT EXISTS polls (
            id                  INTEGER PRIMARY KEY AUTOINCREMENT,
            question            TEXT NOT NULL,
            poll_type           TEXT CHECK(poll_type IN ('single','multi')) DEFAULT 'single',
            max_selections      INTEGER DEFAULT 1,
            allow_submissions   INTEGER DEFAULT 1,
            show_live_results   INTEGER DEFAULT 1,
            closes_at           TIMESTAMP,
            is_closed           INTEGER DEFAULT 0,
            created_at          TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS poll_options (
            id              INTEGER PRIMARY KEY AUTOINCREMENT,
            poll_id         INTEGER REFERENCES polls(id) ON DELETE CASCADE,
            label           TEXT NOT NULL,
            vote_count      INTEGER DEFAULT 0,
            submitted_by    TEXT
        );

        CREATE TABLE IF NOT EXISTS poll_votes (
            id          INTEGER PRIMARY KEY AUTOINCREMENT,
            poll_id     INTEGER REFERENCES polls(id) ON DELETE CASCADE,
            option_id   INTEGER REFERENCES poll_options(id) ON DELETE CASCADE,
            voter_id    TEXT NOT NULL,
            UNIQUE(poll_id, option_id, voter_id)
        );

        -- Living Library tables
        CREATE TABLE IF NOT EXISTS librarians (
            id          TEXT PRIMARY KEY,
            nickname    TEXT NOT NULL,
            created_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS books (
            id            TEXT PRIMARY KEY,
            bookmark      TEXT UNIQUE NOT NULL,
            scenario_name TEXT NOT NULL,
            owner_id      TEXT REFERENCES librarians(id),
            private       INTEGER DEFAULT 0,
            created_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            last_active   TIMESTAMP,
            page_count    INTEGER DEFAULT 0
        );

        CREATE INDEX IF NOT EXISTS idx_books_owner ON books(owner_id);
        CREATE INDEX IF NOT EXISTS idx_books_bookmark ON books(bookmark);

        CREATE TABLE IF NOT EXISTS book_access (
            book_id      TEXT REFERENCES books(id) ON DELETE CASCADE,
            librarian_id TEXT REFERENCES librarians(id),
            role         TEXT DEFAULT 'reader',
            PRIMARY KEY (book_id, librarian_id)
        );
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
            "page": page_number,  # API uses 'page', DB column is 'page_num'
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
            "page": r["page_num"],  # API uses 'page', DB column is 'page_num'
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
            "page": r["page_num"],  # API uses 'page', DB column is 'page_num'
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
            "page": r["page_num"],  # API uses 'page', DB column is 'page_num'
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


def get_remembered_characters(world_id: str, global_search: bool = True) -> List[Dict[str, Any]]:
    """Get characters who have appeared in stories, with their personality derived from history.

    Returns character profiles built from their dialogue, actions, and emotional states.
    Useful for auto-filling character creation when recreating a deleted character.

    Args:
        world_id: Current world ID (prioritized in results)
        global_search: If True, also search across all worlds (default True)
    """
    conn = _get_conn()

    # Get all unique characters and their appearance count
    if global_search:
        # Search across all worlds, but note which world they're from
        char_rows = conn.execute(
            """SELECT character_name,
                      COUNT(*) as appearances,
                      MAX(page_num) as last_page,
                      world_id
               FROM character_pages
               GROUP BY character_name
               ORDER BY appearances DESC"""
        ).fetchall()
    else:
        char_rows = conn.execute(
            """SELECT character_name,
                      COUNT(*) as appearances,
                      MAX(page_num) as last_page,
                      world_id
               FROM character_pages
               WHERE world_id = ?
               GROUP BY character_name
               ORDER BY appearances DESC""",
            (world_id,)
        ).fetchall()

    characters = []
    for cr in char_rows:
        name = cr["character_name"]
        char_world = cr["world_id"]

        # Get their most recent emotional state
        emotional = conn.execute(
            """SELECT emotional_state FROM character_pages
               WHERE character_name = ? AND emotional_state IS NOT NULL
               ORDER BY page_num DESC LIMIT 1""",
            (name,)
        ).fetchone()

        # Get a sample of their dialogue (last 3 unique lines)
        dialogues = conn.execute(
            """SELECT DISTINCT dialogue FROM character_pages
               WHERE character_name = ? AND dialogue IS NOT NULL
               ORDER BY page_num DESC LIMIT 3""",
            (name,)
        ).fetchall()

        # Get a sample of their actions
        actions = conn.execute(
            """SELECT DISTINCT action FROM character_pages
               WHERE character_name = ? AND action IS NOT NULL
               ORDER BY page_num DESC LIMIT 2""",
            (name,)
        ).fetchall()

        # Build a personality summary from their behavior
        personality_parts = []
        if emotional and emotional["emotional_state"]:
            personality_parts.append(f"Currently: {emotional['emotional_state']}")
        if dialogues:
            sample = dialogues[0]["dialogue"][:100]
            if len(dialogues[0]["dialogue"]) > 100:
                sample += "..."
            personality_parts.append(f'Says things like: "{sample}"')

        characters.append({
            "name": name,
            "appearances": cr["appearances"],
            "last_seen_page": cr["last_page"],
            "from_current_world": char_world == world_id,
            "emotional_state": emotional["emotional_state"] if emotional else None,
            "personality": " | ".join(personality_parts) if personality_parts else None,
            "sample_dialogue": [d["dialogue"] for d in dialogues],
            "sample_actions": [a["action"] for a in actions],
        })

    return characters


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
        "page": row["page_num"],  # API uses 'page', DB column is 'page_num'
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


def save_potential_character(world_id: str, name: str, description: str, page_num: int) -> None:
    """Insert or update (increment mention count) a potential character.

    If the character already exists for this world, increments times_mentioned.
    Otherwise, creates a new entry with the given description and page number.
    """
    conn = _get_conn()

    # Check if character already exists
    existing = conn.execute(
        "SELECT id, times_mentioned FROM potential_characters WHERE world_id = ? AND name = ?",
        (world_id, name),
    ).fetchone()

    if existing:
        # Increment mention count
        conn.execute(
            "UPDATE potential_characters SET times_mentioned = times_mentioned + 1 WHERE id = ?",
            (existing["id"],),
        )
    else:
        # Insert new potential character
        conn.execute(
            """INSERT INTO potential_characters (world_id, name, description, first_page)
               VALUES (?, ?, ?, ?)""",
            (world_id, name, description, page_num),
        )
    conn.commit()


def get_potential_characters(world_id: str, include_promoted: bool = False) -> List[Dict[str, Any]]:
    """List potential characters for a world.

    Args:
        world_id: The world to get characters for.
        include_promoted: If True, include characters that have been promoted.
                         Defaults to False (only unpromoted characters).

    Returns:
        List of potential character records.
    """
    conn = _get_conn()

    if include_promoted:
        rows = conn.execute(
            """SELECT name, description, first_page, times_mentioned, promoted, promoted_at, created_at
               FROM potential_characters
               WHERE world_id = ?
               ORDER BY times_mentioned DESC, first_page ASC""",
            (world_id,),
        ).fetchall()
    else:
        rows = conn.execute(
            """SELECT name, description, first_page, times_mentioned, promoted, promoted_at, created_at
               FROM potential_characters
               WHERE world_id = ? AND promoted = 0
               ORDER BY times_mentioned DESC, first_page ASC""",
            (world_id,),
        ).fetchall()

    return [
        {
            "name": r["name"],
            "description": r["description"],
            "first_page": r["first_page"],
            "times_mentioned": r["times_mentioned"],
            "promoted": bool(r["promoted"]),
            "promoted_at": r["promoted_at"],
            "created_at": r["created_at"],
        }
        for r in rows
    ]


def get_potential_character(world_id: str, name: str) -> Optional[Dict[str, Any]]:
    """Get a single potential character by name.

    Args:
        world_id: The world to search in.
        name: The character name to look for.

    Returns:
        Character record dict or None if not found.
    """
    conn = _get_conn()
    row = conn.execute(
        """SELECT name, description, first_page, times_mentioned, promoted, promoted_at, created_at
           FROM potential_characters
           WHERE world_id = ? AND name = ?""",
        (world_id, name),
    ).fetchone()

    if not row:
        return None

    return {
        "name": row["name"],
        "description": row["description"],
        "first_page": row["first_page"],
        "times_mentioned": row["times_mentioned"],
        "promoted": bool(row["promoted"]),
        "promoted_at": row["promoted_at"],
        "created_at": row["created_at"],
    }


def promote_character(world_id: str, name: str) -> bool:
    """Mark a potential character as promoted.

    Args:
        world_id: The world the character belongs to.
        name: The character name to promote.

    Returns:
        True if the character was found and promoted, False otherwise.
    """
    conn = _get_conn()
    cursor = conn.execute(
        """UPDATE potential_characters
           SET promoted = 1, promoted_at = CURRENT_TIMESTAMP
           WHERE world_id = ? AND name = ? AND promoted = 0""",
        (world_id, name),
    )
    conn.commit()
    return cursor.rowcount > 0


# =============================================================================
# Alpha Dashboard Functions
# =============================================================================

def get_alpha_message() -> Optional[Dict[str, Any]]:
    """Get the hero/dev message for the alpha dashboard."""
    conn = _get_conn()
    row = conn.execute(
        "SELECT id, content, updated_at FROM alpha_messages ORDER BY id DESC LIMIT 1"
    ).fetchone()
    if not row:
        return None
    # Convert SQLite timestamp to ISO8601 format for JavaScript
    updated_at = row["updated_at"]
    if updated_at and " " in updated_at and "T" not in updated_at:
        updated_at = updated_at.replace(" ", "T") + "Z"
    return {
        "id": row["id"],
        "content": row["content"],
        "updated_at": updated_at,
    }


def set_alpha_message(content: str) -> Dict[str, Any]:
    """Set/update the hero message. Creates if doesn't exist, updates if it does."""
    conn = _get_conn()
    existing = conn.execute("SELECT id FROM alpha_messages LIMIT 1").fetchone()
    if existing:
        conn.execute(
            "UPDATE alpha_messages SET content = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
            (content, existing["id"]),
        )
    else:
        conn.execute(
            "INSERT INTO alpha_messages (content) VALUES (?)",
            (content,),
        )
    conn.commit()
    return get_alpha_message()


def get_feedback_items(voter_id: Optional[str] = None) -> List[Dict[str, Any]]:
    """Get all feedback items with vote counts and user vote status."""
    conn = _get_conn()
    rows = conn.execute(
        """SELECT id, title, notes, status, outcome, outcome_notes, upvotes, created_at, updated_at
           FROM feedback_items ORDER BY
           CASE status
               WHEN 'planned' THEN 1
               WHEN 'considering' THEN 2
               WHEN 'requests' THEN 3
               WHEN 'results' THEN 4
           END, upvotes DESC, created_at DESC"""
    ).fetchall()

    items = []
    for r in rows:
        item = {
            "id": r["id"],
            "title": r["title"],
            "notes": r["notes"],
            "status": r["status"],
            "outcome": r["outcome"],
            "outcome_notes": r["outcome_notes"],
            "upvotes": r["upvotes"],
            "created_at": r["created_at"],
            "updated_at": r["updated_at"],
        }
        if voter_id:
            vote = conn.execute(
                "SELECT id FROM feedback_votes WHERE item_id = ? AND voter_id = ?",
                (r["id"], voter_id),
            ).fetchone()
            item["has_voted"] = vote is not None
        items.append(item)
    return items


def create_feedback_item(title: str, notes: Optional[str], status: str = "requests") -> Dict[str, Any]:
    """Create a new feedback item."""
    conn = _get_conn()
    cursor = conn.execute(
        "INSERT INTO feedback_items (title, notes, status) VALUES (?, ?, ?)",
        (title, notes, status),
    )
    conn.commit()
    row = conn.execute(
        "SELECT * FROM feedback_items WHERE id = ?", (cursor.lastrowid,)
    ).fetchone()
    return {
        "id": row["id"],
        "title": row["title"],
        "notes": row["notes"],
        "status": row["status"],
        "outcome": row["outcome"],
        "outcome_notes": row["outcome_notes"],
        "upvotes": row["upvotes"],
        "created_at": row["created_at"],
        "updated_at": row["updated_at"],
    }


def update_feedback_item(item_id: int, status: Optional[str] = None,
                         outcome: Optional[str] = None, outcome_notes: Optional[str] = None) -> Optional[Dict[str, Any]]:
    """Update a feedback item's status/outcome."""
    conn = _get_conn()
    updates = ["updated_at = CURRENT_TIMESTAMP"]
    params = []
    if status is not None:
        updates.append("status = ?")
        params.append(status)
    if outcome is not None:
        updates.append("outcome = ?")
        params.append(outcome)
    if outcome_notes is not None:
        updates.append("outcome_notes = ?")
        params.append(outcome_notes)

    params.append(item_id)
    conn.execute(f"UPDATE feedback_items SET {', '.join(updates)} WHERE id = ?", params)
    conn.commit()

    row = conn.execute("SELECT * FROM feedback_items WHERE id = ?", (item_id,)).fetchone()
    if not row:
        return None
    return {
        "id": row["id"],
        "title": row["title"],
        "notes": row["notes"],
        "status": row["status"],
        "outcome": row["outcome"],
        "outcome_notes": row["outcome_notes"],
        "upvotes": row["upvotes"],
        "created_at": row["created_at"],
        "updated_at": row["updated_at"],
    }


def delete_feedback_item(item_id: int) -> bool:
    """Delete a feedback item."""
    conn = _get_conn()
    cursor = conn.execute("DELETE FROM feedback_items WHERE id = ?", (item_id,))
    conn.commit()
    return cursor.rowcount > 0


def vote_feedback_item(item_id: int, voter_id: str) -> bool:
    """Toggle a vote on a feedback item. Returns True if voted, False if unvoted."""
    conn = _get_conn()
    existing = conn.execute(
        "SELECT id FROM feedback_votes WHERE item_id = ? AND voter_id = ?",
        (item_id, voter_id),
    ).fetchone()

    if existing:
        conn.execute("DELETE FROM feedback_votes WHERE id = ?", (existing["id"],))
        conn.execute("UPDATE feedback_items SET upvotes = upvotes - 1 WHERE id = ?", (item_id,))
        conn.commit()
        return False
    else:
        conn.execute(
            "INSERT INTO feedback_votes (item_id, voter_id) VALUES (?, ?)",
            (item_id, voter_id),
        )
        conn.execute("UPDATE feedback_items SET upvotes = upvotes + 1 WHERE id = ?", (item_id,))
        conn.commit()
        return True


def get_polls(voter_id: Optional[str] = None) -> List[Dict[str, Any]]:
    """Get all polls with options and user vote status."""
    conn = _get_conn()
    rows = conn.execute(
        """SELECT id, question, poll_type, max_selections, allow_submissions,
                  show_live_results, closes_at, is_closed, created_at
           FROM polls ORDER BY is_closed ASC, created_at DESC"""
    ).fetchall()

    polls = []
    for r in rows:
        options = conn.execute(
            "SELECT id, label, vote_count, submitted_by FROM poll_options WHERE poll_id = ? ORDER BY vote_count DESC",
            (r["id"],),
        ).fetchall()

        poll = {
            "id": r["id"],
            "question": r["question"],
            "poll_type": r["poll_type"],
            "max_selections": r["max_selections"],
            "allow_submissions": bool(r["allow_submissions"]),
            "show_live_results": bool(r["show_live_results"]),
            "closes_at": r["closes_at"],
            "is_closed": bool(r["is_closed"]),
            "created_at": r["created_at"],
            "options": [
                {"id": o["id"], "label": o["label"], "vote_count": o["vote_count"], "submitted_by": o["submitted_by"]}
                for o in options
            ],
        }
        if voter_id:
            votes = conn.execute(
                "SELECT option_id FROM poll_votes WHERE poll_id = ? AND voter_id = ?",
                (r["id"], voter_id),
            ).fetchall()
            poll["user_votes"] = [v["option_id"] for v in votes]
        polls.append(poll)
    return polls


def create_poll(question: str, poll_type: str, max_selections: int,
                allow_submissions: bool, show_live_results: bool,
                options: List[str], closes_at: Optional[str] = None) -> Dict[str, Any]:
    """Create a new poll with options."""
    conn = _get_conn()
    cursor = conn.execute(
        """INSERT INTO polls (question, poll_type, max_selections, allow_submissions,
                              show_live_results, closes_at)
           VALUES (?, ?, ?, ?, ?, ?)""",
        (question, poll_type, max_selections, allow_submissions, show_live_results, closes_at),
    )
    poll_id = cursor.lastrowid
    for label in options:
        conn.execute(
            "INSERT INTO poll_options (poll_id, label) VALUES (?, ?)",
            (poll_id, label),
        )
    conn.commit()
    return get_polls()[0]  # Return the newly created poll


def add_poll_option(poll_id: int, label: str, submitted_by: Optional[str] = None) -> Dict[str, Any]:
    """Add an option to a poll (user submission)."""
    conn = _get_conn()
    cursor = conn.execute(
        "INSERT INTO poll_options (poll_id, label, submitted_by) VALUES (?, ?, ?)",
        (poll_id, label, submitted_by),
    )
    conn.commit()
    row = conn.execute("SELECT * FROM poll_options WHERE id = ?", (cursor.lastrowid,)).fetchone()
    return {"id": row["id"], "label": row["label"], "vote_count": row["vote_count"], "submitted_by": row["submitted_by"]}


def vote_poll(poll_id: int, option_ids: List[int], voter_id: str) -> bool:
    """Submit votes for a poll. Replaces any existing votes."""
    conn = _get_conn()

    # Remove existing votes
    old_votes = conn.execute(
        "SELECT option_id FROM poll_votes WHERE poll_id = ? AND voter_id = ?",
        (poll_id, voter_id),
    ).fetchall()
    for ov in old_votes:
        conn.execute("UPDATE poll_options SET vote_count = vote_count - 1 WHERE id = ?", (ov["option_id"],))
    conn.execute("DELETE FROM poll_votes WHERE poll_id = ? AND voter_id = ?", (poll_id, voter_id))

    # Add new votes
    for option_id in option_ids:
        conn.execute(
            "INSERT INTO poll_votes (poll_id, option_id, voter_id) VALUES (?, ?, ?)",
            (poll_id, option_id, voter_id),
        )
        conn.execute("UPDATE poll_options SET vote_count = vote_count + 1 WHERE id = ?", (option_id,))

    conn.commit()
    return True


def close_poll(poll_id: int) -> bool:
    """Close a poll."""
    conn = _get_conn()
    cursor = conn.execute("UPDATE polls SET is_closed = 1 WHERE id = ?", (poll_id,))
    conn.commit()
    return cursor.rowcount > 0


def delete_poll(poll_id: int) -> bool:
    """Delete a poll and its options/votes (CASCADE)."""
    conn = _get_conn()
    cursor = conn.execute("DELETE FROM polls WHERE id = ?", (poll_id,))
    conn.commit()
    return cursor.rowcount > 0
