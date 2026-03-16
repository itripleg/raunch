# Living Library API Phase 4: Additional Endpoints & Migration

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add remaining REST endpoints (characters, pages, readers, scenarios) to the new Living Library API, then migrate the React frontend to use the new endpoints.

**Architecture:** Add route modules to `raunch/server/routes/` for characters, pages, readers. These operate on books and interact with the orchestrator. The frontend will switch from old api.py endpoints to new /api/v1/books/{id}/... endpoints.

**Tech Stack:** Python 3.11+, FastAPI, pytest, TypeScript/React

---

## Current State

**New API (raunch/server/):**
- `/api/v1/librarians` - Create/get librarians ✅
- `/api/v1/books` - CRUD, join, pause/resume/page ✅
- `/ws/{book_id}` - WebSocket for real-time ✅

**Old API (raunch/api.py):**
- `/api/v1/scenarios` - List, roll, wizard ✅
- `/api/v1/world` - Load/stop world
- `/api/v1/characters` - Add/delete characters
- `/api/v1/potential-characters` - List NPCs
- `/api/v1/grab/{name}` - Promote NPC
- `/api/v1/alpha/*` - Alpha dashboard

**Missing from new API:**
- Characters endpoints on books
- Pages history endpoints
- Readers management
- Scenarios (move from old api.py)

---

## Chunk 1: Characters & Readers Endpoints

### Task 1: Add characters routes

**Files:**
- Create: `raunch/server/routes/characters.py`
- Test: `tests/test_server_characters.py`

- [ ] **Step 1: Write the failing test**

```python
# tests/test_server_characters.py
"""Tests for character endpoints."""

import os
import tempfile
import pytest
from fastapi.testclient import TestClient


@pytest.fixture
def temp_db(monkeypatch):
    with tempfile.TemporaryDirectory() as tmpdir:
        db_path = os.path.join(tmpdir, "test.db")
        monkeypatch.setattr("raunch.db.DB_PATH", db_path)
        monkeypatch.setattr("raunch.db._local", type("Local", (), {})())
        from raunch import db
        db.init_db()
        yield db_path


@pytest.fixture
def client(temp_db):
    from raunch.server.library import reset_library
    reset_library()
    from raunch.server.app import create_app
    app = create_app()
    return TestClient(app)


@pytest.fixture
def librarian_and_book(client):
    """Create a librarian and book for testing."""
    # Create librarian
    resp = client.post("/api/v1/librarians", json={"nickname": "Test"})
    librarian_id = resp.json()["librarian_id"]
    headers = {"X-Librarian-ID": librarian_id}

    # Create book
    resp = client.post("/api/v1/books", json={"scenario": "test_solo_scenario"}, headers=headers)
    book_id = resp.json()["book_id"]

    return librarian_id, book_id, headers


def test_list_characters(client, librarian_and_book):
    """GET /api/v1/books/{id}/characters should return character list."""
    librarian_id, book_id, headers = librarian_and_book

    resp = client.get(f"/api/v1/books/{book_id}/characters", headers=headers)
    assert resp.status_code == 200
    data = resp.json()
    assert isinstance(data, list)


def test_add_character(client, librarian_and_book):
    """POST /api/v1/books/{id}/characters should add a character."""
    librarian_id, book_id, headers = librarian_and_book

    resp = client.post(
        f"/api/v1/books/{book_id}/characters",
        json={
            "name": "New Character",
            "species": "Elf",
            "personality": "Mysterious",
        },
        headers=headers,
    )
    assert resp.status_code == 201
    data = resp.json()
    assert data["name"] == "New Character"


def test_delete_character(client, librarian_and_book):
    """DELETE /api/v1/books/{id}/characters/{name} should remove character."""
    librarian_id, book_id, headers = librarian_and_book

    # First add a character
    client.post(
        f"/api/v1/books/{book_id}/characters",
        json={"name": "ToDelete", "species": "Human"},
        headers=headers,
    )

    # Delete it
    resp = client.delete(f"/api/v1/books/{book_id}/characters/ToDelete", headers=headers)
    assert resp.status_code == 200
    assert resp.json()["deleted"] is True
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pytest tests/test_server_characters.py -v`
Expected: FAIL - endpoint not found

