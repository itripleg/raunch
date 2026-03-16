# tests/test_client_integration.py
"""Integration tests for client-server communication."""

import os
import tempfile
import pytest
import threading
import time
import uvicorn
import httpx


@pytest.fixture(scope="module")
def server_with_db(tmp_path_factory):
    """Start a test server with temp database."""
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

    from raunch.server.library import reset_library
    reset_library()

    from raunch.server.app import create_app
    app = create_app()

    config = uvicorn.Config(app, host="127.0.0.1", port=18766, log_level="error")
    server = uvicorn.Server(config)

    thread = threading.Thread(target=server.run, daemon=True)
    thread.start()
    time.sleep(0.5)

    yield "http://127.0.0.1:18766"

    server.should_exit = True
    time.sleep(0.3)

    # Restore
    if hasattr(db_module._local, "conn") and db_module._local.conn:
        db_module._local.conn.close()
    db_module.DB_PATH = orig_db_path
    db_module._local = orig_local


def _create_client(server_url: str, nickname: str = "TestUser"):
    """Create a RemoteClient without using config cache."""
    from raunch.client.remote import RemoteClient

    # Create librarian directly to avoid config caching
    http = httpx.Client(timeout=30.0)
    response = http.post(
        f"{server_url}/api/v1/librarians",
        json={"nickname": nickname},
    )
    response.raise_for_status()
    librarian_id = response.json()["librarian_id"]
    http.close()

    # Create client with explicit librarian_id
    return RemoteClient(server_url, nickname=nickname, librarian_id=librarian_id)


class TestFullWorkflow:
    """Test complete client workflow: create book, connect, interact."""

    def test_full_workflow(self, server_with_db):
        """Test complete client workflow: create book, connect, interact."""
        from raunch.client import BookInfo

        # Create client
        client = _create_client(server_with_db, nickname="TestUser")
        assert client.librarian_id is not None

        # Open book
        book_id, bookmark = client.open_book("test_scenario")
        assert book_id is not None
        assert len(bookmark) == 9  # ABCD-1234

        # Get book info
        book = client.get_book()
        assert isinstance(book, BookInfo)
        assert book.book_id == book_id
        assert book.scenario_name == "test_scenario"

        # List books
        books = client.list_books()
        assert len(books) >= 1
        assert any(b.book_id == book_id for b in books)

        # Control commands (these work even without orchestrator)
        client.pause()
        client.resume()

        # Cleanup
        client.close_book()
        assert client.book_id is None


class TestMultiClientJoin:
    """Test multiple clients joining same book."""

    def test_multi_client_join(self, server_with_db):
        """Test multiple clients joining same book."""
        # Owner creates book
        owner = _create_client(server_with_db, nickname="Owner")
        book_id, bookmark = owner.open_book("test_scenario")

        # Second client joins via bookmark
        reader = _create_client(server_with_db, nickname="Reader")
        joined_id = reader.join_book(bookmark)

        assert joined_id == book_id

        # Both can see the book
        owner_books = owner.list_books()
        reader_books = reader.list_books()

        assert any(b.book_id == book_id for b in owner_books)
        assert any(b.book_id == book_id for b in reader_books)

    def test_multi_client_websocket(self, server_with_db):
        """Test multiple clients connecting via WebSocket."""
        # Owner creates book
        owner = _create_client(server_with_db, nickname="Owner")
        book_id, bookmark = owner.open_book("test_scenario")

        # Owner connects WebSocket
        owner.connect_ws()
        owner_reader = owner.join_as_reader("OwnerReader")
        assert owner_reader.reader_id is not None

        # Second client joins via bookmark and WebSocket
        reader = _create_client(server_with_db, nickname="Reader")
        reader.join_book(bookmark)
        reader.connect_ws()
        reader_info = reader.join_as_reader("ReaderPlayer")
        assert reader_info.reader_id is not None

        # Both have different reader IDs
        assert owner_reader.reader_id != reader_info.reader_id

        # Cleanup
        owner.disconnect()
        reader.disconnect()


class TestBookLimitEnforcement:
    """Test that book limit is enforced."""

    def test_book_limit_enforcement(self, server_with_db):
        """Test that book limit is enforced (5 books max)."""
        client = _create_client(server_with_db, nickname="Hoarder")

        # Create books up to limit
        book_ids = []
        for i in range(5):
            book_id, _ = client.open_book(f"scenario_{i}")
            book_ids.append(book_id)

        # Verify we have 5 books
        books = client.list_books()
        owned = [b for b in books if b.owner_id == client.librarian_id]
        assert len(owned) == 5

        # Next one should fail
        with pytest.raises(httpx.HTTPStatusError) as exc_info:
            client.open_book("one_too_many")

        assert exc_info.value.response.status_code == 400
        assert "Maximum" in exc_info.value.response.text

    def test_book_limit_after_close(self, server_with_db):
        """Test that closing a book allows creating a new one."""
        client = _create_client(server_with_db, nickname="Closer")

        # Create 5 books
        book_ids = []
        for i in range(5):
            book_id, _ = client.open_book(f"scenario_{i}")
            book_ids.append(book_id)

        # Close one book
        client._book_id = book_ids[0]  # Set current book
        client.close_book()

        # Now we should be able to create one more
        new_book_id, _ = client.open_book("new_scenario")
        assert new_book_id is not None


