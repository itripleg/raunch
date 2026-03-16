# Living Library API Phase 2: Client Module

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Create the client module (`raunch/client/`) that provides a unified interface for both local and remote connections, enabling CLI and future UIs to interact with the Living Library API consistently.

**Architecture:** The client module implements a `BookClient` protocol with two implementations: `LocalClient` (runs orchestrator in-process for `raunch play`) and `RemoteClient` (connects to remote server via REST + WebSocket for `raunch connect`). Both expose identical methods, allowing code to work transparently with either.

**Tech Stack:** Python 3.11+, httpx (REST), websockets (async), pytest

---

## File Structure

```
raunch/client/
├── __init__.py          # Module exports
├── base.py              # BookClient protocol definition
├── models.py            # Shared response types (Page, BookInfo, etc.)
├── remote.py            # RemoteClient - REST + WebSocket to server
└── local.py             # LocalClient - in-process orchestrator (Phase 3)
```

**Import rules:**
- `client/` never imports from `server/` (except for type hints)
- `client/local.py` imports from existing `orchestrator.py`, `world.py`, etc.
- `client/remote.py` only uses `httpx` + `websockets` (network calls)

---

## Chunk 1: Base Protocol & Models

### Task 1: Create client module structure

**Files:**
- Create: `raunch/client/__init__.py`
- Create: `raunch/client/models.py`

- [ ] **Step 1: Create directory**

```bash
mkdir -p raunch/client
```

- [ ] **Step 2: Create client/__init__.py**

```python
# raunch/client/__init__.py
"""Living Library client module - unified interface for local and remote connections."""

# Imports added incrementally as modules are created
__all__ = []
```

- [ ] **Step 3: Create client/models.py with response types**

```python
# raunch/client/models.py
"""Shared response types for the client module."""

from dataclasses import dataclass, field
from datetime import datetime
from typing import Optional, List, Dict, Any


@dataclass
class CharacterInfo:
    """Character information from API."""

    name: str
    species: str
    emotional_state: Optional[str] = None
    attached_by: Optional[str] = None  # reader_id if attached

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> "CharacterInfo":
        return cls(
            name=data.get("name", ""),
            species=data.get("species", ""),
            emotional_state=data.get("emotional_state"),
            attached_by=data.get("attached_by"),
        )


@dataclass
class CharacterPage:
    """Character's response for a single page."""

    name: str
    inner_thoughts: Optional[str] = None
    action: Optional[str] = None
    dialogue: Optional[str] = None
    emotional_state: Optional[str] = None
    desires_update: Optional[str] = None

    @classmethod
    def from_dict(cls, name: str, data: Dict[str, Any]) -> "CharacterPage":
        return cls(
            name=name,
            inner_thoughts=data.get("inner_thoughts"),
            action=data.get("action"),
            dialogue=data.get("dialogue"),
            emotional_state=data.get("emotional_state"),
            desires_update=data.get("desires_update"),
        )


@dataclass
class Page:
    """A page (turn) in the story."""

    page_num: int
    narration: str
    mood: str
    world_time: str
    events: List[str] = field(default_factory=list)
    characters: Dict[str, CharacterPage] = field(default_factory=dict)
    created_at: Optional[str] = None

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> "Page":
        characters = {}
        for name, char_data in data.get("characters", {}).items():
            characters[name] = CharacterPage.from_dict(name, char_data)

        return cls(
            page_num=data.get("page", data.get("page_num", 0)),
            narration=data.get("narration", ""),
            mood=data.get("mood", ""),
            world_time=data.get("world_time", ""),
            events=data.get("events", []),
            characters=characters,
            created_at=data.get("created_at"),
        )


@dataclass
class BookInfo:
    """Book information from API."""

    book_id: str
    bookmark: str
    scenario_name: str
    owner_id: Optional[str] = None
    private: bool = False
    page_count: int = 0
    created_at: Optional[str] = None
    last_active: Optional[str] = None
    characters: List[str] = field(default_factory=list)
    paused: bool = False
    page_interval: int = 30

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> "BookInfo":
        return cls(
            book_id=data.get("book_id", data.get("id", "")),
            bookmark=data.get("bookmark", ""),
            scenario_name=data.get("scenario_name", ""),
            owner_id=data.get("owner_id"),
            private=data.get("private", False),
            page_count=data.get("page_count", 0),
            created_at=data.get("created_at"),
            last_active=data.get("last_active"),
            characters=data.get("characters", []),
            paused=data.get("paused", False),
            page_interval=data.get("page_interval", 30),
        )


@dataclass
class ReaderInfo:
    """Reader information from API."""

    reader_id: str
    nickname: str
    attached_to: Optional[str] = None
    ready: bool = False

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> "ReaderInfo":
        return cls(
            reader_id=data.get("reader_id", ""),
            nickname=data.get("nickname", ""),
            attached_to=data.get("attached_to"),
            ready=data.get("ready", False),
        )


@dataclass
class LibrarianInfo:
    """Librarian (user) information from API."""

    librarian_id: str
    nickname: str
    created_at: Optional[str] = None

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> "LibrarianInfo":
        return cls(
            librarian_id=data.get("librarian_id", data.get("id", "")),
            nickname=data.get("nickname", ""),
            created_at=data.get("created_at"),
        )
```

