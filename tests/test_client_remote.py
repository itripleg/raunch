# tests/test_client_remote.py
"""Tests for RemoteClient."""

import os
import tempfile
import pytest
import threading
import time
import uvicorn


@pytest.fixture(scope="module")
def temp_db(tmp_path_factory):
    """Create a temporary database for testing."""
    tmpdir = tmp_path_factory.mktemp("db")
    db_path = str(tmpdir / "test.db")

    import raunch.db as db_module

    # Store original values
    orig_db_path = db_module.DB_PATH
    orig_local = db_module._local

    # Set new values
    db_module.DB_PATH = db_path
    db_module._local = threading.local()

    db_module.init_db()
    yield db_path

    # Restore
    if hasattr(db_module._local, "conn") and db_module._local.conn:
        db_module._local.conn.close()
    db_module.DB_PATH = orig_db_path
    db_module._local = orig_local


@pytest.fixture(scope="module")
def server(temp_db):
    """Start a test server."""
    from raunch.server.library import reset_library
    reset_library()

    from raunch.server.app import create_app
    app = create_app()

    # Start server in background thread
    config = uvicorn.Config(app, host="127.0.0.1", port=18765, log_level="error")
    server = uvicorn.Server(config)

    thread = threading.Thread(target=server.run, daemon=True)
    thread.start()

    # Wait for server to start
    time.sleep(0.5)

    yield "http://127.0.0.1:18765"

    # Cleanup
    server.should_exit = True
    time.sleep(0.3)  # Give server time to clean up


def _create_client(server_url: str):
    """Create a RemoteClient without using config cache."""
    from raunch.client.remote import RemoteClient
    import httpx

    # Create librarian directly to avoid config caching
    http = httpx.Client(timeout=30.0)
    response = http.post(
        f"{server_url}/api/v1/librarians",
        json={"nickname": "TestUser"},
    )
    response.raise_for_status()
    librarian_id = response.json()["librarian_id"]
    http.close()

    # Create client with explicit librarian_id
    return RemoteClient(server_url, librarian_id=librarian_id)


def test_remote_client_creates_librarian(server):
    """RemoteClient should auto-create anonymous librarian."""
    client = _create_client(server)

    assert client.librarian_id is not None
    assert len(client.librarian_id) > 0


def test_remote_client_open_book(server):
    """RemoteClient should open a book."""
    client = _create_client(server)

    book_id, bookmark = client.open_book("test_scenario")

    assert book_id is not None
    assert bookmark is not None
    assert len(bookmark) == 9  # ABCD-1234


def test_remote_client_list_books(server):
    """RemoteClient should list books."""
    client = _create_client(server)

    # Create a book
    book_id, _ = client.open_book("test_scenario")

    # List books
    books = client.list_books()

    assert len(books) >= 1
    assert any(b.book_id == book_id for b in books)


def test_remote_client_join_book(server):
    """RemoteClient should join a book via bookmark."""
    client = _create_client(server)

    # Create a book
    _, bookmark = client.open_book("test_scenario")

    # Create new client and join
    client2 = _create_client(server)
    book_id = client2.join_book(bookmark)

    assert book_id is not None


def test_remote_client_get_book(server):
    """RemoteClient should get book info."""
    client = _create_client(server)

    # Create a book
    book_id, _ = client.open_book("test_scenario")

    # Get book info
    book = client.get_book()

    assert book is not None
    assert book.book_id == book_id
    assert book.scenario_name == "test_scenario"


def test_remote_client_close_book(server):
    """RemoteClient should close a book."""
    client = _create_client(server)

    # Create and close a book
    book_id, _ = client.open_book("test_scenario")
    client.close_book()

    assert client.book_id is None


def test_remote_client_pause_resume(server):
    """RemoteClient should pause and resume a book."""
    client = _create_client(server)
    client.open_book("test_scenario")

    # Should not raise
    client.pause()
    client.resume()


def test_remote_client_trigger_page(server):
    """RemoteClient should trigger page generation."""
    client = _create_client(server)
    client.open_book("test_scenario")

    # Without orchestrator, returns False
    result = client.trigger_page()
    assert isinstance(result, bool)


def test_remote_client_set_page_interval(server):
    """RemoteClient should set page interval."""
    client = _create_client(server)
    client.open_book("test_scenario")

    # Should not raise
    client.set_page_interval(60)


def test_remote_client_list_characters(server):
    """RemoteClient should list characters."""
    client = _create_client(server)
    client.open_book("test_scenario")

    # Without orchestrator, returns empty list
    characters = client.list_characters()
    assert isinstance(characters, list)
