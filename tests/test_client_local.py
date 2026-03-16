# tests/test_client_local.py
"""Tests for LocalClient - in-process orchestrator wrapper."""

import os
import tempfile
import pytest


@pytest.fixture
def temp_db(monkeypatch):
    """Create a temporary database for testing."""
    with tempfile.TemporaryDirectory() as tmpdir:
        db_path = os.path.join(tmpdir, "test.db")
        monkeypatch.setattr("raunch.db.DB_PATH", db_path)
        # Reset thread-local connection
        monkeypatch.setattr("raunch.db._local", type("Local", (), {})())

        from raunch import db
        db.init_db()
        yield db_path

        # Close database connection to release file handle on Windows
        if hasattr(db._local, "conn") and db._local.conn:
            db._local.conn.close()
            db._local.conn = None


def test_local_client_creation(temp_db):
    """LocalClient should be created without errors."""
    from raunch.client.local import LocalClient

    client = LocalClient(nickname="TestUser")
    assert client is not None
    assert client.nickname == "TestUser"


def test_local_client_open_book(temp_db):
    """LocalClient should open a book from scenario."""
    from raunch.client.local import LocalClient

    client = LocalClient(nickname="TestUser")
    book_id, bookmark = client.open_book("test_solo_scenario")

    assert book_id is not None
    assert bookmark is not None
    assert len(bookmark) == 9  # ABCD-1234


def test_local_client_get_book(temp_db):
    """LocalClient should return book info."""
    from raunch.client.local import LocalClient
    from raunch.client import BookInfo

    client = LocalClient(nickname="TestUser")
    client.open_book("test_solo_scenario")

    book = client.get_book()
    assert isinstance(book, BookInfo)
    assert book.scenario_name == "Test Solo Scenario"


def test_local_client_close_book(temp_db):
    """LocalClient should close the book."""
    from raunch.client.local import LocalClient

    client = LocalClient(nickname="TestUser")
    client.open_book("test_solo_scenario")
    client.close_book()

    assert client.book_id is None