- [ ] **Step 3: Create characters route module**

```python
# raunch/server/routes/characters.py
"""Character endpoints for books."""

from fastapi import APIRouter, HTTPException, Header, Depends
from pydantic import BaseModel
from typing import Optional, List

from ..library import get_library
from raunch import db
from raunch.agents.character import Character

router = APIRouter(prefix="/api/v1/books/{book_id}/characters", tags=["characters"])


def get_librarian_id(x_librarian_id: str = Header(..., alias="X-Librarian-ID")) -> str:
    """Extract and validate librarian ID from header."""
    librarian = db.get_librarian(x_librarian_id)
    if librarian is None:
        raise HTTPException(status_code=401, detail="Invalid librarian ID")
    return x_librarian_id


class CharacterResponse(BaseModel):
    name: str
    species: str
    emotional_state: Optional[str] = None
    attached_by: Optional[str] = None


class AddCharacterRequest(BaseModel):
    name: str
    species: str = "Human"
    personality: str = ""
    appearance: str = ""
    desires: str = ""
    backstory: str = ""
    kinks: str = ""
    location: Optional[str] = None


class AddCharacterResponse(BaseModel):
    name: str
    species: str
    message: str


@router.get("", response_model=List[CharacterResponse])
async def list_characters(
    book_id: str,
    librarian_id: str = Depends(get_librarian_id),
):
    """List all characters in the book."""
    library = get_library()
    book = library.get_book(book_id)

    if book is None:
        raise HTTPException(status_code=404, detail="Book not found")

    if not book.orchestrator:
        return []

    result = []
    for name, char in book.orchestrator.characters.items():
        # Check if character is attached by a reader
        attached_by = None
        for reader in book.readers.values():
            if reader.attached_to == name:
                attached_by = reader.reader_id
                break

        result.append(CharacterResponse(
            name=name,
            species=char.character_data.get("species", ""),
            emotional_state=char.emotional_state,
            attached_by=attached_by,
        ))

    return result


@router.post("", status_code=201, response_model=AddCharacterResponse)
async def add_character(
    book_id: str,
    request: AddCharacterRequest,
    librarian_id: str = Depends(get_librarian_id),
):
    """Add a character to the book."""
    library = get_library()
    book = library.get_book(book_id)

    if book is None:
        raise HTTPException(status_code=404, detail="Book not found")

    if not book.orchestrator:
        raise HTTPException(status_code=400, detail="Book not started")

    # Check for duplicate
    name_lower = request.name.lower()
    for existing in book.orchestrator.characters:
        if existing.lower() == name_lower:
            raise HTTPException(status_code=400, detail=f"Character '{existing}' already exists")

    # Create character
    char = Character(
        name=request.name,
        species=request.species,
        personality=request.personality,
        appearance=request.appearance,
        desires=request.desires,
        backstory=request.backstory,
        kinks=request.kinks,
    )

    # Add to orchestrator
    location = request.location
    if not location and book.orchestrator.world.locations:
        location = list(book.orchestrator.world.locations.keys())[0]

    book.orchestrator.add_character(char, location=location or "unknown")

    return AddCharacterResponse(
        name=request.name,
        species=request.species,
        message=f"Character '{request.name}' added",
    )


@router.delete("/{name}")
async def delete_character(
    book_id: str,
    name: str,
    librarian_id: str = Depends(get_librarian_id),
):
    """Remove a character from the book."""
    library = get_library()
    book = library.get_book(book_id)

    if book is None:
        raise HTTPException(status_code=404, detail="Book not found")

    if not book.orchestrator:
        raise HTTPException(status_code=400, detail="Book not started")

    if name not in book.orchestrator.characters:
        raise HTTPException(status_code=404, detail=f"Character '{name}' not found")

    # Remove from orchestrator
    del book.orchestrator.characters[name]

    # Remove from location tracking
    for loc in book.orchestrator.world.locations.values():
        if name in loc.get("characters", []):
            loc["characters"].remove(name)

    return {"deleted": True, "name": name}


class GrabRequest(BaseModel):
    name: str


@router.post("/grab", response_model=AddCharacterResponse)
async def grab_character(
    book_id: str,
    request: GrabRequest,
    librarian_id: str = Depends(get_librarian_id),
):
    """Promote an NPC to a full character."""
    library = get_library()
    book = library.get_book(book_id)

    if book is None:
        raise HTTPException(status_code=404, detail="Book not found")

    if not book.orchestrator:
        raise HTTPException(status_code=400, detail="Book not started")

    world_id = book.orchestrator.world.world_id
    if not world_id:
        raise HTTPException(status_code=400, detail="World has no ID")

    # Check if potential character exists
    from raunch.db import get_potential_character, promote_character

    potential = get_potential_character(world_id, request.name)
    if not potential:
        raise HTTPException(status_code=404, detail=f"NPC '{request.name}' not found")

    if potential["promoted"]:
        raise HTTPException(status_code=400, detail=f"'{request.name}' already promoted")

    # Check for existing character
    name_lower = request.name.lower()
    for existing in book.orchestrator.characters:
        if existing.lower() == name_lower:
            raise HTTPException(status_code=400, detail=f"Character '{existing}' already exists")

    # Promote in database
    promote_character(world_id, request.name)

    # Create character
    description = potential["description"] or "A mysterious figure"
    char = Character(
        name=request.name,
        species="Human",
        personality=description,
        appearance=description,
        desires="Unknown",
        backstory=f"First appeared on page {potential['first_page']}",
    )

    location = list(book.orchestrator.world.locations.keys())[0] if book.orchestrator.world.locations else "unknown"
    book.orchestrator.add_character(char, location=location)

    return AddCharacterResponse(
        name=request.name,
        species="Human",
        message=f"NPC '{request.name}' promoted to character",
    )
```

