"""Tests for Library singleton."""

import os
import tempfile
import pytest


@pytest.fixture
def temp_db(monkeypatch):
    """Create a temporary database for testing."""
    with tempfile.TemporaryDirectory(ignore_cleanup_errors=True) as tmpdir:
        db_path = os.path.join(tmpdir, "test.db")
        monkeypatch.setattr("raunch.db.DB_PATH", db_path)
        monkeypatch.setattr("raunch.db._local", type("Local", (), {})())

        from raunch import db
        db.init_db()
        yield db_path
        # Close any open connections
        if hasattr(db._local, "conn") and db._local.conn:
            db._local.conn.close()
            db._local.conn = None


@pytest.fixture
def library(temp_db):
    """Create a fresh library instance."""
    from raunch.server.library import Library, reset_library
    reset_library()
    lib = Library()
    return lib


def test_library_open_book(library, temp_db):
    """Library should open a new book."""
    from raunch import db

    librarian = db.create_librarian("TestUser")
    book_id, bookmark = library.open_book("milk_money", librarian["id"])

    assert book_id is not None
    assert bookmark is not None
    assert len(bookmark) == 9  # ABCD-1234


def test_library_get_book(library, temp_db):
    """Library should retrieve a book by ID."""
    from raunch import db

    librarian = db.create_librarian("TestUser")
    book_id, _ = library.open_book("milk_money", librarian["id"])

    book = library.get_book(book_id)
    assert book is not None
    assert book.book_id == book_id


def test_library_find_by_bookmark(library, temp_db):
    """Library should find a book by bookmark."""
    from raunch import db

    librarian = db.create_librarian("TestUser")
    book_id, bookmark = library.open_book("milk_money", librarian["id"])

    found_id = library.find_by_bookmark(bookmark)
    assert found_id == book_id


def test_library_close_book(library, temp_db):
    """Library should close and remove a book."""
    from raunch import db

    librarian = db.create_librarian("TestUser")
    book_id, _ = library.open_book("milk_money", librarian["id"])

    library.close_book(book_id)

    assert library.get_book(book_id) is None
