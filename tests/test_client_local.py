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


def test_local_client_pause_resume(temp_db):
    """LocalClient should pause and resume orchestrator."""
    from raunch.client.local import LocalClient

    client = LocalClient(nickname="TestUser")
    client.open_book("test_solo_scenario")

    # Should not raise
    client.pause()
    client.resume()


def test_local_client_trigger_page(temp_db):
    """LocalClient should trigger page generation."""
    from raunch.client.local import LocalClient

    client = LocalClient(nickname="TestUser")
    client.open_book("test_solo_scenario")

    # This would actually generate a page if orchestrator is running
    # For now just verify it doesn't crash
    result = client.trigger_page()
    assert isinstance(result, bool)


def test_local_client_list_characters(temp_db):
    """LocalClient should list characters."""
    from raunch.client.local import LocalClient

    client = LocalClient(nickname="TestUser")
    client.open_book("test_solo_scenario")

    chars = client.list_characters()
    assert isinstance(chars, list)
    # test_solo_scenario has 1 character
    assert len(chars) >= 1


def test_local_client_attach_detach(temp_db):
    """LocalClient should attach/detach from characters."""
    from raunch.client.local import LocalClient

    client = LocalClient(nickname="TestUser")
    client.open_book("test_solo_scenario")

    # Get first character
    chars = client.list_characters()
    if chars:
        client.attach(chars[0].name)
        assert client._attached_to == chars[0].name

        client.detach()
        assert client._attached_to is None


def test_local_client_on_page_callback(temp_db):
    """LocalClient should register page callbacks."""
    from raunch.client.local import LocalClient

    client = LocalClient(nickname="TestUser")

    callbacks_called = []
    def my_callback(page):
        callbacks_called.append(page)

    client.on_page(my_callback)
    assert len(client._page_callbacks) == 1