- [ ] **Step 4: Register route in app.py**

Add to `raunch/server/app.py`:

```python
from .routes import characters

# In create_app():
app.include_router(characters.router)
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `pytest tests/test_server_characters.py -v`
Expected: All PASS

- [ ] **Step 6: Commit**

```bash
git add raunch/server/routes/characters.py tests/test_server_characters.py raunch/server/app.py
git commit -m "feat(server): add character endpoints for books"
```

---

### Task 2: Add readers routes

**Files:**
- Create: `raunch/server/routes/readers.py`
- Test: `tests/test_server_readers.py`

- [ ] **Step 1: Write the failing test**

```python
# tests/test_server_readers.py
"""Tests for reader endpoints."""

import os
import tempfile
import pytest
from fastapi.testclient import TestClient


@pytest.fixture
def temp_db(monkeypatch):
    with tempfile.TemporaryDirectory() as tmpdir:
        db_path = os.path.join(tmpdir, "test.db")
        monkeypatch.setattr("raunch.db.DB_PATH", db_path)
        monkeypatch.setattr("raunch.db._local", type("Local", (), {})())
        from raunch import db
        db.init_db()
        yield db_path


@pytest.fixture
def client(temp_db):
    from raunch.server.library import reset_library
    reset_library()
    from raunch.server.app import create_app
    app = create_app()
    return TestClient(app)


@pytest.fixture
def librarian_and_book(client):
    resp = client.post("/api/v1/librarians", json={"nickname": "Test"})
    librarian_id = resp.json()["librarian_id"]
    headers = {"X-Librarian-ID": librarian_id}

    resp = client.post("/api/v1/books", json={"scenario": "test_solo_scenario"}, headers=headers)
    book_id = resp.json()["book_id"]

    return librarian_id, book_id, headers


