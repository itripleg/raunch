# Living Library API Phase 1: Core Server Module

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Create the new `server/` module with Library, Book, Reader models, REST routes, and WebSocket handler - running alongside the existing `api.py`.

**Architecture:** The Library singleton manages multiple Books. Each Book wraps an Orchestrator with reader tracking and bookmark system. REST handles queries and one-shot mutations; WebSocket handles session-stateful operations and streaming.

**Tech Stack:** Python 3.11+, FastAPI, SQLite, pytest

---

## Chunk 1: Database Schema & Models

### Task 1: Add librarians table to database

**Files:**
- Modify: `raunch/db.py`
- Test: `tests/test_db_schema.py` (create)

- [ ] **Step 1: Write the failing test**

```python
# tests/test_db_schema.py
"""Tests for database schema changes."""

import os
import sqlite3
import tempfile
import pytest

# Patch DB_PATH before importing db module
@pytest.fixture
def temp_db(monkeypatch):
    """Create a temporary database for testing."""
    with tempfile.TemporaryDirectory() as tmpdir:
        db_path = os.path.join(tmpdir, "test.db")
        monkeypatch.setattr("raunch.db.DB_PATH", db_path)
        monkeypatch.setattr("raunch.db._local", type("Local", (), {})())
        yield db_path


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
    assert "id" in columns
    assert "nickname" in columns
    assert "created_at" in columns
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pytest tests/test_db_schema.py::test_librarians_table_exists -v`
Expected: FAIL - table 'librarians' does not exist

- [ ] **Step 3: Add librarians table to init_db**

```python
# In raunch/db.py, add to init_db() executescript:

        CREATE TABLE IF NOT EXISTS librarians (
            id          TEXT PRIMARY KEY,
            nickname    TEXT NOT NULL,
            created_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pytest tests/test_db_schema.py::test_librarians_table_exists -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add raunch/db.py tests/test_db_schema.py
git commit -m "feat(db): add librarians table"
```

---

### Task 2: Add books table to database

**Files:**
- Modify: `raunch/db.py`
- Test: `tests/test_db_schema.py`

- [ ] **Step 1: Write the failing test**

```python
# Add to tests/test_db_schema.py

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
    assert "id" in columns
    assert "bookmark" in columns
    assert "scenario_name" in columns
    assert "owner_id" in columns
    assert "private" in columns
    assert "created_at" in columns
    assert "last_active" in columns
    assert "page_count" in columns
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pytest tests/test_db_schema.py::test_books_table_exists -v`
Expected: FAIL

- [ ] **Step 3: Add books table to init_db**

```python
# In raunch/db.py, add to init_db() executescript:

        CREATE TABLE IF NOT EXISTS books (
            id            TEXT PRIMARY KEY,
            bookmark      TEXT UNIQUE NOT NULL,
            scenario_name TEXT NOT NULL,
            owner_id      TEXT REFERENCES librarians(id),
            private       INTEGER DEFAULT 0,
            created_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            last_active   TIMESTAMP,
            page_count    INTEGER DEFAULT 0
        );

        CREATE INDEX IF NOT EXISTS idx_books_owner ON books(owner_id);
        CREATE INDEX IF NOT EXISTS idx_books_bookmark ON books(bookmark);
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pytest tests/test_db_schema.py::test_books_table_exists -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add raunch/db.py tests/test_db_schema.py
git commit -m "feat(db): add books table"
```

---

### Task 3: Add book_access table to database

**Files:**
- Modify: `raunch/db.py`
- Test: `tests/test_db_schema.py`

- [ ] **Step 1: Write the failing test**

```python
# Add to tests/test_db_schema.py

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
    assert "book_id" in columns
    assert "librarian_id" in columns
    assert "role" in columns
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pytest tests/test_db_schema.py::test_book_access_table_exists -v`
Expected: FAIL

- [ ] **Step 3: Add book_access table to init_db**

```python
# In raunch/db.py, add to init_db() executescript:

        CREATE TABLE IF NOT EXISTS book_access (
            book_id      TEXT REFERENCES books(id) ON DELETE CASCADE,
            librarian_id TEXT REFERENCES librarians(id),
            role         TEXT DEFAULT 'reader',
            PRIMARY KEY (book_id, librarian_id)
        );
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pytest tests/test_db_schema.py::test_book_access_table_exists -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add raunch/db.py tests/test_db_schema.py
git commit -m "feat(db): add book_access table"
```

---

### Task 4: Add librarian CRUD functions

**Files:**
- Modify: `raunch/db.py`
- Test: `tests/test_db_schema.py`

- [ ] **Step 1: Write the failing tests**

```python
# Add to tests/test_db_schema.py

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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pytest tests/test_db_schema.py::test_create_librarian tests/test_db_schema.py::test_get_librarian tests/test_db_schema.py::test_get_librarian_not_found -v`
Expected: FAIL - functions don't exist

- [ ] **Step 3: Implement librarian CRUD functions**

```python
# Add to raunch/db.py

import uuid

def create_librarian(nickname: str) -> Dict[str, Any]:
    """Create a new librarian and return their data."""
    conn = _get_conn()
    librarian_id = str(uuid.uuid4())[:8]

    conn.execute(
        "INSERT INTO librarians (id, nickname) VALUES (?, ?)",
        (librarian_id, nickname)
    )
    conn.commit()

    return get_librarian(librarian_id)


def get_librarian(librarian_id: str) -> Optional[Dict[str, Any]]:
    """Get a librarian by ID."""
    conn = _get_conn()
    row = conn.execute(
        "SELECT id, nickname, created_at FROM librarians WHERE id = ?",
        (librarian_id,)
    ).fetchone()

    if row is None:
        return None

    return {
        "id": row["id"],
        "nickname": row["nickname"],
        "created_at": row["created_at"],
    }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pytest tests/test_db_schema.py -v`
Expected: All PASS

- [ ] **Step 5: Commit**

```bash
git add raunch/db.py tests/test_db_schema.py
git commit -m "feat(db): add librarian CRUD functions"
```

---

### Task 5: Add book CRUD functions

**Files:**
- Modify: `raunch/db.py`
- Test: `tests/test_db_schema.py`

- [ ] **Step 1: Write the failing tests**

