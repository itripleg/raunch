#!/usr/bin/env python3
"""Fix old character data in the history database."""

import sqlite3
import json
import re
import os

DB_PATH = os.path.join(os.path.dirname(__file__), "saves", "history.db")


def extract_fields(raw_json_str):
    """Extract character fields from raw JSON string."""
    if not raw_json_str:
        return None

    try:
        data = json.loads(raw_json_str)
    except json.JSONDecodeError:
        return None

    # Check if already has fields
    if data.get("inner_thoughts") or data.get("action") or data.get("dialogue"):
        return data

    # Check for raw field
    raw = data.get("raw")
    if not raw or not isinstance(raw, str):
        return None

    extracted = {}

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
            parsed = json.loads(text[first : last + 1])
            extracted.update(parsed)
            return extracted
    except (json.JSONDecodeError, IndexError):
        pass

    # Regex fallback
    def extract_field(field):
        pattern = rf'"{field}"\s*:\s*"((?:[^"\\]|\\.)*)"'
        match = re.search(pattern, raw, re.DOTALL)
        if match:
            return match.group(1).replace("\\n", "\n").replace('\\"', '"')
        return None

    for field in [
        "inner_thoughts",
        "action",
        "dialogue",
        "emotional_state",
        "desires_update",
    ]:
        val = extract_field(field)
        if val:
            extracted[field] = val

    return extracted if extracted else None


def main():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row

    # Get all rows with NULL inner_thoughts but non-null raw_json
    rows = conn.execute(
        """
        SELECT id, character_name, raw_json FROM character_ticks
        WHERE inner_thoughts IS NULL AND raw_json IS NOT NULL
    """
    ).fetchall()

    print(f"Found {len(rows)} rows to fix")

    fixed = 0
    skipped = 0
    for row in rows:
        extracted = extract_fields(row["raw_json"])
        if extracted and (extracted.get("inner_thoughts") or extracted.get("dialogue")):
            conn.execute(
                """
                UPDATE character_ticks
                SET inner_thoughts = ?, action = ?, dialogue = ?,
                    emotional_state = ?, desires_update = ?
                WHERE id = ?
            """,
                (
                    extracted.get("inner_thoughts"),
                    extracted.get("action"),
                    extracted.get("dialogue"),
                    extracted.get("emotional_state"),
                    extracted.get("desires_update"),
                    row["id"],
                ),
            )
            fixed += 1
            print(f"  Fixed: {row['character_name']} (id={row['id']})")
        else:
            skipped += 1

    conn.commit()
    print(f"\nFixed {fixed} rows, skipped {skipped}")

    # Verify
    sample = conn.execute(
        """
        SELECT character_name, inner_thoughts, dialogue
        FROM character_ticks
        WHERE inner_thoughts IS NOT NULL
        ORDER BY id DESC
        LIMIT 5
    """
    ).fetchall()

    print("\nSample fixed data:")
    for r in sample:
        thoughts = r["inner_thoughts"][:60] + "..." if r["inner_thoughts"] and len(r["inner_thoughts"]) > 60 else r["inner_thoughts"]
        print(f"  {r['character_name']}:")
        print(f"    thoughts: {thoughts}")
        print(f"    dialogue: {r['dialogue']}")

    conn.close()


if __name__ == "__main__":
    main()