def test_list_readers_empty(client, librarian_and_book):
    """GET /api/v1/books/{id}/readers should return empty list initially."""
    librarian_id, book_id, headers = librarian_and_book

    resp = client.get(f"/api/v1/books/{book_id}/readers", headers=headers)
    assert resp.status_code == 200
    assert resp.json() == []


def test_list_readers_after_join(client, librarian_and_book):
    """Readers list should show connected readers."""
    librarian_id, book_id, headers = librarian_and_book

    # Add a reader directly to the book
    from raunch.server.library import get_library
    from raunch.server.models import Reader

    library = get_library()
    book = library.get_book(book_id)
    reader = Reader.create("TestReader")
    book.add_reader(reader)

    resp = client.get(f"/api/v1/books/{book_id}/readers", headers=headers)
    assert resp.status_code == 200
    data = resp.json()
    assert len(data) == 1
    assert data[0]["nickname"] == "TestReader"
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pytest tests/test_server_readers.py -v`
Expected: FAIL - endpoint not found

- [ ] **Step 3: Create readers route module**

```python
# raunch/server/routes/readers.py
"""Reader endpoints for books."""

from fastapi import APIRouter, HTTPException, Header, Depends
from pydantic import BaseModel
from typing import Optional, List

from ..library import get_library
from raunch import db

router = APIRouter(prefix="/api/v1/books/{book_id}/readers", tags=["readers"])


def get_librarian_id(x_librarian_id: str = Header(..., alias="X-Librarian-ID")) -> str:
    librarian = db.get_librarian(x_librarian_id)
    if librarian is None:
        raise HTTPException(status_code=401, detail="Invalid librarian ID")
    return x_librarian_id


class ReaderResponse(BaseModel):
    reader_id: str
    nickname: str
    attached_to: Optional[str] = None
    ready: bool = False


@router.get("", response_model=List[ReaderResponse])
async def list_readers(
    book_id: str,
    librarian_id: str = Depends(get_librarian_id),
):
    """List all connected readers in the book."""
    library = get_library()
    book = library.get_book(book_id)

    if book is None:
        raise HTTPException(status_code=404, detail="Book not found")

    return [
        ReaderResponse(
            reader_id=r.reader_id,
            nickname=r.nickname,
            attached_to=r.attached_to,
            ready=r.ready,
        )
        for r in book.readers.values()
    ]


@router.delete("/{reader_id}")
async def kick_reader(
    book_id: str,
    reader_id: str,
    librarian_id: str = Depends(get_librarian_id),
):
    """Kick a reader from the book (owner only)."""
    library = get_library()
    book = library.get_book(book_id)

    if book is None:
        raise HTTPException(status_code=404, detail="Book not found")

    # Check ownership
    if book.owner_id != librarian_id:
        raise HTTPException(status_code=403, detail="Only the owner can kick readers")

    if reader_id not in book.readers:
        raise HTTPException(status_code=404, detail="Reader not found")

    book.remove_reader(reader_id)

    return {"kicked": True, "reader_id": reader_id}
```

- [ ] **Step 4: Register route in app.py**

Add to `raunch/server/app.py`:

```python
from .routes import readers

app.include_router(readers.router)
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `pytest tests/test_server_readers.py -v`
Expected: All PASS

- [ ] **Step 6: Commit**

```bash
git add raunch/server/routes/readers.py tests/test_server_readers.py raunch/server/app.py
git commit -m "feat(server): add reader endpoints for books"
```

---

## Chunk 2: Pages & Scenarios Endpoints

### Task 3: Add pages routes

**Files:**
- Create: `raunch/server/routes/pages.py`
- Test: `tests/test_server_pages.py`

- [ ] **Step 1: Write the failing test**