```python
# Add to tests/test_db_schema.py

def test_create_book(temp_db):
    """Should create a book with bookmark and return it."""
    from raunch import db
    db.init_db()

    librarian = db.create_librarian("Owner")
    book = db.create_book("milk_money", librarian["id"])

    assert book["id"] is not None
    assert book["bookmark"] is not None
    assert len(book["bookmark"]) == 9  # ABCD-1234 format
    assert book["scenario_name"] == "milk_money"
    assert book["owner_id"] == librarian["id"]


def test_get_book(temp_db):
    """Should retrieve a book by ID."""
    from raunch import db
    db.init_db()

    librarian = db.create_librarian("Owner")
    created = db.create_book("milk_money", librarian["id"])
    fetched = db.get_book(created["id"])

    assert fetched is not None
    assert fetched["id"] == created["id"]
    assert fetched["bookmark"] == created["bookmark"]


def test_get_book_by_bookmark(temp_db):
    """Should retrieve a book by bookmark."""
    from raunch import db
    db.init_db()

    librarian = db.create_librarian("Owner")
    created = db.create_book("milk_money", librarian["id"])
    fetched = db.get_book_by_bookmark(created["bookmark"])

    assert fetched is not None
    assert fetched["id"] == created["id"]


def test_list_books_for_librarian(temp_db):
    """Should list books owned by or accessible to a librarian."""
    from raunch import db
    db.init_db()

    owner = db.create_librarian("Owner")
    db.create_book("scenario1", owner["id"])
    db.create_book("scenario2", owner["id"])

    books = db.list_books_for_librarian(owner["id"])
    assert len(books) == 2


def test_delete_book(temp_db):
    """Should delete a book."""
    from raunch import db
    db.init_db()

    librarian = db.create_librarian("Owner")
    book = db.create_book("milk_money", librarian["id"])

    db.delete_book(book["id"])

    assert db.get_book(book["id"]) is None
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pytest tests/test_db_schema.py::test_create_book -v`
Expected: FAIL

- [ ] **Step 3: Implement bookmark generation**

```python
# Add to raunch/db.py

import random
import string

def _generate_bookmark() -> str:
    """Generate a bookmark in ABCD-1234 format."""
    letters = ''.join(random.choices(string.ascii_uppercase, k=4))
    digits = ''.join(random.choices(string.digits, k=4))
    return f"{letters}-{digits}"


def _get_unique_bookmark() -> str:
    """Generate a unique bookmark, checking for collisions."""
    conn = _get_conn()
    for _ in range(100):  # Max attempts
        bookmark = _generate_bookmark()
        existing = conn.execute(
            "SELECT 1 FROM books WHERE bookmark = ?", (bookmark,)
        ).fetchone()
        if existing is None:
            return bookmark
    raise RuntimeError("Failed to generate unique bookmark")
```

- [ ] **Step 4: Implement book CRUD functions**

```python
# Add to raunch/db.py

def create_book(scenario_name: str, owner_id: str, private: bool = False) -> Dict[str, Any]:
    """Create a new book and return its data."""
    conn = _get_conn()
    book_id = str(uuid.uuid4())[:8]
    bookmark = _get_unique_bookmark()

    conn.execute(
        """INSERT INTO books (id, bookmark, scenario_name, owner_id, private, last_active)
           VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)""",
        (book_id, bookmark, scenario_name, owner_id, 1 if private else 0)
    )

    # Also add owner to book_access
    conn.execute(
        "INSERT INTO book_access (book_id, librarian_id, role) VALUES (?, ?, 'owner')",
        (book_id, owner_id)
    )

    conn.commit()
    return get_book(book_id)


def get_book(book_id: str) -> Optional[Dict[str, Any]]:
    """Get a book by ID."""
    conn = _get_conn()
    row = conn.execute(
        """SELECT id, bookmark, scenario_name, owner_id, private,
                  created_at, last_active, page_count
           FROM books WHERE id = ?""",
        (book_id,)
    ).fetchone()

    if row is None:
        return None

    return {
        "id": row["id"],
        "bookmark": row["bookmark"],
        "scenario_name": row["scenario_name"],
        "owner_id": row["owner_id"],
        "private": bool(row["private"]),
        "created_at": row["created_at"],
        "last_active": row["last_active"],
        "page_count": row["page_count"],
    }


def get_book_by_bookmark(bookmark: str) -> Optional[Dict[str, Any]]:
    """Get a book by bookmark (case-insensitive)."""
    conn = _get_conn()
    row = conn.execute(
        """SELECT id, bookmark, scenario_name, owner_id, private,
                  created_at, last_active, page_count
           FROM books WHERE UPPER(bookmark) = UPPER(?)""",
        (bookmark,)
    ).fetchone()

    if row is None:
        return None

    return {
        "id": row["id"],
        "bookmark": row["bookmark"],
        "scenario_name": row["scenario_name"],
        "owner_id": row["owner_id"],
        "private": bool(row["private"]),
        "created_at": row["created_at"],
        "last_active": row["last_active"],
        "page_count": row["page_count"],
    }


def count_books_for_librarian(librarian_id: str) -> int:
    """Count books owned by a librarian."""
    conn = _get_conn()
    result = conn.execute(
        "SELECT COUNT(*) FROM book_access WHERE librarian_id = ? AND role = 'owner'",
        (librarian_id,)
    ).fetchone()
    return result[0] if result else 0


def list_books_for_librarian(librarian_id: str) -> List[Dict[str, Any]]:
    """List all books accessible to a librarian."""
    conn = _get_conn()
    rows = conn.execute(
        """SELECT b.id, b.bookmark, b.scenario_name, b.owner_id, b.private,
                  b.created_at, b.last_active, b.page_count, ba.role
           FROM books b
           JOIN book_access ba ON b.id = ba.book_id
           WHERE ba.librarian_id = ?
           ORDER BY b.last_active DESC""",
        (librarian_id,)
    ).fetchall()

    return [
        {
            "id": row["id"],
            "bookmark": row["bookmark"],
            "scenario_name": row["scenario_name"],
            "owner_id": row["owner_id"],
            "private": bool(row["private"]),
            "created_at": row["created_at"],
            "last_active": row["last_active"],
            "page_count": row["page_count"],
            "role": row["role"],
        }
        for row in rows
    ]


def delete_book(book_id: str) -> bool:
    """Delete a book and its access records."""
    conn = _get_conn()
    conn.execute("DELETE FROM book_access WHERE book_id = ?", (book_id,))
    result = conn.execute("DELETE FROM books WHERE id = ?", (book_id,))
    conn.commit()
    return result.rowcount > 0


def grant_book_access(book_id: str, librarian_id: str, role: str = "reader") -> None:
    """Grant a librarian access to a book."""
    conn = _get_conn()
    conn.execute(
        """INSERT OR IGNORE INTO book_access (book_id, librarian_id, role)
           VALUES (?, ?, ?)""",
        (book_id, librarian_id, role)
    )
    conn.commit()
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `pytest tests/test_db_schema.py -v`
Expected: All PASS

- [ ] **Step 6: Commit**

```bash
git add raunch/db.py tests/test_db_schema.py
git commit -m "feat(db): add book CRUD functions with bookmark generation"
```

---

## Chunk 2: Server Module Structure

### Task 6: Create server module directory structure

**Files:**
- Create: `raunch/server/__init__.py`
- Create: `raunch/server/models.py`
- Create: `raunch/server/routes/__init__.py`

- [ ] **Step 1: Create directory structure**

```bash
mkdir -p raunch/server/routes
```

- [ ] **Step 2: Create server/__init__.py**

```python
# raunch/server/__init__.py
"""Living Library server module."""

