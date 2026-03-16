"""Tests for database schema changes."""

import os
import sqlite3
import tempfile
import pytest

# Patch DB_PATH before importing db module
@pytest.fixture
def temp_db(monkeypatch):
    """Create a temporary database for testing."""
    with tempfile.TemporaryDirectory(ignore_cleanup_errors=True) as tmpdir:
        db_path = os.path.join(tmpdir, "test.db")
        monkeypatch.setattr("raunch.db.DB_PATH", db_path)
        monkeypatch.setattr("raunch.db._local", type("Local", (), {})())
        yield db_path
        # Close any open connections
        from raunch import db
        if hasattr(db._local, "conn") and db._local.conn:
            db._local.conn.close()
            db._local.conn = None


def test_librarians_table_exists(temp_db):
    """Librarians table should be created with correct schema."""
    from raunch import db
    db.init_db()

    conn = sqlite3.connect(temp_db)
    cursor = conn.execute(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='librarians'"
    )
    assert cursor.fetchone() is not None

    # Check columns
    cursor = conn.execute("PRAGMA table_info(librarians)")
    columns = {row[1]: row[2] for row in cursor.fetchall()}
    conn.close()
    assert "id" in columns
    assert "nickname" in columns
    assert "created_at" in columns