- [ ] **Step 4: Commit**

```bash
git add raunch/client/
git commit -m "feat(client): create client module with response models"
```

---

### Task 2: Create BookClient protocol

**Files:**
- Create: `raunch/client/base.py`
- Test: `tests/test_client_base.py`

- [ ] **Step 1: Write the test**

```python
# tests/test_client_base.py
"""Tests for BookClient protocol."""

import pytest
from typing import Protocol, runtime_checkable


def test_book_client_protocol_exists():
    """BookClient protocol should be importable."""
    from raunch.client.base import BookClient

    # Should be a Protocol class
    assert hasattr(BookClient, "__protocol_attrs__") or issubclass(BookClient, Protocol)


def test_book_client_has_required_methods():
    """BookClient should define all required methods."""
    from raunch.client.base import BookClient

    # Check key methods exist
    required = [
        "open_book",
        "close_book",
        "join_book",
        "attach",
        "detach",
        "action",
        "whisper",
        "pause",
        "resume",
        "trigger_page",
        "list_characters",
        "on_page",
    ]

    for method in required:
        assert hasattr(BookClient, method), f"Missing method: {method}"
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pytest tests/test_client_base.py -v`
Expected: FAIL - module not found

- [ ] **Step 3: Create BookClient protocol**

```python
# raunch/client/base.py
"""BookClient protocol - unified interface for local and remote connections."""

from typing import Protocol, Callable, Optional, List, Tuple, runtime_checkable

from .models import Page, BookInfo, CharacterInfo, ReaderInfo


PageCallback = Callable[[Page], None]


@runtime_checkable
class BookClient(Protocol):
    """
    Unified interface for interacting with a Living Library book.

    Works identically whether the book is local (in-process) or
    remote (via REST + WebSocket). Implementations:
    - LocalClient: Direct imports, runs orchestrator in-process
    - RemoteClient: REST + WebSocket to remote server
    """

    # ─── CONNECTION ───────────────────────────────────────────────────────

    @property
    def connected(self) -> bool:
        """Whether client is connected to a book."""
        ...

    @property
    def book_id(self) -> Optional[str]:
        """Current book ID, if connected."""
        ...

    @property
    def reader_id(self) -> Optional[str]:
        """Current reader ID, if joined."""
        ...

    # ─── BOOK LIFECYCLE ───────────────────────────────────────────────────

    def open_book(self, scenario: str, private: bool = False) -> Tuple[str, str]:
        """
        Open a new book from a scenario.

        Args:
            scenario: Scenario name to load
            private: Whether book is private (invite-only)

        Returns:
            Tuple of (book_id, bookmark)
        """
        ...

    def close_book(self) -> None:
        """Close the current book (owner only)."""
        ...

    def join_book(self, bookmark: str) -> str:
        """
        Join an existing book via bookmark.

        Args:
            bookmark: Book's join code (e.g., "MILK-1234")

        Returns:
            book_id
        """
        ...

    def get_book(self) -> Optional[BookInfo]:
        """Get current book information."""
        ...

    def list_books(self) -> List[BookInfo]:
        """List all books accessible to this librarian."""
        ...

    # ─── READER/CHARACTER ─────────────────────────────────────────────────

    def join_as_reader(self, nickname: str) -> ReaderInfo:
        """
        Join the current book as a reader.

        Args:
            nickname: Display name for this reader

        Returns:
            ReaderInfo with assigned reader_id
        """
        ...

    def attach(self, character: str) -> None:
        """
        Attach to a character's POV.

        Args:
            character: Character name to attach to
        """
        ...

    def detach(self) -> None:
        """Detach from current character."""
        ...

    def action(self, text: str) -> None:
        """
        Submit an action for the attached character.

        Args:
            text: Action text/intent
        """
        ...

    def whisper(self, text: str) -> None:
        """
        Send an inner voice/whisper to the attached character.

        Args:
            text: Whisper text (influences character's thoughts)
        """
        ...

    def director(self, text: str) -> None:
        """
        Send director guidance (affects all characters).

        Args:
            text: Director guidance text
        """
        ...

    # ─── POWER COMMANDS ───────────────────────────────────────────────────

    def pause(self) -> None:
        """Pause page generation."""
        ...

    def resume(self) -> None:
        """Resume page generation."""
        ...

    def trigger_page(self) -> bool:
        """
        Manually trigger next page generation.

        Returns:
            True if page was triggered, False if couldn't (already running, etc.)
        """
        ...

    def set_page_interval(self, seconds: int) -> None:
        """
        Set page generation interval.

        Args:
            seconds: Interval in seconds (0 = manual mode)
        """
        ...

    def grab(self, npc_name: str) -> CharacterInfo:
        """
        Promote an NPC to a full character.

        Args:
            npc_name: Name of NPC to promote

        Returns:
            CharacterInfo for the new character
        """
        ...

    def list_characters(self) -> List[CharacterInfo]:
        """List all characters in the current book."""
        ...

    # ─── STREAMING ────────────────────────────────────────────────────────

    def on_page(self, callback: PageCallback) -> None:
        """
        Register callback for page events.

        Args:
            callback: Function called when a new page is generated
        """
        ...

    def disconnect(self) -> None:
        """Disconnect from the current book."""
        ...
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pytest tests/test_client_base.py -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add raunch/client/base.py tests/test_client_base.py
git commit -m "feat(client): add BookClient protocol"
```