class TestWebSocketJoinFlow:
    """Test WebSocket join and reader flow."""

    def test_websocket_join_flow(self, server_with_db):
        """Test WebSocket join and reader flow."""
        client = _create_client(server_with_db, nickname="WSTest")
        book_id, _ = client.open_book("test_scenario")

        # Connect WebSocket
        client.connect_ws()

        # Join as reader
        reader = client.join_as_reader("TestReader")
        assert reader.reader_id is not None
        assert reader.nickname == "TestReader"
        assert client.reader_id is not None

        # Cleanup
        client.disconnect()

    def test_websocket_detach_without_attach(self, server_with_db):
        """Test that detach works even if not attached."""
        client = _create_client(server_with_db, nickname="DetachTest")
        client.open_book("test_scenario")
        client.connect_ws()
        client.join_as_reader("TestReader")

        # Should not raise
        client.detach()
        assert client._attached_to is None

        client.disconnect()

    def test_websocket_director_guidance(self, server_with_db):
        """Test sending director guidance via WebSocket."""
        client = _create_client(server_with_db, nickname="DirectorTest")
        client.open_book("test_scenario")
        client.connect_ws()
        client.join_as_reader("Director")

        # Director guidance doesn't require attachment
        client.director("Everyone should be happy")

        client.disconnect()

    def test_websocket_action_requires_attachment(self, server_with_db):
        """Test that action requires being attached to a character."""
        client = _create_client(server_with_db, nickname="ActionTest")
        client.open_book("test_scenario")
        client.connect_ws()
        client.join_as_reader("Player")

        # Action without attachment should fail
        with pytest.raises(Exception) as exc_info:
            client.action("do something")

        assert "not_attached" in str(exc_info.value).lower() or "attach" in str(exc_info.value).lower()

        client.disconnect()

    def test_websocket_whisper_requires_attachment(self, server_with_db):
        """Test that whisper requires being attached to a character."""
        client = _create_client(server_with_db, nickname="WhisperTest")
        client.open_book("test_scenario")
        client.connect_ws()
        client.join_as_reader("Player")

        # Whisper without attachment should fail
        with pytest.raises(Exception) as exc_info:
            client.whisper("think about it")

        assert "not_attached" in str(exc_info.value).lower() or "attach" in str(exc_info.value).lower()

        client.disconnect()


class TestBookOperations:
    """Test various book operations via client."""

    def test_pause_and_resume(self, server_with_db):
        """Test pausing and resuming a book."""
        client = _create_client(server_with_db, nickname="PauseTest")
        client.open_book("test_scenario")

        # Should not raise
        client.pause()
        client.resume()

    def test_trigger_page(self, server_with_db):
        """Test triggering page generation."""
        client = _create_client(server_with_db, nickname="PageTest")
        client.open_book("test_scenario")

        # Without orchestrator, returns False
        result = client.trigger_page()
        assert isinstance(result, bool)
        # Without orchestrator running, triggered should be False
        assert result is False

    def test_set_page_interval(self, server_with_db):
        """Test setting page interval."""
        client = _create_client(server_with_db, nickname="IntervalTest")
        client.open_book("test_scenario")

        # Should not raise
        client.set_page_interval(60)
        client.set_page_interval(0)  # Manual mode

    def test_list_characters_empty(self, server_with_db):
        """Test listing characters when book has no orchestrator."""
        client = _create_client(server_with_db, nickname="CharTest")
        client.open_book("test_scenario")

        characters = client.list_characters()
        assert isinstance(characters, list)
        # Without orchestrator, no characters
        assert len(characters) == 0


class TestEdgeCases:
    """Test edge cases and error handling."""

    def test_join_invalid_bookmark(self, server_with_db):
        """Test joining with invalid bookmark."""
        client = _create_client(server_with_db, nickname="InvalidJoin")

        with pytest.raises(httpx.HTTPStatusError) as exc_info:
            client.join_book("FAKE-1234")

        assert exc_info.value.response.status_code == 404

    def test_operations_without_book(self, server_with_db):
        """Test operations fail gracefully when not connected to book."""
        client = _create_client(server_with_db, nickname="NoBook")

        # pause should raise
        with pytest.raises(ValueError):
            client.pause()

        # resume should raise
        with pytest.raises(ValueError):
            client.resume()

        # close_book should raise
        with pytest.raises(ValueError):
            client.close_book()

        # get_book should return None
        assert client.get_book() is None

        # list_characters should return empty
        assert client.list_characters() == []

    def test_connect_ws_without_book(self, server_with_db):
        """Test WebSocket connect fails without book."""
        client = _create_client(server_with_db, nickname="NoBookWS")

        with pytest.raises(ValueError):
            client.connect_ws()

    def test_delete_not_owner(self, server_with_db):
        """Test that non-owner cannot delete book."""
        owner = _create_client(server_with_db, nickname="Owner")
        book_id, bookmark = owner.open_book("test_scenario")

        # Another client joins
        other = _create_client(server_with_db, nickname="Other")
        other.join_book(bookmark)

        # Other tries to delete - should fail
        other._book_id = book_id  # Pretend to be connected
        with pytest.raises(httpx.HTTPStatusError) as exc_info:
            other.close_book()

        assert exc_info.value.response.status_code == 403


class TestPageCallback:
    """Test page event callbacks."""

    def test_on_page_callback_registered(self, server_with_db):
        """Test that page callbacks are registered."""
        client = _create_client(server_with_db, nickname="CallbackTest")
        client.open_book("test_scenario")

        received_pages = []

        def page_handler(page):
            received_pages.append(page)

        client.on_page(page_handler)
        assert len(client._page_callbacks) == 1

    def test_multiple_page_callbacks(self, server_with_db):
        """Test multiple page callbacks can be registered."""
        client = _create_client(server_with_db, nickname="MultiCallback")
        client.open_book("test_scenario")

        def handler1(page):
            pass

        def handler2(page):
            pass

        client.on_page(handler1)
        client.on_page(handler2)

        assert len(client._page_callbacks) == 2
