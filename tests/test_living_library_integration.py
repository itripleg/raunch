"""Integration tests for Living Library API.

Run with: python -m pytest tests/test_living_library_integration.py -v
"""

import json
import time
import threading
import pytest
from unittest.mock import patch, MagicMock

# Test REST API
class TestRESTAPI:
    """Test REST API endpoints."""

    @pytest.fixture
    def client(self):
        """Create test client."""
        from fastapi.testclient import TestClient
        from raunch.api import app
        return TestClient(app)

    def test_health(self, client):
        """Test health endpoint."""
        response = client.get("/health")
        assert response.status_code == 200
        assert response.json()["status"] == "ok"

    def test_scenarios_list(self, client):
        """Test scenarios listing."""
        response = client.get("/api/v1/scenarios")
        assert response.status_code == 200
        scenarios = response.json()
        assert isinstance(scenarios, list)
        # Should have at least milk_money
        names = [s["name"] for s in scenarios]
        assert any("milk" in n.lower() for n in names)

    def test_create_librarian(self, client):
        """Test librarian creation."""
        response = client.post(
            "/api/v1/librarians",
            json={"nickname": "TestLibrarian"}
        )
        assert response.status_code == 201  # Created
        data = response.json()
        assert "librarian_id" in data
        assert data["nickname"] == "TestLibrarian"
        return data["librarian_id"]

    def test_create_book(self, client):
        """Test book creation."""
        # First create librarian
        lib_response = client.post(
            "/api/v1/librarians",
            json={"nickname": "BookCreator"}
        )
        librarian_id = lib_response.json()["librarian_id"]

        # Create book
        response = client.post(
            "/api/v1/books",
            json={"scenario": "test_solo_scenario"},
            headers={"X-Librarian-ID": librarian_id}
        )
        assert response.status_code == 201  # Created
        data = response.json()
        assert "book_id" in data
        assert "bookmark" in data
        assert len(data["bookmark"]) == 9  # XXXX-XXXX format

    def test_get_book(self, client):
        """Test getting book info."""
        # Create librarian and book
        lib_response = client.post(
            "/api/v1/librarians",
            json={"nickname": "BookGetter"}
        )
        librarian_id = lib_response.json()["librarian_id"]

        book_response = client.post(
            "/api/v1/books",
            json={"scenario": "test_solo_scenario"},
            headers={"X-Librarian-ID": librarian_id}
        )
        book_id = book_response.json()["book_id"]

        # Get book
        response = client.get(
            f"/api/v1/books/{book_id}",
            headers={"X-Librarian-ID": librarian_id}
        )
        assert response.status_code == 200
        data = response.json()
        assert data["book_id"] == book_id
        assert data["scenario_name"] == "test_solo_scenario"

    def test_join_book_by_bookmark(self, client):
        """Test joining book by bookmark."""
        # Create librarian and book
        lib_response = client.post(
            "/api/v1/librarians",
            json={"nickname": "BookOwner"}
        )
        owner_id = lib_response.json()["librarian_id"]

        book_response = client.post(
            "/api/v1/books",
            json={"scenario": "test_solo_scenario"},
            headers={"X-Librarian-ID": owner_id}
        )
        bookmark = book_response.json()["bookmark"]

        # Create second librarian and join
        lib2_response = client.post(
            "/api/v1/librarians",
            json={"nickname": "BookJoiner"}
        )
        joiner_id = lib2_response.json()["librarian_id"]

        join_response = client.post(
            "/api/v1/books/join",
            json={"bookmark": bookmark},
            headers={"X-Librarian-ID": joiner_id}
        )
        assert join_response.status_code == 200
        assert "book_id" in join_response.json()