---

### Task 3: Update client module exports

**Files:**
- Modify: `raunch/client/__init__.py`

- [ ] **Step 1: Update exports**

```python
# raunch/client/__init__.py
"""Living Library client module - unified interface for local and remote connections."""

from .base import BookClient, PageCallback
from .models import (
    Page,
    BookInfo,
    CharacterInfo,
    CharacterPage,
    ReaderInfo,
    LibrarianInfo,
)

__all__ = [
    # Protocol
    "BookClient",
    "PageCallback",
    # Models
    "Page",
    "BookInfo",
    "CharacterInfo",
    "CharacterPage",
    "ReaderInfo",
    "LibrarianInfo",
]
```

- [ ] **Step 2: Commit**

```bash
git add raunch/client/__init__.py
git commit -m "feat(client): update module exports"
```

---

## Chunk 2: RemoteClient REST Implementation

### Task 4: Create RemoteClient with authentication

**Files:**
- Create: `raunch/client/remote.py`
- Test: `tests/test_client_remote.py`

- [ ] **Step 1: Write the failing test**

```python
# tests/test_client_remote.py
"""Tests for RemoteClient."""

import os
import tempfile
import pytest
import threading
import time
import uvicorn

from raunch.client.remote import RemoteClient


@pytest.fixture
def temp_db(monkeypatch):
    """Create a temporary database for testing."""
    with tempfile.TemporaryDirectory() as tmpdir:
        db_path = os.path.join(tmpdir, "test.db")
        monkeypatch.setattr("raunch.db.DB_PATH", db_path)
        monkeypatch.setattr("raunch.db._local", type("Local", (), {})())

        from raunch import db
        db.init_db()
        yield db_path


@pytest.fixture
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


def test_remote_client_creates_librarian(server):
    """RemoteClient should auto-create anonymous librarian."""
    client = RemoteClient(server)

    assert client.librarian_id is not None
    assert len(client.librarian_id) > 0


def test_remote_client_open_book(server):
    """RemoteClient should open a book."""
    client = RemoteClient(server)

    book_id, bookmark = client.open_book("test_scenario")

    assert book_id is not None
    assert bookmark is not None
    assert len(bookmark) == 9  # ABCD-1234


def test_remote_client_list_books(server):
    """RemoteClient should list books."""
    client = RemoteClient(server)

    # Create a book
    book_id, _ = client.open_book("test_scenario")

    # List books
    books = client.list_books()

    assert len(books) >= 1
    assert any(b.book_id == book_id for b in books)


def test_remote_client_join_book(server):
    """RemoteClient should join a book via bookmark."""
    client = RemoteClient(server)

    # Create a book
    _, bookmark = client.open_book("test_scenario")

    # Create new client and join
    client2 = RemoteClient(server)
    book_id = client2.join_book(bookmark)

    assert book_id is not None
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pytest tests/test_client_remote.py::test_remote_client_creates_librarian -v`
Expected: FAIL - module not found