```python
# tests/test_server_pages.py
"""Tests for page history endpoints."""

import os
import tempfile
import pytest
from fastapi.testclient import TestClient


@pytest.fixture
def temp_db(monkeypatch):
    with tempfile.TemporaryDirectory() as tmpdir:
        db_path = os.path.join(tmpdir, "test.db")
        monkeypatch.setattr("raunch.db.DB_PATH", db_path)
        monkeypatch.setattr("raunch.db._local", type("Local", (), {})())
        from raunch import db
        db.init_db()
        yield db_path


@pytest.fixture
def client(temp_db):
    from raunch.server.library import reset_library
    reset_library()
    from raunch.server.app import create_app
    app = create_app()
    return TestClient(app)


@pytest.fixture
def librarian_and_book(client):
    resp = client.post("/api/v1/librarians", json={"nickname": "Test"})
    librarian_id = resp.json()["librarian_id"]
    headers = {"X-Librarian-ID": librarian_id}

    resp = client.post("/api/v1/books", json={"scenario": "test_solo_scenario"}, headers=headers)
    book_id = resp.json()["book_id"]

    return librarian_id, book_id, headers


def test_list_pages_empty(client, librarian_and_book):
    """GET /api/v1/books/{id}/pages should return empty initially."""
    librarian_id, book_id, headers = librarian_and_book

    resp = client.get(f"/api/v1/books/{book_id}/pages", headers=headers)
    assert resp.status_code == 200
    data = resp.json()
    assert "pages" in data
    assert data["total"] == 0


def test_list_pages_with_pagination(client, librarian_and_book):
    """Pages endpoint should support limit and offset."""
    librarian_id, book_id, headers = librarian_and_book

    resp = client.get(f"/api/v1/books/{book_id}/pages?limit=5&offset=0", headers=headers)
    assert resp.status_code == 200
    data = resp.json()
    assert "pages" in data
    assert "limit" in data
    assert "offset" in data
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pytest tests/test_server_pages.py -v`
Expected: FAIL - endpoint not found

- [ ] **Step 3: Create pages route module**

```python
# raunch/server/routes/pages.py
"""Page history endpoints for books."""

from fastapi import APIRouter, HTTPException, Header, Depends, Query
from pydantic import BaseModel
from typing import Optional, List, Dict, Any

from ..library import get_library
from raunch import db

router = APIRouter(prefix="/api/v1/books/{book_id}/pages", tags=["pages"])


def get_librarian_id(x_librarian_id: str = Header(..., alias="X-Librarian-ID")) -> str:
    librarian = db.get_librarian(x_librarian_id)
    if librarian is None:
        raise HTTPException(status_code=401, detail="Invalid librarian ID")
    return x_librarian_id


class CharacterPageData(BaseModel):
    action: Optional[str] = None
    dialogue: Optional[str] = None
    emotional_state: Optional[str] = None
    inner_thoughts: Optional[str] = None
    desires_update: Optional[str] = None


class PageResponse(BaseModel):
    page: int
    narration: str
    mood: Optional[str] = None
    world_time: Optional[str] = None
    events: List[str] = []
    characters: Dict[str, CharacterPageData] = {}
    created_at: Optional[str] = None


class PagesListResponse(BaseModel):
    pages: List[PageResponse]
    total: int
    limit: int
    offset: int


@router.get("", response_model=PagesListResponse)
async def list_pages(
    book_id: str,
    limit: int = Query(10, ge=1, le=100),
    offset: int = Query(0, ge=0),
    librarian_id: str = Depends(get_librarian_id),
):
    """Get page history for a book."""
    library = get_library()
    book = library.get_book(book_id)

    if book is None:
        raise HTTPException(status_code=404, detail="Book not found")

    if not book.orchestrator or not book.orchestrator.world.world_id:
        return PagesListResponse(pages=[], total=0, limit=limit, offset=offset)

    world_id = book.orchestrator.world.world_id

    # Get pages from database
    pages_data = db.get_page_history(world_id, limit=limit, offset=offset)
    total = db.get_page_count(world_id)

    pages = []
    for p in pages_data:
        # Get character data for this page
        char_pages = db.get_character_pages(world_id, p["page"])
        characters = {}
        for cp in char_pages:
            characters[cp["character_name"]] = CharacterPageData(
                action=cp.get("action"),
                dialogue=cp.get("dialogue"),
                emotional_state=cp.get("emotional_state"),
                inner_thoughts=cp.get("inner_thoughts"),
                desires_update=cp.get("desires_update"),
            )

        pages.append(PageResponse(
            page=p["page"],
            narration=p.get("narration", ""),
            mood=p.get("mood"),
            world_time=p.get("world_time"),
            events=p.get("events", []),
            characters=characters,
            created_at=p.get("created_at"),
        ))

    return PagesListResponse(pages=pages, total=total, limit=limit, offset=offset)


@router.get("/{page_num}", response_model=PageResponse)
async def get_page(
    book_id: str,
    page_num: int,
    librarian_id: str = Depends(get_librarian_id),
):
    """Get a specific page from history."""
    library = get_library()
    book = library.get_book(book_id)

    if book is None:
        raise HTTPException(status_code=404, detail="Book not found")

    if not book.orchestrator or not book.orchestrator.world.world_id:
        raise HTTPException(status_code=404, detail="No page history")

    world_id = book.orchestrator.world.world_id

    # Get page from database
    page_data = db.get_page(world_id, page_num)
    if not page_data:
        raise HTTPException(status_code=404, detail=f"Page {page_num} not found")

    # Get character data
    char_pages = db.get_character_pages(world_id, page_num)
    characters = {}
    for cp in char_pages:
        characters[cp["character_name"]] = CharacterPageData(
            action=cp.get("action"),
            dialogue=cp.get("dialogue"),
            emotional_state=cp.get("emotional_state"),
            inner_thoughts=cp.get("inner_thoughts"),
            desires_update=cp.get("desires_update"),
        )

    return PageResponse(
        page=page_data["page"],
        narration=page_data.get("narration", ""),
        mood=page_data.get("mood"),
        world_time=page_data.get("world_time"),
        events=page_data.get("events", []),
        characters=characters,
        created_at=page_data.get("created_at"),
    )
```