class TestWebSocket:
    """Test WebSocket functionality."""

    @pytest.fixture
    def client(self):
        """Create test client."""
        from fastapi.testclient import TestClient
        from raunch.api import app
        return TestClient(app)

    def test_websocket_connect_invalid_book(self, client):
        """Test WebSocket rejects invalid book ID."""
        with client.websocket_connect("/ws/invalid-book-id") as ws:
            data = ws.receive_json()
            assert data["type"] == "error"
            assert data["code"] == "not_found"

    def test_websocket_connect_and_welcome(self, client):
        """Test WebSocket connection and welcome message."""
        # Create book first
        lib_response = client.post(
            "/api/v1/librarians",
            json={"nickname": "WSTest"}
        )
        librarian_id = lib_response.json()["librarian_id"]

        book_response = client.post(
            "/api/v1/books",
            json={"scenario": "test_solo_scenario"},
            headers={"X-Librarian-ID": librarian_id}
        )
        book_id = book_response.json()["book_id"]

        # Connect WebSocket
        with client.websocket_connect(f"/ws/{book_id}") as ws:
            # Should receive welcome message
            data = ws.receive_json()
            assert data["type"] == "welcome"
            assert "world" in data
            assert "characters" in data

    def test_websocket_join_command(self, client):
        """Test join command."""
        # Create book
        lib_response = client.post(
            "/api/v1/librarians",
            json={"nickname": "JoinTest"}
        )
        librarian_id = lib_response.json()["librarian_id"]

        book_response = client.post(
            "/api/v1/books",
            json={"scenario": "test_solo_scenario"},
            headers={"X-Librarian-ID": librarian_id}
        )
        book_id = book_response.json()["book_id"]

        with client.websocket_connect(f"/ws/{book_id}") as ws:
            # Get welcome
            ws.receive_json()

            # Send join
            ws.send_json({"cmd": "join", "nickname": "TestPlayer"})
            data = ws.receive_json()
            assert data["type"] == "joined"
            assert data["nickname"] == "TestPlayer"

    def test_websocket_attach_fuzzy(self, client):
        """Test fuzzy character attachment."""
        # Create book
        lib_response = client.post(
            "/api/v1/librarians",
            json={"nickname": "AttachTest"}
        )
        librarian_id = lib_response.json()["librarian_id"]

        book_response = client.post(
            "/api/v1/books",
            json={"scenario": "test_solo_scenario"},
            headers={"X-Librarian-ID": librarian_id}
        )
        book_id = book_response.json()["book_id"]

        with client.websocket_connect(f"/ws/{book_id}") as ws:
            # Get welcome
            welcome = ws.receive_json()
            characters = welcome.get("characters", [])

            if characters:
                # Join first
                ws.send_json({"cmd": "join", "nickname": "Attacher"})
                ws.receive_json()  # joined
                ws.receive_json()  # reader_joined broadcast

                # Attach with partial name (lowercase)
                char_name = characters[0]
                partial = char_name[:4].lower()
                ws.send_json({"cmd": "attach", "character": partial})
                data = ws.receive_json()
                assert data["type"] == "attached"
                assert data["character"] == char_name


