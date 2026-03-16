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


def test_books_table_exists(temp_db):
    """Books table should be created with correct schema."""
    from raunch import db
    db.init_db()

    conn = sqlite3.connect(temp_db)
    cursor = conn.execute(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='books'"
    )
    assert cursor.fetchone() is not None

    # Check columns
    cursor = conn.execute("PRAGMA table_info(books)")
    columns = {row[1]: row[2] for row in cursor.fetchall()}
    conn.close()
    assert "id" in columns
    assert "bookmark" in columns
    assert "scenario_name" in columns
    assert "owner_id" in columns
    assert "private" in columns
    assert "created_at" in columns
    assert "last_active" in columns
    assert "page_count" in columns


def test_book_access_table_exists(temp_db):
    """Book access table should be created with correct schema."""
    from raunch import db
    db.init_db()

    conn = sqlite3.connect(temp_db)
    cursor = conn.execute(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='book_access'"
    )
    assert cursor.fetchone() is not None

    # Check columns
    cursor = conn.execute("PRAGMA table_info(book_access)")
    columns = {row[1]: row[2] for row in cursor.fetchall()}
    conn.close()
    assert "book_id" in columns
    assert "librarian_id" in columns
    assert "role" in columns


def test_create_librarian(temp_db):
    """Should create a librarian and return it."""
    from raunch import db
    db.init_db()

    librarian = db.create_librarian("TestUser")
    assert librarian["id"] is not None
    assert librarian["nickname"] == "TestUser"
    assert librarian["created_at"] is not None


def test_get_librarian(temp_db):
    """Should retrieve a librarian by ID."""
    from raunch import db
    db.init_db()

    created = db.create_librarian("TestUser")
    fetched = db.get_librarian(created["id"])

    assert fetched is not None
    assert fetched["id"] == created["id"]
    assert fetched["nickname"] == "TestUser"


def test_get_librarian_not_found(temp_db):
    """Should return None for non-existent librarian."""
    from raunch import db
    db.init_db()

    result = db.get_librarian("nonexistent-id")
    assert result is None