- [ ] **Step 3: Create RemoteClient with REST methods**

```python
# raunch/client/remote.py
"""RemoteClient - connects to Living Library server via REST + WebSocket."""

import json
import logging
import os
import threading
from pathlib import Path
from typing import Optional, List, Tuple, Callable, Any, Dict

import httpx

from .base import BookClient, PageCallback
from .models import (
    Page,
    BookInfo,
    CharacterInfo,
    ReaderInfo,
    LibrarianInfo,
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

    # ─── BOOK LIFECYCLE ───────────────────────────────────────────────────

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

    # ─── POWER COMMANDS ───────────────────────────────────────────────────

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

    # ─── STUBS (WebSocket methods - Task 5) ───────────────────────────────

    def join_as_reader(self, nickname: str) -> ReaderInfo:
        """Join the current book as a reader (requires WebSocket)."""
        raise NotImplementedError("WebSocket connection required - use connect_ws()")

    def attach(self, character: str) -> None:
        """Attach to a character's POV (requires WebSocket)."""
        raise NotImplementedError("WebSocket connection required - use connect_ws()")

    def detach(self) -> None:
        """Detach from current character (requires WebSocket)."""
        raise NotImplementedError("WebSocket connection required - use connect_ws()")

    def action(self, text: str) -> None:
        """Submit an action (requires WebSocket)."""
        raise NotImplementedError("WebSocket connection required - use connect_ws()")

    def whisper(self, text: str) -> None:
        """Send a whisper (requires WebSocket)."""
        raise NotImplementedError("WebSocket connection required - use connect_ws()")

    def director(self, text: str) -> None:
        """Send director guidance (requires WebSocket)."""
        raise NotImplementedError("WebSocket connection required - use connect_ws()")

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
            # Will be implemented in Task 5
            pass

        self._book_id = None
        self._reader_id = None
        self._attached_to = None

    def __del__(self):
        """Cleanup on deletion."""
        self.disconnect()
        self._http.close()
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pytest tests/test_client_remote.py -v`
Expected: All PASS

- [ ] **Step 5: Commit**