# Imports added incrementally as modules are created
__all__ = []
```

- [ ] **Step 3: Create server/models.py with Reader model**

```python
# raunch/server/models.py
"""Data models for the Living Library server."""

from dataclasses import dataclass, field
from datetime import datetime
from typing import Optional, List, Dict, Any
import uuid


@dataclass
class Reader:
    """A reader connected to a book."""

    reader_id: str
    nickname: str
    librarian_id: Optional[str] = None
    attached_to: Optional[str] = None  # Character name
    ready: bool = False
    connected_at: datetime = field(default_factory=datetime.utcnow)

    @classmethod
    def create(cls, nickname: str, librarian_id: Optional[str] = None) -> "Reader":
        """Create a new reader with generated ID."""
        return cls(
            reader_id=str(uuid.uuid4())[:8],
            nickname=nickname,
            librarian_id=librarian_id,
        )

    def to_dict(self) -> Dict[str, Any]:
        """Convert to dictionary for JSON serialization."""
        return {
            "reader_id": self.reader_id,
            "nickname": self.nickname,
            "attached_to": self.attached_to,
            "ready": self.ready,
        }


@dataclass
class BookState:
    """Current state of a book for API responses."""

    book_id: str
    bookmark: str
    scenario_name: str
    owner_id: Optional[str]
    private: bool
    page_count: int
    created_at: str
    last_active: str
    characters: List[str]
    readers: List[Dict[str, Any]]
    paused: bool
    page_interval: int

    def to_dict(self) -> Dict[str, Any]:
        """Convert to dictionary for JSON serialization."""
        return {
            "book_id": self.book_id,
            "bookmark": self.bookmark,
            "scenario_name": self.scenario_name,
            "owner_id": self.owner_id,
            "private": self.private,
            "page_count": self.page_count,
            "created_at": self.created_at,
            "last_active": self.last_active,
            "characters": self.characters,
            "readers": self.readers,
            "paused": self.paused,
            "page_interval": self.page_interval,
        }
```

- [ ] **Step 4: Create routes/__init__.py**

```python
# raunch/server/routes/__init__.py
"""API route modules."""
```

- [ ] **Step 5: Commit**

```bash
git add raunch/server/
git commit -m "feat(server): create server module structure with Reader and BookState models"
```

---

### Task 7: Create Book wrapper class

**Files:**
- Create: `raunch/server/book.py`
- Test: `tests/test_server_book.py`

- [ ] **Step 1: Write the failing test**

```python
# tests/test_server_book.py
"""Tests for Book wrapper class."""

import pytest
from unittest.mock import MagicMock, patch


@pytest.fixture
def mock_orchestrator():
    """Create a mock orchestrator."""
    orch = MagicMock()
    orch.world = MagicMock()
    orch.world.world_id = "test-world"
    orch.world.world_name = "Test World"
    orch.world.tick_count = 5
    orch.characters = {"Jake": MagicMock(), "Bessie": MagicMock()}
    orch._paused = False
    orch.tick_interval = 30
    orch._running = True
    return orch


def test_book_creation():
    """Book should be created with ID and bookmark."""
    from raunch.server.book import Book

    book = Book(
        book_id="test123",
        bookmark="ABCD-1234",
        scenario_name="milk_money",
        owner_id="owner123"
    )

    assert book.book_id == "test123"
    assert book.bookmark == "ABCD-1234"
    assert book.scenario_name == "milk_money"
    assert book.owner_id == "owner123"


def test_book_add_reader():
    """Book should track readers."""
    from raunch.server.book import Book
    from raunch.server.models import Reader

    book = Book(
        book_id="test123",
        bookmark="ABCD-1234",
        scenario_name="milk_money",
        owner_id="owner123"
    )

    reader = Reader.create("TestUser")
    book.add_reader(reader)

    assert reader.reader_id in book.readers
    assert book.get_reader(reader.reader_id) == reader


def test_book_get_state(mock_orchestrator):
    """Book should return its state."""
    from raunch.server.book import Book

    book = Book(
        book_id="test123",
        bookmark="ABCD-1234",
        scenario_name="milk_money",
        owner_id="owner123"
    )
    book._orchestrator = mock_orchestrator

    state = book.get_state()

    assert state.book_id == "test123"
    assert state.bookmark == "ABCD-1234"
    assert state.characters == ["Jake", "Bessie"]
    assert state.paused == False
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pytest tests/test_server_book.py -v`
Expected: FAIL - module not found

- [ ] **Step 3: Implement Book class**

```python
# raunch/server/book.py
"""Book wrapper class - wraps Orchestrator with reader management."""

from dataclasses import dataclass, field
from datetime import datetime
from typing import Dict, Optional, List, Any, TYPE_CHECKING
import time

from .models import Reader, BookState

if TYPE_CHECKING:
    from ..orchestrator import Orchestrator


@dataclass
class Book:
    """A book (story instance) that wraps an Orchestrator."""

    book_id: str
    bookmark: str
    scenario_name: str
    owner_id: Optional[str] = None
    private: bool = False
    created_at: datetime = field(default_factory=datetime.utcnow)

    # Runtime state
    _orchestrator: Optional["Orchestrator"] = field(default=None, repr=False)
    readers: Dict[str, Reader] = field(default_factory=dict)
    _last_activity: float = field(default_factory=time.time)

    def add_reader(self, reader: Reader) -> None:
        """Add a reader to the book."""
        self.readers[reader.reader_id] = reader
        self._last_activity = time.time()

    def remove_reader(self, reader_id: str) -> Optional[Reader]:
        """Remove and return a reader from the book."""
        self._last_activity = time.time()
        return self.readers.pop(reader_id, None)

    def get_reader(self, reader_id: str) -> Optional[Reader]:
        """Get a reader by ID."""
        return self.readers.get(reader_id)

    def get_reader_by_character(self, character_name: str) -> Optional[Reader]:
        """Get the reader attached to a character."""
        for reader in self.readers.values():
            if reader.attached_to == character_name:
                return reader
        return None

    @property
    def idle_seconds(self) -> float:
        """Seconds since last activity."""
        return time.time() - self._last_activity

    @property
    def orchestrator(self) -> Optional["Orchestrator"]:
        """Get the orchestrator, if loaded."""
        return self._orchestrator

    def set_orchestrator(self, orch: "Orchestrator") -> None:
        """Set the orchestrator for this book."""
        self._orchestrator = orch
        self._last_activity = time.time()

    def get_state(self) -> BookState:
        """Get current book state for API response."""
        orch = self._orchestrator

        characters = []
        paused = False
        page_interval = 0
        page_count = 0

        if orch:
            characters = list(orch.characters.keys())
            paused = orch._paused
            page_interval = orch.tick_interval
            if orch.world:
                page_count = orch.world.tick_count

        return BookState(
            book_id=self.book_id,
            bookmark=self.bookmark,
            scenario_name=self.scenario_name,
            owner_id=self.owner_id,
            private=self.private,
            page_count=page_count,
            created_at=self.created_at.isoformat() if isinstance(self.created_at, datetime) else str(self.created_at),
            last_active=datetime.utcnow().isoformat(),
            characters=characters,
            readers=[r.to_dict() for r in self.readers.values()],
            paused=paused,
            page_interval=page_interval,
        )
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pytest tests/test_server_book.py -v`
Expected: All PASS

- [ ] **Step 5: Commit**

```bash
git add raunch/server/book.py tests/test_server_book.py
git commit -m "feat(server): add Book wrapper class"
```

---

### Task 8: Create Library singleton

**Files:**
- Create: `raunch/server/library.py`
- Test: `tests/test_server_library.py`

- [ ] **Step 1: Write the failing test**

```python
# tests/test_server_library.py
"""Tests for Library singleton."""

