#!/usr/bin/env python3
"""Migration script to rename tick tables/columns to page.

This script renames:
- Table `ticks` -> `pages`
- Table `character_ticks` -> `character_pages`
- Column `tick` -> `page_num` in both tables
- Indexes to use new naming convention

Run this script once to migrate existing databases.
"""

import os
import sqlite3
import sys

# Try to import from raunch config, fall back to default
try:
    from raunch.config import SAVES_DIR
    DB_PATH = os.path.join(SAVES_DIR, "history.db")
except ImportError:
    DB_PATH = os.path.join(os.path.dirname(__file__), "saves", "history.db")


def migrate(db_path: str = DB_PATH) -> None:
    """Migrate tick tables to page tables."""
    if not os.path.exists(db_path):
        print(f"Database not found at {db_path}")
        print("No migration needed - tables will be created with new schema on first run.")
        return

    conn = sqlite3.connect(db_path)
    cursor = conn.cursor()

    # Check if migration is needed by looking for old table names
    cursor.execute("SELECT name FROM sqlite_master WHERE type='table' AND name='ticks'")
    has_ticks = cursor.fetchone() is not None

    cursor.execute("SELECT name FROM sqlite_master WHERE type='table' AND name='pages'")
    has_pages = cursor.fetchone() is not None

    if has_pages and not has_ticks:
        print("Migration already complete - 'pages' table exists, 'ticks' table does not.")
        conn.close()
        return

    if not has_ticks:
        print("No 'ticks' table found. No migration needed.")
        conn.close()
        return

    if has_pages:
        print("WARNING: Both 'ticks' and 'pages' tables exist.")
        print("Please manually resolve this before running migration.")
        conn.close()
        sys.exit(1)

    print(f"Migrating database: {db_path}")
    print()

    try:
        # Step 1: Rename ticks table to pages
        print("Step 1: Renaming 'ticks' table to 'pages'...")
        cursor.execute("ALTER TABLE ticks RENAME TO pages")
        print("  Done.")

        # Step 2: Rename tick column to page_num in pages table
        print("Step 2: Renaming 'tick' column to 'page_num' in 'pages' table...")
        cursor.execute("ALTER TABLE pages RENAME COLUMN tick TO page_num")
        print("  Done.")

        # Step 3: Rename character_ticks table to character_pages
        print("Step 3: Renaming 'character_ticks' table to 'character_pages'...")
        cursor.execute("ALTER TABLE character_ticks RENAME TO character_pages")
        print("  Done.")

        # Step 4: Rename tick column to page_num in character_pages table
        print("Step 4: Renaming 'tick' column to 'page_num' in 'character_pages' table...")
        cursor.execute("ALTER TABLE character_pages RENAME COLUMN tick TO page_num")
        print("  Done.")

        # Step 5: Drop old indexes and create new ones
        print("Step 5: Recreating indexes with new names...")

        # Drop old indexes (if they exist)
        cursor.execute("DROP INDEX IF EXISTS idx_ticks_world")
        cursor.execute("DROP INDEX IF EXISTS idx_char_ticks_world")
        cursor.execute("DROP INDEX IF EXISTS idx_char_ticks_name")

        # Create new indexes
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_pages_world ON pages(world_id, page_num)")
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_char_pages_world ON character_pages(world_id, page_num)")
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_char_pages_name ON character_pages(world_id, character_name, page_num)")
        print("  Done.")

        # Commit the changes
        conn.commit()
        print()
        print("Migration completed successfully!")

        # Show stats
        cursor.execute("SELECT COUNT(*) FROM pages")
        pages_count = cursor.fetchone()[0]
        cursor.execute("SELECT COUNT(*) FROM character_pages")
        char_pages_count = cursor.fetchone()[0]
        print(f"  - {pages_count} pages migrated")
        print(f"  - {char_pages_count} character_pages migrated")

    except Exception as e:
        conn.rollback()
        print(f"ERROR: Migration failed: {e}")
        print("Database has been rolled back to previous state.")
        sys.exit(1)
    finally:
        conn.close()


if __name__ == "__main__":
    if len(sys.argv) > 1:
        migrate(sys.argv[1])
    else:
        migrate()