```bash
git add raunch/client/remote.py tests/test_client_remote.py
git commit -m "feat(client): add RemoteClient with REST methods"
```

---

### Task 5: Add WebSocket connection to RemoteClient

**Files:**
- Modify: `raunch/client/remote.py`
- Test: `tests/test_client_remote.py`

- [ ] **Step 1: Add WebSocket tests**

```python
# Add to tests/test_client_remote.py

def test_remote_client_websocket_join(server):
    """RemoteClient should join book via WebSocket."""
    client = RemoteClient(server)

    # Create book
    book_id, _ = client.open_book("test_scenario")

    # Connect WebSocket and join as reader
    client.connect_ws()
    reader = client.join_as_reader("TestReader")

    assert reader.reader_id is not None
    assert reader.nickname == "TestReader"

    client.disconnect()


def test_remote_client_websocket_attach(server):
    """RemoteClient should attach to character via WebSocket."""
    client = RemoteClient(server)

    # Create book
    book_id, _ = client.open_book("test_scenario")

    # Need to mock a character existing
    # For now, test that attach raises appropriate error
    client.connect_ws()
    client.join_as_reader("TestReader")

    # Without actual orchestrator, this should fail gracefully
    # The server will respond with "not_found" for non-existent character
    with pytest.raises(Exception):  # Will be refined once server has characters
        client.attach("NonExistent")

    client.disconnect()
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pytest tests/test_client_remote.py::test_remote_client_websocket_join -v`
Expected: FAIL - connect_ws not implemented

- [ ] **Step 3: Add WebSocket implementation**

```python
# Add to raunch/client/remote.py, inside RemoteClient class

import asyncio
import websockets
from websockets.sync.client import connect as ws_connect

# Add these methods to RemoteClient class:

def connect_ws(self) -> None:
    """Connect WebSocket to current book."""
    if not self._book_id:
        raise ValueError("Not connected to a book")

    ws_url = self.server_url.replace("http://", "ws://").replace("https://", "wss://")
    ws_url = f"{ws_url}/ws/{self._book_id}"

    self._ws = ws_connect(ws_url)
    self._ws_running = True

    # Start receive thread
    self._ws_thread = threading.Thread(target=self._ws_receive_loop, daemon=True)
    self._ws_thread.start()

def _ws_receive_loop(self) -> None:
    """Background thread to receive WebSocket messages."""
    while self._ws_running:
        try:
            message = self._ws.recv()
            data = json.loads(message)
            self._handle_ws_message(data)
        except Exception as e:
            if self._ws_running:
                logger.error(f"WebSocket error: {e}")
            break

def _handle_ws_message(self, data: Dict[str, Any]) -> None:
    """Handle incoming WebSocket message."""
    msg_type = data.get("type")

    if msg_type == "page":
        page = Page.from_dict(data)
        for callback in self._page_callbacks:
            try:
                callback(page)
            except Exception as e:
                logger.error(f"Page callback error: {e}")

    elif msg_type == "joined":
        self._reader_id = data.get("reader_id")

    elif msg_type == "attached":
        self._attached_to = data.get("character")

    elif msg_type == "detached":
        self._attached_to = None

    elif msg_type == "error":
        logger.error(f"Server error: {data.get('message')}")
        raise Exception(data.get("message", "Unknown server error"))

def _ws_send(self, data: Dict[str, Any]) -> None:
    """Send message via WebSocket."""
    if not self._ws:
        raise ValueError("WebSocket not connected")
    self._ws.send(json.dumps(data))

def _ws_send_and_wait(self, data: Dict[str, Any], timeout: float = 5.0) -> Dict[str, Any]:
    """Send message and wait for response."""
    if not self._ws:
        raise ValueError("WebSocket not connected")

    # Create event for response
    response_event = threading.Event()
    response_data: Dict[str, Any] = {}

    def capture_response(msg: Dict[str, Any]) -> None:
        nonlocal response_data
        response_data = msg
        response_event.set()

    # Temporarily add callback
    orig_handler = self._handle_ws_message
    def temp_handler(msg: Dict[str, Any]) -> None:
        capture_response(msg)
        orig_handler(msg)

    self._handle_ws_message = temp_handler

    try:
        self._ws.send(json.dumps(data))
        if not response_event.wait(timeout):
            raise TimeoutError("WebSocket response timeout")
        return response_data
    finally:
        self._handle_ws_message = orig_handler

# Update the stub methods:

def join_as_reader(self, nickname: str) -> ReaderInfo:
    """Join the current book as a reader."""
    response = self._ws_send_and_wait({
        "cmd": "join",
        "nickname": nickname,
    })

    if response.get("type") == "error":
        raise Exception(response.get("message"))

    self._reader_id = response.get("reader_id")
    return ReaderInfo(
        reader_id=response.get("reader_id", ""),
        nickname=response.get("nickname", nickname),
    )

def attach(self, character: str) -> None:
    """Attach to a character's POV."""
    response = self._ws_send_and_wait({
        "cmd": "attach",
        "character": character,
    })

    if response.get("type") == "error":
        raise Exception(response.get("message"))

    self._attached_to = character

def detach(self) -> None:
    """Detach from current character."""
    self._ws_send({"cmd": "detach"})
    self._attached_to = None

def action(self, text: str) -> None:
    """Submit an action for the attached character."""
    self._ws_send({"cmd": "action", "text": text})

def whisper(self, text: str) -> None:
    """Send a whisper to the attached character."""
    self._ws_send({"cmd": "whisper", "text": text})

def director(self, text: str) -> None:
    """Send director guidance."""
    self._ws_send({"cmd": "director", "text": text})

def disconnect(self) -> None:
    """Disconnect from the current book."""
    self._ws_running = False
    if self._ws:
        try:
            self._ws.close()
        except Exception:
            pass
        self._ws = None

    self._book_id = None
    self._reader_id = None
    self._attached_to = None
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pytest tests/test_client_remote.py -v`
Expected: All PASS