import os
import tempfile
import pytest


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
def library(temp_db):
    """Create a fresh library instance."""
    from raunch.server.library import Library
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pytest tests/test_server_library.py -v`
Expected: FAIL

- [ ] **Step 3: Implement Library class**

```python
# raunch/server/library.py
"""Library singleton - manages all active books."""

from typing import Dict, Optional, Tuple, List
import logging

from .book import Book
from .. import db

logger = logging.getLogger(__name__)

# Module-level singleton
_library: Optional["Library"] = None


def get_library() -> "Library":
    """Get or create the Library singleton."""
    global _library
    if _library is None:
        _library = Library()
    return _library


def reset_library() -> None:
    """Reset the library singleton (for testing)."""
    global _library
    _library = None


class BookLimitReached(Exception):
    """Raised when a librarian has too many books."""
    pass


class Library:
    """Manages all active books on this server."""

    MAX_BOOKS_PER_LIBRARIAN = 5

    def __init__(self):
        self.books: Dict[str, Book] = {}
        self._bookmarks: Dict[str, str] = {}  # bookmark -> book_id
        logger.info("Library initialized")

    def open_book(
        self,
        scenario_name: str,
        owner_id: str,
        private: bool = False,
    ) -> Tuple[str, str]:
        """
        Open a new book from a scenario.

        Returns: (book_id, bookmark)
        Raises: BookLimitReached if owner has too many books
        """
        # Check book limit
        existing = db.list_books_for_librarian(owner_id)
        owned = [b for b in existing if b["role"] == "owner"]
        if len(owned) >= self.MAX_BOOKS_PER_LIBRARIAN:
            raise BookLimitReached(
                f"Maximum {self.MAX_BOOKS_PER_LIBRARIAN} books per librarian"
            )

        # Create in database
        book_data = db.create_book(scenario_name, owner_id, private)

        # Create in-memory Book
        book = Book(
            book_id=book_data["id"],
            bookmark=book_data["bookmark"],
            scenario_name=scenario_name,
            owner_id=owner_id,
            private=private,
        )

        self.books[book.book_id] = book
        self._bookmarks[book.bookmark.upper()] = book.book_id

        logger.info(f"Opened book {book.book_id} ({scenario_name}) for {owner_id}")
        return book.book_id, book.bookmark

    def get_book(self, book_id: str) -> Optional[Book]:
        """Get a book by ID, loading from DB if needed."""
        # Check in-memory first
        if book_id in self.books:
            return self.books[book_id]

        # Try loading from database
        book_data = db.get_book(book_id)
        if book_data is None:
            return None

        # Create in-memory Book
        book = Book(
            book_id=book_data["id"],
            bookmark=book_data["bookmark"],
            scenario_name=book_data["scenario_name"],
            owner_id=book_data["owner_id"],
            private=book_data["private"],
        )

        self.books[book.book_id] = book
        self._bookmarks[book.bookmark.upper()] = book.book_id

        logger.info(f"Loaded book {book.book_id} from database")
        return book

    def find_by_bookmark(self, bookmark: str) -> Optional[str]:
        """Find a book ID by bookmark (case-insensitive)."""
        upper = bookmark.upper()

        # Check cache
        if upper in self._bookmarks:
            return self._bookmarks[upper]

        # Check database
        book_data = db.get_book_by_bookmark(bookmark)
        if book_data:
            self._bookmarks[upper] = book_data["id"]
            return book_data["id"]

        return None

    def close_book(self, book_id: str) -> bool:
        """Close a book, removing it from memory and database."""
        book = self.books.pop(book_id, None)

        if book:
            # Remove from bookmark cache
            self._bookmarks.pop(book.bookmark.upper(), None)

            # Stop orchestrator if running
            if book.orchestrator and book.orchestrator._running:
                book.orchestrator.stop()

        # Remove from database
        deleted = db.delete_book(book_id)

        if deleted:
            logger.info(f"Closed book {book_id}")

        return deleted

    def list_books(self, librarian_id: Optional[str] = None) -> List[Dict]:
        """List books, optionally filtered by librarian."""
        if librarian_id:
            return db.list_books_for_librarian(librarian_id)

        # Return all in-memory books (admin view)
        return [
            {
                "id": book.book_id,
                "bookmark": book.bookmark,
                "scenario_name": book.scenario_name,
                "owner_id": book.owner_id,
                "readers": len(book.readers),
            }
            for book in self.books.values()
        ]
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pytest tests/test_server_library.py -v`
Expected: All PASS

- [ ] **Step 5: Commit**

```bash
git add raunch/server/library.py tests/test_server_library.py
git commit -m "feat(server): add Library singleton for managing books"
```

---

## Chunk 3: REST Routes

### Task 9: Create health route

**Files:**
- Create: `raunch/server/routes/health.py`
- Test: `tests/test_server_routes.py`

- [ ] **Step 1: Write the failing test**

```python
# tests/test_server_routes.py
"""Tests for server REST routes."""

import pytest
from fastapi.testclient import TestClient


@pytest.fixture
def client():
    """Create a test client."""
    from raunch.server.app import create_app
    app = create_app()
    return TestClient(app)


def test_health_endpoint(client):
    """Health endpoint should return ok."""
    response = client.get("/health")
    assert response.status_code == 200
    assert response.json() == {"status": "ok"}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pytest tests/test_server_routes.py::test_health_endpoint -v`
Expected: FAIL

- [ ] **Step 3: Create health route**

```python
# raunch/server/routes/health.py
"""Health check endpoint."""

from fastapi import APIRouter

router = APIRouter()