- [ ] **Step 4: Add database helper functions**

Add to `raunch/db.py`:

```python
def get_page_history(world_id: str, limit: int = 10, offset: int = 0) -> List[dict]:
    """Get page history for a world."""
    conn = _get_conn()
    rows = conn.execute(
        """SELECT page, narration, mood, world_time, events, created_at
           FROM pages WHERE world_id = ?
           ORDER BY page DESC LIMIT ? OFFSET ?""",
        (world_id, limit, offset)
    ).fetchall()

    return [
        {
            "page": r["page"],
            "narration": r["narration"],
            "mood": r["mood"],
            "world_time": r["world_time"],
            "events": json.loads(r["events"]) if r["events"] else [],
            "created_at": r["created_at"],
        }
        for r in rows
    ]


def get_page_count(world_id: str) -> int:
    """Get total page count for a world."""
    conn = _get_conn()
    row = conn.execute(
        "SELECT COUNT(*) as count FROM pages WHERE world_id = ?",
        (world_id,)
    ).fetchone()
    return row["count"] if row else 0


def get_page(world_id: str, page_num: int) -> Optional[dict]:
    """Get a specific page."""
    conn = _get_conn()
    row = conn.execute(
        """SELECT page, narration, mood, world_time, events, created_at
           FROM pages WHERE world_id = ? AND page = ?""",
        (world_id, page_num)
    ).fetchone()

    if not row:
        return None

    return {
        "page": row["page"],
        "narration": row["narration"],
        "mood": row["mood"],
        "world_time": row["world_time"],
        "events": json.loads(row["events"]) if row["events"] else [],
        "created_at": row["created_at"],
    }


def get_character_pages(world_id: str, page_num: int) -> List[dict]:
    """Get character data for a specific page."""
    conn = _get_conn()
    rows = conn.execute(
        """SELECT character_name, action, dialogue, emotional_state,
                  inner_thoughts, desires_update
           FROM character_pages WHERE world_id = ? AND page = ?""",
        (world_id, page_num)
    ).fetchall()

    return [dict(r) for r in rows]
```

