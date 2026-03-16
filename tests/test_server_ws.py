"""Tests for WebSocket handler."""

import os
import tempfile
import pytest
from fastapi.testclient import TestClient


@pytest.fixture
def client_with_db(monkeypatch):
    """Create a test client with temp database."""
    with tempfile.TemporaryDirectory(ignore_cleanup_errors=True) as tmpdir:
        db_path = os.path.join(tmpdir, "test.db")
        monkeypatch.setattr("raunch.db.DB_PATH", db_path)
        monkeypatch.setattr("raunch.db._local", type("Local", (), {})())

        from raunch import db
        db.init_db()

        from raunch.server.library import reset_library
        reset_library()

        from raunch.server.app import create_app
        app = create_app()
        client = TestClient(app)
        yield client
        # Close any open connections
        if hasattr(db._local, "conn") and db._local.conn:
            db._local.conn.close()
            db._local.conn = None


def test_ws_connect_and_join(client_with_db):
    """Should connect to WebSocket and join as reader."""
    from raunch import db
    from raunch.server.library import get_library

    # Create librarian and book
    librarian = db.create_librarian("Owner")
    library = get_library()
    book_id, bookmark = library.open_book("milk_money", librarian["id"])

    # Connect WebSocket
    with client_with_db.websocket_connect(f"/ws/{book_id}") as ws:
        # Join
        ws.send_json({"cmd": "join", "nickname": "TestReader"})
        response = ws.receive_json()

        assert response["type"] == "joined"
        assert "reader_id" in response


def test_ws_attach_character(client_with_db):
    """Should attach to a character."""
    from raunch import db
    from raunch.server.library import get_library
    from unittest.mock import MagicMock

    # Create librarian and book
    librarian = db.create_librarian("Owner")
    library = get_library()
    book_id, bookmark = library.open_book("milk_money", librarian["id"])

    # Set up mock orchestrator with characters
    book = library.get_book(book_id)
    mock_orch = MagicMock()
    mock_orch.characters = {"Jake": MagicMock()}
    book.set_orchestrator(mock_orch)

    with client_with_db.websocket_connect(f"/ws/{book_id}") as ws:
        ws.send_json({"cmd": "join", "nickname": "TestReader"})
        ws.receive_json()  # joined response

        ws.send_json({"cmd": "attach", "character": "Jake"})
        response = ws.receive_json()

        assert response["type"] == "attached"
        assert response["character"] == "Jake"


def test_ws_attach_nonexistent_character(client_with_db):
    """Should error when attaching to a character that doesn't exist."""
    from raunch import db
    from raunch.server.library import get_library
    from unittest.mock import MagicMock

    # Create librarian and book
    librarian = db.create_librarian("Owner")
    library = get_library()
    book_id, bookmark = library.open_book("milk_money", librarian["id"])

    # Set up mock orchestrator with no characters
    book = library.get_book(book_id)
    mock_orch = MagicMock()
    mock_orch.characters = {}
    book.set_orchestrator(mock_orch)

    with client_with_db.websocket_connect(f"/ws/{book_id}") as ws:
        ws.send_json({"cmd": "join", "nickname": "TestReader"})
        ws.receive_json()  # joined response

        ws.send_json({"cmd": "attach", "character": "Nonexistent"})
        response = ws.receive_json()

        assert response["type"] == "error"
        assert response["code"] == "not_found"


def test_ws_detach_character(client_with_db):
    """Should detach from a character."""
    from raunch import db
    from raunch.server.library import get_library
    from unittest.mock import MagicMock

    # Create librarian and book
    librarian = db.create_librarian("Owner")
    library = get_library()
    book_id, bookmark = library.open_book("milk_money", librarian["id"])

    # Set up mock orchestrator with characters
    book = library.get_book(book_id)
    mock_orch = MagicMock()
    mock_orch.characters = {"Jake": MagicMock()}
    book.set_orchestrator(mock_orch)

    with client_with_db.websocket_connect(f"/ws/{book_id}") as ws:
        ws.send_json({"cmd": "join", "nickname": "TestReader"})
        ws.receive_json()

        ws.send_json({"cmd": "attach", "character": "Jake"})
        ws.receive_json()

        ws.send_json({"cmd": "detach"})
        response = ws.receive_json()

        assert response["type"] == "detached"


def test_ws_action_without_attach(client_with_db):
    """Should error when sending action without being attached."""
    from raunch import db
    from raunch.server.library import get_library

    # Create librarian and book
    librarian = db.create_librarian("Owner")
    library = get_library()
    book_id, bookmark = library.open_book("milk_money", librarian["id"])

    with client_with_db.websocket_connect(f"/ws/{book_id}") as ws:
        ws.send_json({"cmd": "join", "nickname": "TestReader"})
        ws.receive_json()

        ws.send_json({"cmd": "action", "text": "do something"})
        response = ws.receive_json()

        assert response["type"] == "error"
        assert response["code"] == "not_attached"


def test_ws_invalid_command(client_with_db):
    """Should error on invalid command."""
    from raunch import db
    from raunch.server.library import get_library

    # Create librarian and book
    librarian = db.create_librarian("Owner")
    library = get_library()
    book_id, bookmark = library.open_book("milk_money", librarian["id"])

    with client_with_db.websocket_connect(f"/ws/{book_id}") as ws:
        ws.send_json({"cmd": "join", "nickname": "TestReader"})
        ws.receive_json()

        ws.send_json({"cmd": "invalid_command"})
        response = ws.receive_json()

        assert response["type"] == "error"
        assert response["code"] == "invalid_command"


def test_ws_connect_nonexistent_book(client_with_db):
    """Should error when connecting to nonexistent book."""
    with client_with_db.websocket_connect("/ws/nonexistent") as ws:
        response = ws.receive_json()

        assert response["type"] == "error"
        assert response["code"] == "not_found"


def test_ws_ready_command(client_with_db):
    """Should set ready status."""
    from raunch import db
    from raunch.server.library import get_library

    # Create librarian and book
    librarian = db.create_librarian("Owner")
    library = get_library()
    book_id, bookmark = library.open_book("milk_money", librarian["id"])

    with client_with_db.websocket_connect(f"/ws/{book_id}") as ws:
        ws.send_json({"cmd": "join", "nickname": "TestReader"})
        ws.receive_json()

        ws.send_json({"cmd": "ready"})
        response = ws.receive_json()

        assert response["type"] == "ok"