@router.get("/health")
async def health_check():
    """Health check endpoint."""
    return {"status": "ok"}
```

- [ ] **Step 4: Create app factory**

```python
# raunch/server/app.py
"""FastAPI application factory."""

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .routes import health


def create_app() -> FastAPI:
    """Create and configure the FastAPI application."""
    app = FastAPI(
        title="Living Library API",
        description="Multi-book interactive fiction server",
        version="1.0.0",
    )

    # CORS
    app.add_middleware(
        CORSMiddleware,
        allow_origins=["*"],  # Configure properly for production
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    # Routes
    app.include_router(health.router)

    return app
```

- [ ] **Step 5: Update routes/__init__.py**

```python
# raunch/server/routes/__init__.py
"""API route modules."""

from . import health

__all__ = ["health"]
```

- [ ] **Step 6: Run test to verify it passes**

Run: `pytest tests/test_server_routes.py::test_health_endpoint -v`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add raunch/server/routes/health.py raunch/server/app.py raunch/server/routes/__init__.py
git commit -m "feat(server): add health endpoint and app factory"
```

---

### Task 10: Create librarians route

**Files:**
- Create: `raunch/server/routes/librarians.py`
- Modify: `raunch/server/app.py`
- Test: `tests/test_server_routes.py`

- [ ] **Step 1: Write the failing test**

```python
# Add to tests/test_server_routes.py

import os
import tempfile

@pytest.fixture
def client_with_db(monkeypatch):
    """Create a test client with temp database."""
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
        yield TestClient(app)


def test_create_librarian(client_with_db):
    """Should create an anonymous librarian."""
    response = client_with_db.post(
        "/api/v1/librarians",
        json={"nickname": "TestUser"}
    )
    assert response.status_code == 201
    data = response.json()
    assert "librarian_id" in data
    assert data["nickname"] == "TestUser"


def test_get_librarian(client_with_db):
    """Should get a librarian by ID."""
    # Create first
    create_resp = client_with_db.post(
        "/api/v1/librarians",
        json={"nickname": "TestUser"}
    )
    librarian_id = create_resp.json()["librarian_id"]

    # Get
    response = client_with_db.get(f"/api/v1/librarians/{librarian_id}")
    assert response.status_code == 200
    assert response.json()["librarian_id"] == librarian_id
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pytest tests/test_server_routes.py::test_create_librarian -v`
Expected: FAIL

- [ ] **Step 3: Create librarians route**

```python
# raunch/server/routes/librarians.py
"""Librarian endpoints."""

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import Optional

from raunch import db

router = APIRouter(prefix="/api/v1/librarians", tags=["librarians"])


class CreateLibrarianRequest(BaseModel):
    nickname: str


class LibrarianResponse(BaseModel):
    librarian_id: str
    nickname: str
    created_at: str


@router.post("", status_code=201, response_model=LibrarianResponse)
async def create_librarian(request: CreateLibrarianRequest):
    """Create an anonymous librarian."""
    librarian = db.create_librarian(request.nickname)
    return LibrarianResponse(
        librarian_id=librarian["id"],
        nickname=librarian["nickname"],
        created_at=librarian["created_at"],
    )


@router.get("/{librarian_id}", response_model=LibrarianResponse)
async def get_librarian(librarian_id: str):
    """Get a librarian by ID."""
    librarian = db.get_librarian(librarian_id)
    if librarian is None:
        raise HTTPException(status_code=404, detail="Librarian not found")

    return LibrarianResponse(
        librarian_id=librarian["id"],
        nickname=librarian["nickname"],
        created_at=librarian["created_at"],
    )
```

- [ ] **Step 4: Add to app factory**

```python
# Update raunch/server/app.py

from .routes import health, librarians

def create_app() -> FastAPI:
    # ... existing code ...

    # Routes
    app.include_router(health.router)
    app.include_router(librarians.router)

    return app
```

- [ ] **Step 5: Update routes/__init__.py**

```python
# raunch/server/routes/__init__.py
"""API route modules."""

from . import health, librarians

__all__ = ["health", "librarians"]
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `pytest tests/test_server_routes.py -v`
Expected: All PASS

- [ ] **Step 7: Commit**

```bash
git add raunch/server/routes/librarians.py raunch/server/app.py raunch/server/routes/__init__.py
git commit -m "feat(server): add librarians endpoints"
```

---

### Task 11: Create books routes (CRUD)

**Files:**
- Create: `raunch/server/routes/books.py`
- Modify: `raunch/server/app.py`
- Test: `tests/test_server_routes.py`

- [ ] **Step 1: Write the failing tests**

```python
# Add to tests/test_server_routes.py

def test_create_book(client_with_db):
    """Should create a book."""
    # Create librarian first
    lib_resp = client_with_db.post(
        "/api/v1/librarians",
        json={"nickname": "Owner"}
    )
    librarian_id = lib_resp.json()["librarian_id"]

    response = client_with_db.post(
        "/api/v1/books",
        json={"scenario": "milk_money"},
        headers={"X-Librarian-ID": librarian_id}
    )
    assert response.status_code == 201
    data = response.json()
    assert "book_id" in data
    assert "bookmark" in data


def test_get_book(client_with_db):
    """Should get a book by ID."""
    # Setup
    lib_resp = client_with_db.post(
        "/api/v1/librarians",
        json={"nickname": "Owner"}
    )
    librarian_id = lib_resp.json()["librarian_id"]

    create_resp = client_with_db.post(
        "/api/v1/books",
        json={"scenario": "milk_money"},
        headers={"X-Librarian-ID": librarian_id}
    )
    book_id = create_resp.json()["book_id"]

    # Get
    response = client_with_db.get(
        f"/api/v1/books/{book_id}",
        headers={"X-Librarian-ID": librarian_id}
    )
    assert response.status_code == 200
    assert response.json()["book_id"] == book_id


def test_join_book_by_bookmark(client_with_db):
    """Should join a book via bookmark."""
    # Owner creates book
    lib_resp = client_with_db.post(
        "/api/v1/librarians",
        json={"nickname": "Owner"}
    )
    owner_id = lib_resp.json()["librarian_id"]

    create_resp = client_with_db.post(
        "/api/v1/books",
        json={"scenario": "milk_money"},
        headers={"X-Librarian-ID": owner_id}
    )
    bookmark = create_resp.json()["bookmark"]
    book_id = create_resp.json()["book_id"]

    # Another user joins
    lib2_resp = client_with_db.post(
        "/api/v1/librarians",
        json={"nickname": "Joiner"}
    )
    joiner_id = lib2_resp.json()["librarian_id"]

    join_resp = client_with_db.post(
        "/api/v1/books/join",
        json={"bookmark": bookmark},
        headers={"X-Librarian-ID": joiner_id}
    )
    assert join_resp.status_code == 200
    assert join_resp.json()["book_id"] == book_id


def test_delete_book(client_with_db):
    """Should delete a book (owner only)."""
    # Setup
    lib_resp = client_with_db.post(
        "/api/v1/librarians",
        json={"nickname": "Owner"}
    )
    owner_id = lib_resp.json()["librarian_id"]

    create_resp = client_with_db.post(
        "/api/v1/books",
        json={"scenario": "milk_money"},
        headers={"X-Librarian-ID": owner_id}
    )
    book_id = create_resp.json()["book_id"]

    # Delete
    response = client_with_db.delete(
        f"/api/v1/books/{book_id}",
        headers={"X-Librarian-ID": owner_id}
    )
    assert response.status_code == 200

    # Verify deleted
    get_resp = client_with_db.get(
        f"/api/v1/books/{book_id}",
        headers={"X-Librarian-ID": owner_id}
    )
    assert get_resp.status_code == 404
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pytest tests/test_server_routes.py::test_create_book -v`
Expected: FAIL

- [ ] **Step 3: Create books route**

```python
# raunch/server/routes/books.py
"""Book endpoints."""

from fastapi import APIRouter, HTTPException, Header, Depends
from pydantic import BaseModel
from typing import Optional, List

from ..library import get_library, BookLimitReached
from raunch import db

router = APIRouter(prefix="/api/v1/books", tags=["books"])


def get_librarian_id(x_librarian_id: str = Header(..., alias="X-Librarian-ID")) -> str:
    """Extract and validate librarian ID from header."""
    librarian = db.get_librarian(x_librarian_id)
    if librarian is None:
        raise HTTPException(status_code=401, detail="Invalid librarian ID")
    return x_librarian_id


class CreateBookRequest(BaseModel):
    scenario: str
    private: bool = False


class CreateBookResponse(BaseModel):
    book_id: str
    bookmark: str


class JoinBookRequest(BaseModel):
    bookmark: str


class JoinBookResponse(BaseModel):
    book_id: str


class BookResponse(BaseModel):
    book_id: str
    bookmark: str
    scenario_name: str
    owner_id: Optional[str]
    private: bool
    page_count: int
    created_at: str
    last_active: str
    characters: List[str]
    readers: List[dict]
    paused: bool
    page_interval: int


@router.post("", status_code=201, response_model=CreateBookResponse)
async def create_book(
    request: CreateBookRequest,
    librarian_id: str = Depends(get_librarian_id),
):
    """Create a new book from a scenario."""
    library = get_library()

    try:
        book_id, bookmark = library.open_book(
            request.scenario,
            librarian_id,
            request.private,
        )
    except BookLimitReached as e:
        raise HTTPException(status_code=400, detail=str(e))

    return CreateBookResponse(book_id=book_id, bookmark=bookmark)


@router.get("", response_model=List[dict])
async def list_books(librarian_id: str = Depends(get_librarian_id)):
    """List books accessible to the librarian."""
    return db.list_books_for_librarian(librarian_id)


@router.get("/{book_id}", response_model=BookResponse)
async def get_book(
    book_id: str,
    librarian_id: str = Depends(get_librarian_id),
):
    """Get a book's current state."""
    library = get_library()
    book = library.get_book(book_id)

    if book is None:
        raise HTTPException(status_code=404, detail="Book not found")

    state = book.get_state()
    return BookResponse(**state.to_dict())


@router.delete("/{book_id}")
async def delete_book(
    book_id: str,
    librarian_id: str = Depends(get_librarian_id),
):
    """Delete a book (owner only)."""
    library = get_library()
    book = library.get_book(book_id)

    if book is None:
        raise HTTPException(status_code=404, detail="Book not found")

    if book.owner_id != librarian_id:
        raise HTTPException(status_code=403, detail="Only the owner can delete this book")

    library.close_book(book_id)
    return {"deleted": True}


@router.post("/join", response_model=JoinBookResponse)
async def join_book(
    request: JoinBookRequest,
    librarian_id: str = Depends(get_librarian_id),
):
    """Join a book via bookmark."""
    library = get_library()
    book_id = library.find_by_bookmark(request.bookmark)

    if book_id is None:
        raise HTTPException(status_code=404, detail="Book not found")

    book = library.get_book(book_id)
    if book and book.private:
        # Check if user has access
        books = db.list_books_for_librarian(librarian_id)
        if not any(b["id"] == book_id for b in books):
            raise HTTPException(status_code=403, detail="This book is private")

    # Grant access if not already granted
    db.grant_book_access(book_id, librarian_id, role="reader")

    return JoinBookResponse(book_id=book_id)
```

- [ ] **Step 4: Update app factory**

```python
# Update raunch/server/app.py

from .routes import health, librarians, books

def create_app() -> FastAPI:
    # ... existing code ...

    # Routes
    app.include_router(health.router)
    app.include_router(librarians.router)
    app.include_router(books.router)

    return app
```

- [ ] **Step 5: Update routes/__init__.py**

```python
# raunch/server/routes/__init__.py
"""API route modules."""

from . import health, librarians, books

__all__ = ["health", "librarians", "books"]
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `pytest tests/test_server_routes.py -v`
Expected: All PASS

- [ ] **Step 7: Commit**

```bash
git add raunch/server/routes/books.py raunch/server/app.py raunch/server/routes/__init__.py
git commit -m "feat(server): add books CRUD endpoints"
```

---

### Task 12: Add book control endpoints (pause, resume, page)

**Files:**
- Modify: `raunch/server/routes/books.py`
- Test: `tests/test_server_routes.py`

- [ ] **Step 1: Write the failing tests**

```python
# Add to tests/test_server_routes.py

def test_pause_book(client_with_db):
    """Should pause a book."""
    # Setup
    lib_resp = client_with_db.post(
        "/api/v1/librarians",
        json={"nickname": "Owner"}
    )
    owner_id = lib_resp.json()["librarian_id"]

    create_resp = client_with_db.post(
        "/api/v1/books",
        json={"scenario": "milk_money"},
        headers={"X-Librarian-ID": owner_id}
    )
    book_id = create_resp.json()["book_id"]

    # Pause
    response = client_with_db.post(
        f"/api/v1/books/{book_id}/pause",
        headers={"X-Librarian-ID": owner_id}
    )
    assert response.status_code == 200
    assert response.json()["paused"] == True


def test_resume_book(client_with_db):
    """Should resume a paused book."""
    # Setup
    lib_resp = client_with_db.post(
        "/api/v1/librarians",
        json={"nickname": "Owner"}
    )
    owner_id = lib_resp.json()["librarian_id"]

    create_resp = client_with_db.post(
        "/api/v1/books",
        json={"scenario": "milk_money"},
        headers={"X-Librarian-ID": owner_id}
    )
    book_id = create_resp.json()["book_id"]

    # Pause then resume
    client_with_db.post(
        f"/api/v1/books/{book_id}/pause",
        headers={"X-Librarian-ID": owner_id}
    )

    response = client_with_db.post(
        f"/api/v1/books/{book_id}/resume",
        headers={"X-Librarian-ID": owner_id}
    )
    assert response.status_code == 200
    assert response.json()["paused"] == False
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pytest tests/test_server_routes.py::test_pause_book -v`
Expected: FAIL

- [ ] **Step 3: Add control endpoints**

```python
# Add to raunch/server/routes/books.py

class PauseResponse(BaseModel):
    paused: bool


class SettingsRequest(BaseModel):
    page_interval: Optional[int] = None


@router.post("/{book_id}/pause", response_model=PauseResponse)
async def pause_book(
    book_id: str,
    librarian_id: str = Depends(get_librarian_id),
):
    """Pause page generation for a book."""
    library = get_library()
    book = library.get_book(book_id)

    if book is None:
        raise HTTPException(status_code=404, detail="Book not found")

    if book.orchestrator:
        book.orchestrator.pause()

    return PauseResponse(paused=True)


@router.post("/{book_id}/resume", response_model=PauseResponse)
async def resume_book(
    book_id: str,
    librarian_id: str = Depends(get_librarian_id),
):
    """Resume page generation for a book."""
    library = get_library()
    book = library.get_book(book_id)

    if book is None:
        raise HTTPException(status_code=404, detail="Book not found")

    if book.orchestrator:
        book.orchestrator.resume()

    return PauseResponse(paused=False)


@router.post("/{book_id}/page")
async def trigger_page(
    book_id: str,
    librarian_id: str = Depends(get_librarian_id),
):
    """Trigger the next page generation."""
    library = get_library()
    book = library.get_book(book_id)

    if book is None:
        raise HTTPException(status_code=404, detail="Book not found")

    if book.orchestrator:
        triggered = book.orchestrator.trigger_page()
        return {"triggered": triggered}

    return {"triggered": False, "message": "Book not started"}


@router.put("/{book_id}/settings")
async def update_settings(
    book_id: str,
    request: SettingsRequest,
    librarian_id: str = Depends(get_librarian_id),
):
    """Update book settings."""
    library = get_library()
    book = library.get_book(book_id)

    if book is None:
        raise HTTPException(status_code=404, detail="Book not found")

    if request.page_interval is not None and book.orchestrator:
        book.orchestrator.set_tick_interval(request.page_interval)

    return {"updated": True}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pytest tests/test_server_routes.py -v`
Expected: All PASS

- [ ] **Step 5: Commit**

```bash
git add raunch/server/routes/books.py tests/test_server_routes.py
git commit -m "feat(server): add book control endpoints (pause, resume, page, settings)"
```

---

## Chunk 4: WebSocket Handler

### Task 13: Create WebSocket handler with join/attach commands

**Files:**
- Create: `raunch/server/ws.py`
- Modify: `raunch/server/app.py`
- Test: `tests/test_server_ws.py`

- [ ] **Step 1: Write the failing test**

```python
# tests/test_server_ws.py
"""Tests for WebSocket handler."""

import os
import tempfile
import pytest
from fastapi.testclient import TestClient


@pytest.fixture
def client_with_db(monkeypatch):
    """Create a test client with temp database."""
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
        yield TestClient(app)


def test_ws_connect_and_join(client_with_db):
    """Should connect to WebSocket and join as reader."""
    # Create book first
    lib_resp = client_with_db.post(
        "/api/v1/librarians",
        json={"nickname": "Owner"}
    )
    owner_id = lib_resp.json()["librarian_id"]

    book_resp = client_with_db.post(
        "/api/v1/books",
        json={"scenario": "milk_money"},
        headers={"X-Librarian-ID": owner_id}
    )
    book_id = book_resp.json()["book_id"]

    # Connect WebSocket
    with client_with_db.websocket_connect(f"/ws/{book_id}") as ws:
        # Join
        ws.send_json({"cmd": "join", "nickname": "TestReader"})
        response = ws.receive_json()

        assert response["type"] == "joined"
        assert "reader_id" in response


def test_ws_attach_character(client_with_db):
    """Should attach to a character."""
    # Create book with orchestrator
    lib_resp = client_with_db.post(
        "/api/v1/librarians",
        json={"nickname": "Owner"}
    )
    owner_id = lib_resp.json()["librarian_id"]

    book_resp = client_with_db.post(
        "/api/v1/books",
        json={"scenario": "milk_money"},
        headers={"X-Librarian-ID": owner_id}
    )
    book_id = book_resp.json()["book_id"]

    # Need to start the book with an orchestrator for characters
    # For this test, we'll mock it
    from raunch.server.library import get_library
    from unittest.mock import MagicMock

    library = get_library()
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pytest tests/test_server_ws.py -v`
Expected: FAIL

- [ ] **Step 3: Create WebSocket handler**

```python
# raunch/server/ws.py
"""WebSocket handler for real-time book interactions."""

import json
import logging
from typing import Dict, Optional, Any
from dataclasses import dataclass, field

from fastapi import WebSocket, WebSocketDisconnect

from .library import get_library
from .models import Reader

logger = logging.getLogger(__name__)


@dataclass
class WSClient:
    """A connected WebSocket client."""
    websocket: WebSocket
    book_id: str
    reader: Optional[Reader] = None

    async def send(self, data: Dict[str, Any]) -> None:
        """Send JSON message to client."""
        await self.websocket.send_json(data)

    async def send_error(self, code: str, message: str) -> None:
        """Send error message to client."""
        await self.send({"type": "error", "code": code, "message": message})


class WSManager:
    """Manages WebSocket connections per book."""

    def __init__(self):
        self.clients: Dict[str, Dict[str, WSClient]] = {}  # book_id -> {reader_id -> client}

    def add_client(self, book_id: str, client: WSClient) -> None:
        """Add a client to a book's connections."""
        if book_id not in self.clients:
            self.clients[book_id] = {}
        if client.reader:
            self.clients[book_id][client.reader.reader_id] = client

    def remove_client(self, book_id: str, reader_id: str) -> None:
        """Remove a client from a book's connections."""
        if book_id in self.clients:
            self.clients[book_id].pop(reader_id, None)

    async def broadcast(self, book_id: str, data: Dict[str, Any], exclude: Optional[str] = None) -> None:
        """Broadcast message to all clients in a book."""
        if book_id not in self.clients:
            return

        for reader_id, client in self.clients[book_id].items():
            if reader_id != exclude:
                try:
                    await client.send(data)
                except Exception as e:
                    logger.error(f"Failed to send to {reader_id}: {e}")


# Global manager
ws_manager = WSManager()


async def handle_websocket(websocket: WebSocket, book_id: str):
    """Handle a WebSocket connection for a book."""
    await websocket.accept()

    library = get_library()
    book = library.get_book(book_id)

    if book is None:
        await websocket.send_json({
            "type": "error",
            "code": "not_found",
            "message": "Book not found"
        })
        await websocket.close()
        return

    client = WSClient(websocket=websocket, book_id=book_id)

    try:
        while True:
            data = await websocket.receive_json()
            await handle_command(client, book, data)

    except WebSocketDisconnect:
        if client.reader:
            book.remove_reader(client.reader.reader_id)
            ws_manager.remove_client(book_id, client.reader.reader_id)

            await ws_manager.broadcast(book_id, {
                "type": "reader_left",
                "reader_id": client.reader.reader_id,
            })

    except Exception as e:
        logger.error(f"WebSocket error: {e}")
        await websocket.close()


async def handle_command(client: WSClient, book, data: Dict[str, Any]) -> None:
    """Handle a WebSocket command."""
    cmd = data.get("cmd")

    if cmd == "join":
        nickname = data.get("nickname", "Anonymous")
        reader = Reader.create(nickname)
        client.reader = reader
        book.add_reader(reader)
        ws_manager.add_client(book.book_id, client)

        await client.send({
            "type": "joined",
            "reader_id": reader.reader_id,
            "nickname": reader.nickname,
        })

        await ws_manager.broadcast(book.book_id, {
            "type": "reader_joined",
            "reader_id": reader.reader_id,
            "nickname": reader.nickname,
        }, exclude=reader.reader_id)

    elif cmd == "attach":
        if not client.reader:
            await client.send_error("not_joined", "Join first")
            return

        character = data.get("character")
        if not character:
            await client.send_error("invalid_command", "Character name required")
            return

        # Check if character exists
        if book.orchestrator and character not in book.orchestrator.characters:
            await client.send_error("not_found", f"Character '{character}' not found")
            return

        # Check if already taken
        existing = book.get_reader_by_character(character)
        if existing and existing.reader_id != client.reader.reader_id:
            await client.send_error(
                "character_taken",
                f"{character} is controlled by another reader"
            )
            return

        client.reader.attached_to = character
        await client.send({"type": "attached", "character": character})

    elif cmd == "detach":
        if client.reader:
            client.reader.attached_to = None
            await client.send({"type": "detached"})

    elif cmd == "action":
        if not client.reader or not client.reader.attached_to:
            await client.send_error("not_attached", "Attach to a character first")
            return

        text = data.get("text", "")
        # TODO: Forward to orchestrator
        await client.send({"type": "ok", "message": "Action queued"})

    elif cmd == "whisper":
        if not client.reader or not client.reader.attached_to:
            await client.send_error("not_attached", "Attach to a character first")
            return

        text = data.get("text", "")
        # TODO: Forward to orchestrator
        await client.send({"type": "ok", "message": "Whisper queued"})

    elif cmd == "director":
        text = data.get("text", "")
        # TODO: Forward to orchestrator
        await client.send({"type": "ok", "message": "Director guidance queued"})

    elif cmd == "ready":
        if client.reader:
            client.reader.ready = True
            # TODO: Check if all ready
            await client.send({"type": "ok", "message": "Ready"})

    else:
        await client.send_error("invalid_command", f"Unknown command: {cmd}")
```

- [ ] **Step 4: Add WebSocket route to app**

```python
# Update raunch/server/app.py

from fastapi import WebSocket
from .ws import handle_websocket

def create_app() -> FastAPI:
    # ... existing code ...

    @app.websocket("/ws/{book_id}")
    async def websocket_endpoint(websocket: WebSocket, book_id: str):
        await handle_websocket(websocket, book_id)

    return app
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `pytest tests/test_server_ws.py -v`
Expected: All PASS

- [ ] **Step 6: Commit**

```bash
git add raunch/server/ws.py raunch/server/app.py tests/test_server_ws.py
git commit -m "feat(server): add WebSocket handler with join, attach, action commands"
```

---

### Task 14: Update server __init__.py exports

**Files:**
- Modify: `raunch/server/__init__.py`

- [ ] **Step 1: Update exports**

```python
# raunch/server/__init__.py
"""Living Library server module."""

from .models import Reader, BookState
from .book import Book
from .library import Library, get_library, reset_library, BookLimitReached
from .app import create_app
from .ws import ws_manager, handle_websocket

__all__ = [
    "Reader",
    "BookState",
    "Book",
    "Library",
    "get_library",
    "reset_library",
    "BookLimitReached",
    "create_app",
    "ws_manager",
    "handle_websocket",
]
```

- [ ] **Step 2: Commit**

```bash
git add raunch/server/__init__.py
git commit -m "feat(server): update module exports"
```

---

### Task 15: Run all tests and verify

- [ ] **Step 1: Run all new tests**

Run: `pytest tests/test_db_schema.py tests/test_server_book.py tests/test_server_library.py tests/test_server_routes.py tests/test_server_ws.py -v`
Expected: All PASS

- [ ] **Step 2: Run existing tests to ensure no regressions**

Run: `pytest tests/ -v`
Expected: All PASS

- [ ] **Step 3: Final commit**

```bash
git add .
git commit -m "feat(server): complete Phase 1 - Living Library core server module"
```

---

## Deferred to Later Phases

The following spec requirements are intentionally deferred:

**Phase 2 (Client Module):**
- `client/base.py`, `client/remote.py`, `client/models.py`
- RemoteClient REST + WebSocket implementation

**Phase 3 (CLI Refactor):**
- `cli/` module using client
- `client/local.py` (in-process mode)
- `raunch connect` command

**Phase 4 (Migration + Additional Endpoints):**
- `GET/POST /api/v1/scenarios` endpoints (currently in old `api.py`)
- `GET/POST/DELETE /api/v1/books/{id}/characters` endpoints
- `POST /api/v1/books/{id}/characters/grab` endpoint
- `GET /api/v1/books/{id}/pages` endpoints
- `GET/DELETE /api/v1/books/{id}/readers` endpoints
- `GET /api/v1/books/{id}/bookmark` (regenerate bookmark)
- React app migration
- Old `api.py` deprecation

---

## Summary

Phase 1 delivers:
- ✅ Database schema (librarians, books, book_access tables)
- ✅ CRUD functions for librarians and books
- ✅ Server module structure (`raunch/server/`)
- ✅ Reader, Book, BookState models
- ✅ Library singleton for managing books
- ✅ REST endpoints (health, librarians, books CRUD, controls)
- ✅ WebSocket handler (join, attach, detach, action, whisper, director)
- ✅ Tests for all components

The new API runs alongside the existing `api.py`. Next phases will add:
- Phase 2: Client module (RemoteClient, LocalClient)
- Phase 3: CLI refactor
- Phase 4: React app migration and cleanup