- [ ] **Step 5: Register route in app.py**

Add to `raunch/server/app.py`:

```python
from .routes import pages

app.include_router(pages.router)
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `pytest tests/test_server_pages.py -v`
Expected: All PASS

- [ ] **Step 7: Commit**

```bash
git add raunch/server/routes/pages.py tests/test_server_pages.py raunch/db.py raunch/server/app.py
git commit -m "feat(server): add page history endpoints for books"
```

---

### Task 4: Move scenarios endpoints to new server

**Files:**
- Create: `raunch/server/routes/scenarios.py`
- Test: `tests/test_server_scenarios.py`

- [ ] **Step 1: Write the failing test**

```python
# tests/test_server_scenarios.py
"""Tests for scenario endpoints."""

import os
import tempfile
import pytest
from fastapi.testclient import TestClient


@pytest.fixture
def temp_db(monkeypatch):
    with tempfile.TemporaryDirectory() as tmpdir:
        db_path = os.path.join(tmpdir, "test.db")
        monkeypatch.setattr("raunch.db.DB_PATH", db_path)
        monkeypatch.setattr("raunch.db._local", type("Local", (), {})())
        from raunch import db
        db.init_db()
        yield db_path


@pytest.fixture
def client(temp_db):
    from raunch.server.library import reset_library
    reset_library()
    from raunch.server.app import create_app
    app = create_app()
    return TestClient(app)


def test_list_scenarios(client):
    """GET /api/v1/scenarios should return scenario list."""
    resp = client.get("/api/v1/scenarios")
    assert resp.status_code == 200
    data = resp.json()
    assert isinstance(data, list)


def test_get_wizard_options(client):
    """GET /api/v1/wizard/options should return options."""
    resp = client.get("/api/v1/wizard/options")
    assert resp.status_code == 200
    data = resp.json()
    assert "settings" in data
    assert "kinks" in data
    assert "vibes" in data
```

- [ ] **Step 2: Create scenarios route module**

```python
# raunch/server/routes/scenarios.py
"""Scenario and wizard endpoints."""

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import Optional, List

from raunch.wizard import (
    list_scenarios,
    load_scenario,
    random_scenario,
    generate_scenario,
    save_scenario,
    SETTINGS,
    KINK_POOLS,
    VIBES,
)

router = APIRouter(tags=["scenarios"])


class ScenarioSummary(BaseModel):
    file: str
    name: str
    setting: Optional[str] = None
    characters: int = 0
    themes: List[str] = []


class CharacterDetail(BaseModel):
    name: str
    species: Optional[str] = None
    personality: Optional[str] = None
    appearance: Optional[str] = None
    desires: Optional[str] = None
    backstory: Optional[str] = None
    kinks: Optional[str] = None


class ScenarioDetail(BaseModel):
    scenario_name: str
    setting: Optional[str] = None
    premise: Optional[str] = None
    themes: List[str] = []
    opening_situation: Optional[str] = None
    characters: List[CharacterDetail] = []
    multiplayer: bool = False


class WizardOptions(BaseModel):
    settings: List[str]
    kinks: List[str]
    vibes: List[str]


class WizardGenerateRequest(BaseModel):
    setting: Optional[str] = None
    kinks: Optional[List[str]] = None
    vibe: Optional[str] = None
    preferences: Optional[str] = None
    num_characters: int = 3
    save: bool = False


@router.get("/api/v1/scenarios", response_model=List[ScenarioSummary])
async def get_scenarios():
    """List all available scenarios."""
    return list_scenarios()