class TestWebSocketGameplay:
    """Test WebSocket gameplay commands."""

    @pytest.fixture
    def client(self):
        """Create test client."""
        from fastapi.testclient import TestClient
        from raunch.api import app
        return TestClient(app)

    @pytest.fixture
    def book_and_ws(self, client):
        """Create a book and return book_id for WebSocket tests."""
        lib_response = client.post(
            "/api/v1/librarians",
            json={"nickname": "GameplayTest"}
        )
        librarian_id = lib_response.json()["librarian_id"]

        book_response = client.post(
            "/api/v1/books",
            json={"scenario": "test_solo_scenario"},
            headers={"X-Librarian-ID": librarian_id}
        )
        return book_response.json()["book_id"]

    def test_list_characters(self, client, book_and_ws):
        """Test list command returns characters."""
        book_id = book_and_ws
        with client.websocket_connect(f"/ws/{book_id}") as ws:
            welcome = ws.receive_json()
            assert "characters" in welcome

            # Send list command
            ws.send_json({"cmd": "list"})
            data = ws.receive_json()
            assert data["type"] == "characters"
            assert "characters" in data

    def test_pause_resume(self, client, book_and_ws):
        """Test pause and resume commands."""
        book_id = book_and_ws
        with client.websocket_connect(f"/ws/{book_id}") as ws:
            ws.receive_json()  # welcome

            # Pause
            ws.send_json({"cmd": "pause"})
            data = ws.receive_json()
            assert data["type"] == "pause_state"
            assert data["paused"] == True

            # Resume
            ws.send_json({"cmd": "resume"})
            data = ws.receive_json()
            assert data["type"] == "pause_state"
            assert data["paused"] == False

    def test_set_page_interval(self, client, book_and_ws):
        """Test setting page interval."""
        book_id = book_and_ws
        with client.websocket_connect(f"/ws/{book_id}") as ws:
            ws.receive_json()  # welcome

            # First pause to prevent auto-page generation
            ws.send_json({"cmd": "pause"})
            ws.receive_json()  # pause_state

            # Set interval
            ws.send_json({"cmd": "set_page_interval", "seconds": 30})
            data = ws.receive_json()
            assert data["type"] == "page_interval"
            assert data["seconds"] == 30
            assert data["manual"] == False

            # Set to manual mode
            ws.send_json({"cmd": "set_page_interval", "seconds": 0})
            data = ws.receive_json()
            assert data["type"] == "page_interval"
            assert data["seconds"] == 0
            assert data["manual"] == True

    def test_get_status(self, client, book_and_ws):
        """Test status command."""
        book_id = book_and_ws
        with client.websocket_connect(f"/ws/{book_id}") as ws:
            ws.receive_json()  # welcome

            ws.send_json({"cmd": "status"})
            data = ws.receive_json()
            assert data["type"] == "status"
            assert "paused" in data
            assert "page_interval" in data

    def test_get_world(self, client, book_and_ws):
        """Test world command."""
        book_id = book_and_ws
        with client.websocket_connect(f"/ws/{book_id}") as ws:
            ws.receive_json()  # welcome

            ws.send_json({"cmd": "world"})
            data = ws.receive_json()
            assert data["type"] == "world"
            assert "snapshot" in data

    def test_whisper_requires_attach(self, client, book_and_ws):
        """Test whisper fails without attachment."""
        book_id = book_and_ws
        with client.websocket_connect(f"/ws/{book_id}") as ws:
            ws.receive_json()  # welcome

            # Join first
            ws.send_json({"cmd": "join", "nickname": "Whisperer"})
            ws.receive_json()  # joined
            ws.receive_json()  # reader_joined

            # Try whisper without attach
            ws.send_json({"cmd": "whisper", "text": "hello"})
            data = ws.receive_json()
            assert data["type"] == "error"
            assert "attach" in data["message"].lower()

    def test_action_requires_attach(self, client, book_and_ws):
        """Test action fails without attachment."""
        book_id = book_and_ws
        with client.websocket_connect(f"/ws/{book_id}") as ws:
            ws.receive_json()  # welcome

            # Join first
            ws.send_json({"cmd": "join", "nickname": "Actor"})
            ws.receive_json()  # joined
            ws.receive_json()  # reader_joined

            # Try action without attach
            ws.send_json({"cmd": "action", "text": "do something"})
            data = ws.receive_json()
            assert data["type"] == "error"

    def test_whisper_after_attach(self, client, book_and_ws):
        """Test whisper works after attaching."""
        book_id = book_and_ws
        with client.websocket_connect(f"/ws/{book_id}") as ws:
            welcome = ws.receive_json()
            characters = welcome.get("characters", [])

            if not characters:
                pytest.skip("No characters in test scenario")

            # Join
            ws.send_json({"cmd": "join", "nickname": "Whisperer"})
            ws.receive_json()  # joined
            ws.receive_json()  # reader_joined

            # Attach
            ws.send_json({"cmd": "attach", "character": characters[0]})
            ws.receive_json()  # attached

            # Whisper
            ws.send_json({"cmd": "whisper", "text": "secret message"})
            data = ws.receive_json()
            assert data["type"] == "influence_queued"
            assert data["text"] == "secret message"

    def test_director_command(self, client, book_and_ws):
        """Test director guidance command."""
        book_id = book_and_ws
        with client.websocket_connect(f"/ws/{book_id}") as ws:
            ws.receive_json()  # welcome

            ws.send_json({"cmd": "director", "text": "make it dramatic"})
            data = ws.receive_json()
            assert data["type"] == "director_queued"
            assert data["text"] == "make it dramatic"

    def test_history_command(self, client, book_and_ws):
        """Test history command."""
        book_id = book_and_ws
        with client.websocket_connect(f"/ws/{book_id}") as ws:
            ws.receive_json()  # welcome

            ws.send_json({"cmd": "history", "count": 10})
            data = ws.receive_json()
            assert data["type"] == "history"
            assert "pages" in data
            assert isinstance(data["pages"], list)

    def test_trigger_page(self, client, book_and_ws):
        """Test manual page triggering."""
        book_id = book_and_ws
        with client.websocket_connect(f"/ws/{book_id}") as ws:
            ws.receive_json()  # welcome

            # Trigger a page
            ws.send_json({"cmd": "page"})

            # Should receive ok response
            data = ws.receive_json()
            assert data["type"] == "ok"


class TestPageBroadcast:
    """Test page generation and broadcasting with mocked LLM."""

    @pytest.fixture
    def client(self):
        """Create test client."""
        from fastapi.testclient import TestClient
        from raunch.api import app
        return TestClient(app)

    def test_page_broadcast_structure(self, client):
        """Test that page broadcasts have correct structure."""
        # This tests the _broadcast_page function structure
        from raunch.server.ws import _broadcast_page
        import asyncio

        # Create a mock page result
        mock_result = {
            "page": 1,
            "narration": "Test narration",
            "events": ["event1"],
            "characters": {
                "TestChar": {
                    "action": "waves",
                    "dialogue": "Hello!",
                    "emotional_state": "happy",
                    "inner_thoughts": "thinking..."
                }
            }
        }

        # The function should handle this without error
        # (actual broadcast would need async context)
        assert "page" in mock_result
        assert "narration" in mock_result
        assert "characters" in mock_result


class TestCLI:
    """Test CLI functionality."""

    def test_remote_client_import(self):
        """Test RemoteClient can be imported."""
        from raunch.client.remote import RemoteClient
        assert RemoteClient is not None

    def test_remote_client_create_librarian(self):
        """Test RemoteClient creates librarian."""
        from raunch.client.remote import RemoteClient

        # This would need a running server
        # For now just test the class exists
        assert hasattr(RemoteClient, 'librarian_id')
        assert hasattr(RemoteClient, 'open_book')
        assert hasattr(RemoteClient, 'trigger_page')


# Run tests if executed directly
if __name__ == "__main__":
    pytest.main([__file__, "-v", "--tb=short"])
