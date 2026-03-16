# raunch/client/remote.py
"""RemoteClient - connects to Living Library server via REST + WebSocket."""

import json
import logging
import queue
import threading
from pathlib import Path
from typing import Optional, List, Tuple, Any, Dict

import httpx

from .base import PageCallback
from .models import (
    Page,
    BookInfo,
    CharacterInfo,
    ReaderInfo,
)

logger = logging.getLogger(__name__)


# Config file location for storing librarian_id
CONFIG_DIR = Path.home() / ".config" / "raunch"
CONFIG_FILE = CONFIG_DIR / "client.json"


def _load_config() -> Dict[str, Any]:
    """Load client config from disk."""
    if CONFIG_FILE.exists():
        try:
            return json.loads(CONFIG_FILE.read_text())
        except (json.JSONDecodeError, OSError):
            pass
    return {}


def _save_config(config: Dict[str, Any]) -> None:
    """Save client config to disk."""
    CONFIG_DIR.mkdir(parents=True, exist_ok=True)
    CONFIG_FILE.write_text(json.dumps(config, indent=2))


class RemoteClient:
    """
    Client that connects to a Living Library server via REST + WebSocket.

    Implements BookClient protocol for remote connections.
    """

    def __init__(
        self,
        server_url: str,
        nickname: str = "Anonymous",
        librarian_id: Optional[str] = None,
    ):
        """
        Initialize RemoteClient.

        Args:
            server_url: Base URL of the server (e.g., "http://localhost:8000")
            nickname: Display name for this user
            librarian_id: Optional existing librarian ID (loaded from config if None)
        """
        self.server_url = server_url.rstrip("/")
        self.nickname = nickname
        self._http = httpx.Client(timeout=30.0)

        # Book/reader state
        self._book_id: Optional[str] = None
        self._reader_id: Optional[str] = None
        self._attached_to: Optional[str] = None
        self._page_callbacks: List[PageCallback] = []

        # WebSocket state (initialized when connecting to book)
        self._ws = None
        self._ws_thread: Optional[threading.Thread] = None
        self._ws_running = False
        self._ws_response_queue: queue.Queue = queue.Queue()
        self._ws_lock = threading.Lock()

        # Load or create librarian
        self._librarian_id = librarian_id
        if not self._librarian_id:
            config = _load_config()
            self._librarian_id = config.get(f"librarian_id:{server_url}")

        if not self._librarian_id:
            self._librarian_id = self._create_librarian(nickname)
            # Save for future use
            config = _load_config()
            config[f"librarian_id:{server_url}"] = self._librarian_id
            _save_config(config)

    def _create_librarian(self, nickname: str) -> str:
        """Create anonymous librarian on server."""
        response = self._http.post(
            f"{self.server_url}/api/v1/librarians",
            json={"nickname": nickname},
        )
        response.raise_for_status()
        data = response.json()
        return data["librarian_id"]

    @property
    def librarian_id(self) -> Optional[str]:
        """Current librarian ID."""
        return self._librarian_id

    @property
    def connected(self) -> bool:
        """Whether client is connected to a book."""
        return self._book_id is not None

    @property
    def book_id(self) -> Optional[str]:
        """Current book ID, if connected."""
        return self._book_id

    @property
    def reader_id(self) -> Optional[str]:
        """Current reader ID, if joined."""
        return self._reader_id

    def _headers(self) -> Dict[str, str]:
        """Get request headers with librarian ID."""
        return {"X-Librarian-ID": self._librarian_id or ""}

    # --- BOOK LIFECYCLE ---

    def open_book(self, scenario: str, private: bool = False) -> Tuple[str, str]:
        """Open a new book from a scenario."""
        response = self._http.post(
            f"{self.server_url}/api/v1/books",
            json={"scenario": scenario, "private": private},
            headers=self._headers(),
        )
        response.raise_for_status()
        data = response.json()

        self._book_id = data["book_id"]
        return data["book_id"], data["bookmark"]

    def close_book(self) -> None:
        """Close the current book (owner only)."""
        if not self._book_id:
            raise ValueError("Not connected to a book")

        response = self._http.delete(
            f"{self.server_url}/api/v1/books/{self._book_id}",
            headers=self._headers(),
        )
        response.raise_for_status()

        self._book_id = None
        self._reader_id = None

    def join_book(self, bookmark: str) -> str:
        """Join an existing book via bookmark."""
        response = self._http.post(
            f"{self.server_url}/api/v1/books/join",
            json={"bookmark": bookmark},
            headers=self._headers(),
        )
        response.raise_for_status()
        data = response.json()

        self._book_id = data["book_id"]
        return data["book_id"]

    def get_book(self) -> Optional[BookInfo]:
        """Get current book information."""
        if not self._book_id:
            return None

        response = self._http.get(
            f"{self.server_url}/api/v1/books/{self._book_id}",
            headers=self._headers(),
        )
        response.raise_for_status()
        return BookInfo.from_dict(response.json())

    def list_books(self) -> List[BookInfo]:
        """List all books accessible to this librarian."""
        response = self._http.get(
            f"{self.server_url}/api/v1/books",
            headers=self._headers(),
        )
        response.raise_for_status()
        return [BookInfo.from_dict(b) for b in response.json()]

    # --- POWER COMMANDS ---

    def pause(self) -> None:
        """Pause page generation."""
        if not self._book_id:
            raise ValueError("Not connected to a book")

        response = self._http.post(
            f"{self.server_url}/api/v1/books/{self._book_id}/pause",
            headers=self._headers(),
        )
        response.raise_for_status()

    def resume(self) -> None:
        """Resume page generation."""
        if not self._book_id:
            raise ValueError("Not connected to a book")

        response = self._http.post(
            f"{self.server_url}/api/v1/books/{self._book_id}/resume",
            headers=self._headers(),
        )
        response.raise_for_status()

    def trigger_page(self) -> bool:
        """Manually trigger next page generation."""
        if not self._book_id:
            return False

        response = self._http.post(
            f"{self.server_url}/api/v1/books/{self._book_id}/page",
            headers=self._headers(),
        )
        response.raise_for_status()
        return response.json().get("triggered", False)

    def set_page_interval(self, seconds: int) -> None:
        """Set page generation interval."""
        if not self._book_id:
            raise ValueError("Not connected to a book")

        response = self._http.put(
            f"{self.server_url}/api/v1/books/{self._book_id}/settings",
            json={"page_interval": seconds},
            headers=self._headers(),
        )
        response.raise_for_status()

    def list_characters(self) -> List[CharacterInfo]:
        """List all characters in the current book."""
        book = self.get_book()
        if not book:
            return []

        # Currently characters are just names in BookInfo
        # Return basic CharacterInfo objects
        return [
            CharacterInfo(name=name, species="")
            for name in book.characters
        ]

    # --- WEBSOCKET METHODS ---

    def connect_ws(self) -> None:
        """Connect WebSocket to current book."""
        if not self._book_id:
            raise ValueError("Not connected to a book")

        from websockets.sync.client import connect as ws_connect

        ws_url = self.server_url.replace("http://", "ws://").replace("https://", "wss://")
        ws_url = f"{ws_url}/ws/{self._book_id}"

        self._ws = ws_connect(ws_url)
        self._ws_running = True
        self._ws_response_queue = queue.Queue()

        # Start receive thread
        self._ws_thread = threading.Thread(target=self._ws_receive_loop, daemon=True)
        self._ws_thread.start()

    def _ws_receive_loop(self) -> None:
        """Background thread to receive WebSocket messages."""
        while self._ws_running and self._ws:
            try:
                message = self._ws.recv(timeout=1.0)
                data = json.loads(message)
                self._handle_ws_message(data)
            except TimeoutError:
                # Normal timeout, continue loop
                continue
            except Exception as e:
                if self._ws_running:
                    logger.debug(f"WebSocket receive error: {e}")
                break

    def _handle_ws_message(self, data: Dict[str, Any]) -> None:
        """Handle incoming WebSocket message."""
        msg_type = data.get("type")

        if msg_type == "page":
            # Async page events go to callbacks
            page = Page.from_dict(data)
            for callback in self._page_callbacks:
                try:
                    callback(page)
                except Exception as e:
                    logger.error(f"Page callback error: {e}")

        elif msg_type == "reader_joined":
            # Broadcast event, not a response to our command
            pass

        elif msg_type == "reader_left":
            # Broadcast event, not a response to our command
            pass

        else:
            # All other messages are responses to commands
            # Put in queue for _ws_send_and_wait
            self._ws_response_queue.put(data)

    def _ws_send(self, data: Dict[str, Any]) -> None:
        """Send message via WebSocket (fire and forget)."""
        if not self._ws:
            raise ValueError("WebSocket not connected")
        with self._ws_lock:
            self._ws.send(json.dumps(data))

    def _ws_send_and_wait(self, data: Dict[str, Any], timeout: float = 5.0) -> Dict[str, Any]:
        """Send message and wait for response from queue."""
        if not self._ws:
            raise ValueError("WebSocket not connected")

        # Clear any stale messages from queue
        while not self._ws_response_queue.empty():
            try:
                self._ws_response_queue.get_nowait()
            except queue.Empty:
                break

        # Send the message
        with self._ws_lock:
            self._ws.send(json.dumps(data))

        # Wait for response from background thread via queue
        try:
            response_data = self._ws_response_queue.get(timeout=timeout)

            # Handle error responses
            if response_data.get("type") == "error":
                raise Exception(response_data.get("message", "Unknown server error"))

            return response_data
        except queue.Empty:
            raise TimeoutError("WebSocket response timeout")

    def join_as_reader(self, nickname: str) -> ReaderInfo:
        """Join the current book as a reader."""
        if not self._ws:
            raise ValueError("WebSocket not connected - use connect_ws() first")

        response = self._ws_send_and_wait({
            "cmd": "join",
            "nickname": nickname,
        })

        self._reader_id = response.get("reader_id")
        return ReaderInfo(
            reader_id=response.get("reader_id", ""),
            nickname=response.get("nickname", nickname),
        )

    def attach(self, character: str) -> None:
        """Attach to a character's POV."""
        if not self._ws:
            raise ValueError("WebSocket not connected - use connect_ws() first")

        response = self._ws_send_and_wait({
            "cmd": "attach",
            "character": character,
        })

        self._attached_to = character

    def detach(self) -> None:
        """Detach from current character."""
        if not self._ws:
            raise ValueError("WebSocket not connected - use connect_ws() first")

        # detach sends a response, so wait for it
        response = self._ws_send_and_wait({"cmd": "detach"})
        self._attached_to = None

    def action(self, text: str) -> None:
        """Submit an action for the attached character."""
        if not self._ws:
            raise ValueError("WebSocket not connected - use connect_ws() first")

        response = self._ws_send_and_wait({"cmd": "action", "text": text})
        # If we get here without exception, action was accepted

    def whisper(self, text: str) -> None:
        """Send a whisper to the attached character."""
        if not self._ws:
            raise ValueError("WebSocket not connected - use connect_ws() first")

        response = self._ws_send_and_wait({"cmd": "whisper", "text": text})
        # If we get here without exception, whisper was accepted

    def director(self, text: str) -> None:
        """Send director guidance."""
        if not self._ws:
            raise ValueError("WebSocket not connected - use connect_ws() first")

        response = self._ws_send_and_wait({"cmd": "director", "text": text})
        # If we get here without exception, director guidance was accepted

    def grab(self, npc_name: str) -> CharacterInfo:
        """Promote NPC to character."""
        # TODO: Implement when server endpoint exists
        raise NotImplementedError("Endpoint not yet implemented")

    def on_page(self, callback: PageCallback) -> None:
        """Register callback for page events."""
        self._page_callbacks.append(callback)

    def disconnect(self) -> None:
        """Disconnect from the current book."""
        self._ws_running = False
        if self._ws:
            try:
                self._ws.close()
            except Exception:
                pass
            self._ws = None

        # Wait for receive thread to finish
        if self._ws_thread and self._ws_thread.is_alive():
            self._ws_thread.join(timeout=1.0)

        self._book_id = None
        self._reader_id = None
        self._attached_to = None

    def __del__(self):
        """Cleanup on deletion."""
        try:
            self.disconnect()
            self._http.close()
        except Exception:
            pass