@router.get("/api/v1/scenarios/{name}", response_model=ScenarioDetail)
async def get_scenario(name: str):
    """Get scenario details."""
    scenario = load_scenario(name)
    if not scenario:
        raise HTTPException(status_code=404, detail=f"Scenario '{name}' not found")

    return ScenarioDetail(
        scenario_name=scenario.get("scenario_name", name),
        setting=scenario.get("setting"),
        premise=scenario.get("premise"),
        themes=scenario.get("themes", []),
        opening_situation=scenario.get("opening_situation"),
        characters=[
            CharacterDetail(**c) for c in scenario.get("characters", [])
        ],
        multiplayer=scenario.get("multiplayer", False),
    )


@router.post("/api/v1/scenarios/roll", response_model=ScenarioDetail)
async def roll_scenario():
    """Generate a random scenario."""
    scenario = random_scenario()
    return ScenarioDetail(
        scenario_name=scenario.get("scenario_name", "Random"),
        setting=scenario.get("setting"),
        premise=scenario.get("premise"),
        themes=scenario.get("themes", []),
        opening_situation=scenario.get("opening_situation"),
        characters=[
            CharacterDetail(**c) for c in scenario.get("characters", [])
        ],
    )


@router.get("/api/v1/wizard/options", response_model=WizardOptions)
async def get_wizard_options():
    """Get available options for the Smut Wizard."""
    return WizardOptions(
        settings=SETTINGS,
        kinks=KINK_POOLS,
        vibes=VIBES,
    )


@router.post("/api/v1/wizard/generate", response_model=ScenarioDetail)
async def wizard_generate(request: WizardGenerateRequest):
    """Generate a scenario with the Smut Wizard."""
    try:
        scenario = generate_scenario(
            preferences=request.preferences,
            num_characters=request.num_characters,
            kinks=request.kinks,
            setting_hint=request.setting,
            vibe=request.vibe,
        )
        if request.save:
            save_scenario(scenario)

        return ScenarioDetail(
            scenario_name=scenario.get("scenario_name", "Generated"),
            setting=scenario.get("setting"),
            premise=scenario.get("premise"),
            themes=scenario.get("themes", []),
            opening_situation=scenario.get("opening_situation"),
            characters=[
                CharacterDetail(**c) for c in scenario.get("characters", [])
            ],
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
```

- [ ] **Step 3: Register route in app.py**

Add to `raunch/server/app.py`:

```python
from .routes import scenarios

app.include_router(scenarios.router)
```

- [ ] **Step 4: Run tests**

Run: `pytest tests/test_server_scenarios.py -v`
Expected: All PASS

- [ ] **Step 5: Commit**

```bash
git add raunch/server/routes/scenarios.py tests/test_server_scenarios.py raunch/server/app.py
git commit -m "feat(server): add scenario endpoints to new server"
```

---

## Chunk 3: Run All Tests & Final Verification

### Task 5: Run all tests and verify

- [ ] **Step 1: Run all server tests**

Run: `pytest tests/test_server_*.py -v`
Expected: All PASS

- [ ] **Step 2: Run all tests**

Run: `pytest tests/ -v --ignore=tests/test_parallel_characters.py`
Expected: All PASS

- [ ] **Step 3: Final commit**

```bash
git add .
git commit -m "feat(server): complete Phase 4 - all Living Library endpoints"
```

---

## Summary

Phase 4 delivers:
- ✅ Character endpoints: GET, POST, DELETE on `/api/v1/books/{id}/characters`
- ✅ Character grab: POST `/api/v1/books/{id}/characters/grab`
- ✅ Reader endpoints: GET, DELETE on `/api/v1/books/{id}/readers`
- ✅ Page history: GET `/api/v1/books/{id}/pages` with pagination
- ✅ Page detail: GET `/api/v1/books/{id}/pages/{num}`
- ✅ Scenario endpoints moved to new server

## Deferred (Future Work)

**Frontend Migration:**
- Update React hooks to use new `/api/v1/books/...` endpoints
- Update WebSocket connection to use new `/ws/{book_id}` endpoint
- Deprecate old api.py

**Additional Features:**
- Alpha dashboard endpoints (move to new server)
- Book orchestrator lifecycle (start/stop with WebSocket broadcast)