- [ ] **Step 5: Commit**

```bash
git add raunch/client/remote.py tests/test_client_remote.py
git commit -m "feat(client): add WebSocket connection to RemoteClient"
```

---

### Task 6: Update client module exports

**Files:**
- Modify: `raunch/client/__init__.py`

- [ ] **Step 1: Add RemoteClient export**

```python
# raunch/client/__init__.py
"""Living Library client module - unified interface for local and remote connections."""

from .base import BookClient, PageCallback
from .models import (
    Page,
    BookInfo,
    CharacterInfo,
    CharacterPage,
    ReaderInfo,
    LibrarianInfo,
)
from .remote import RemoteClient

__all__ = [
    # Protocol
    "BookClient",
    "PageCallback",
    # Implementations
    "RemoteClient",
    # Models
    "Page",
    "BookInfo",
    "CharacterInfo",
    "CharacterPage",
    "ReaderInfo",
    "LibrarianInfo",
]
```

- [ ] **Step 2: Commit**

```bash
git add raunch/client/__init__.py
git commit -m "feat(client): export RemoteClient"
```

---

## Chunk 3: Integration Tests & Final Verification

### Task 7: Add integration tests for client-server communication

**Files:**
- Create: `tests/test_client_integration.py`

- [ ] **Step 1: Create integration test file**

```python
# tests/test_client_integration.py
"""Integration tests for client-server communication."""

import os
import tempfile
import pytest
import threading
import time
import uvicorn


@pytest.fixture
def server_with_db(monkeypatch):
    """Start a test server with temp database."""
    with tempfile.TemporaryDirectory() as tmpdir:
        db_path = os.path.join(tmpdir, "test.db")
        monkeypatch.setattr("raunch.db.DB_PATH", db_path)
        monkeypatch.setattr("raunch.db._local", type("Local", (), {})())

        from raunch import db
        db.init_db()

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


def test_full_workflow(server_with_db):
    """Test complete client workflow: create book, connect, interact."""
    from raunch.client import RemoteClient, BookInfo

    # Create client
    client = RemoteClient(server_with_db, nickname="TestUser")
    assert client.librarian_id is not None

    # Open book
    book_id, bookmark = client.open_book("test_scenario")
    assert book_id is not None
    assert len(bookmark) == 9

    # Get book info
    book = client.get_book()
    assert isinstance(book, BookInfo)
    assert book.book_id == book_id
    assert book.scenario_name == "test_scenario"

    # List books
    books = client.list_books()
    assert len(books) >= 1

    # Control commands (these work even without orchestrator)
    client.pause()
    client.resume()

    # Cleanup
    client.close_book()
    assert client.book_id is None


def test_multi_client_join(server_with_db):
    """Test multiple clients joining same book."""
    from raunch.client import RemoteClient

    # Owner creates book
    owner = RemoteClient(server_with_db, nickname="Owner")
    book_id, bookmark = owner.open_book("test_scenario")

    # Second client joins via bookmark
    reader = RemoteClient(server_with_db, nickname="Reader")
    joined_id = reader.join_book(bookmark)

    assert joined_id == book_id

    # Both can see the book
    owner_books = owner.list_books()
    reader_books = reader.list_books()

    assert any(b.book_id == book_id for b in owner_books)
    assert any(b.book_id == book_id for b in reader_books)


def test_book_limit_enforcement(server_with_db):
    """Test that book limit is enforced."""
    from raunch.client import RemoteClient
    import httpx

    client = RemoteClient(server_with_db, nickname="Hoarder")

    # Create books up to limit
    for i in range(5):
        client.open_book(f"scenario_{i}")

    # Next one should fail
    with pytest.raises(httpx.HTTPStatusError) as exc_info:
        client.open_book("one_too_many")

    assert exc_info.value.response.status_code == 400
    assert "Maximum" in exc_info.value.response.text


def test_websocket_join_flow(server_with_db):
    """Test WebSocket join and reader flow."""
    from raunch.client import RemoteClient

    client = RemoteClient(server_with_db, nickname="WSTest")
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
```

- [ ] **Step 2: Run integration tests**

Run: `pytest tests/test_client_integration.py -v`
Expected: All PASS

- [ ] **Step 3: Commit**

```bash
git add tests/test_client_integration.py
git commit -m "test(client): add integration tests for client-server communication"
```

---

### Task 8: Run all tests and verify

- [ ] **Step 1: Run all new tests**

Run: `pytest tests/test_client_base.py tests/test_client_remote.py tests/test_client_integration.py -v`
Expected: All PASS

- [ ] **Step 2: Run existing tests to ensure no regressions**

Run: `pytest tests/ -v`
Expected: All PASS

- [ ] **Step 3: Final commit**

```bash
git add .
git commit -m "feat(client): complete Phase 2 - Living Library client module"
```

---

## Summary

Phase 2 delivers:
- ✅ Client module structure (`raunch/client/`)
- ✅ Response models (Page, BookInfo, CharacterInfo, ReaderInfo, LibrarianInfo)
- ✅ BookClient protocol defining unified interface
- ✅ RemoteClient with REST methods (open, close, join, pause, resume, etc.)
- ✅ RemoteClient WebSocket connection (join_as_reader, attach, action, whisper)
- ✅ Automatic librarian creation and persistence
- ✅ Integration tests for client-server communication

## Deferred to Phase 3

**LocalClient (in-process mode):**
- `raunch/client/local.py`
- Direct orchestrator import, no network calls
- Enables `raunch play milk_money` without server

**CLI Refactor:**
- `raunch/cli/` module using BookClient
- `raunch connect` command for remote connections
- `raunch play` command using LocalClient

## Deferred to Phase 4

- Additional REST endpoints (characters, pages, readers)
- React app migration to new API
- Old `api.py` deprecation
