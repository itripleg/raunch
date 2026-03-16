# Living Library API Design

**Date:** 2026-03-15
**Status:** Draft
**Author:** Maven + JB

---

## Overview

A unified API architecture for raunch (future Living Library) that enables both CLI and React app to interact with the game server consistently. Supports multi-book hosting, remote CLI connections, and multiplayer.

## Terminology (Book Theme)

| Term | Meaning |
|------|---------|
| **Librarian** | User who owns a collection of books |
| **Library** | Server-side registry holding all active books |
| **Book** | A story instance (scenario + characters + state) |
| **Reader** | Active participant in a book's story |
| **Page** | A turn/moment in the story |
| **Bookmark** | Join code for sharing book access |

---

## Core Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                         Library                              │
│  (singleton service - holds all active books)               │
├─────────────────────────────────────────────────────────────┤
│  books: Dict[book_id, Book]                                 │
│  bookmarks: Dict[code, book_id]                             │
│  librarians: Dict[librarian_id, Librarian]                  │
├─────────────────────────────────────────────────────────────┤
│  open_book(scenario, librarian?) → (book_id, bookmark)      │
│  get_book(book_id) → Book                                   │
│  find_by_bookmark(code) → book_id                           │
│  close_book(book_id)                                        │
│  list_books(librarian?) → List[BookSummary]                 │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                          Book                                │
│  (wraps Orchestrator + World + connected Readers)           │
├─────────────────────────────────────────────────────────────┤
│  book_id: str                                               │
│  bookmark: str  (join code)                                 │
│  orchestrator: Orchestrator                                 │
│  readers: Dict[reader_id, Reader]                           │
│  owner: librarian_id (optional)                             │
├─────────────────────────────────────────────────────────────┤
│  add_reader(nickname) → Reader                              │
│  remove_reader(reader_id)                                   │
│  get_state() → BookState                                    │
└─────────────────────────────────────────────────────────────┘
```

The `Library` is the single entry point for both REST and WebSocket handlers. The existing `Orchestrator` stays mostly unchanged - `Book` wraps it with reader management and bookmark system.

---

## Module Structure

```
raunch/
├── __init__.py
│
├── server/                    # Server-side (API + game engine)
│   ├── __init__.py
│   ├── app.py                 # FastAPI app factory
│   ├── library.py             # Library singleton (book registry)
│   ├── book.py                # Book (wraps Orchestrator)
│   ├── reader.py              # Reader model
│   ├── routes/
│   │   ├── __init__.py
│   │   ├── books.py           # /api/v1/books/...
│   │   ├── scenarios.py       # /api/v1/scenarios/...
│   │   └── health.py          # /health
│   └── ws.py                  # WebSocket handler
│
├── client/                    # Client-side (no server deps)
│   ├── __init__.py
│   ├── base.py                # BookClient protocol
│   ├── local.py               # LocalClient (embeds server in-process)
│   ├── remote.py              # RemoteClient (REST + WebSocket)
│   └── models.py              # Shared response types
│
├── cli/                       # CLI commands
│   ├── __init__.py
│   ├── main.py                # Entry point, arg parsing
│   ├── repl.py                # Interactive REPL
│   └── commands.py            # Command implementations
│
├── core/                      # Shared game logic (used by both)
│   ├── __init__.py
│   ├── orchestrator.py        # Page generation loop (moved from raunch/)
│   ├── world.py               # WorldState (moved from raunch/)
│   ├── scenario.py            # Scenario loading
│   └── agents/                # Narrator, Character agents
│       ├── narrator.py
│       └── character.py
│
├── db.py                      # SQLite (server-side only)
└── display.py                 # CLI display helpers
```

**Import rules:**
- `client/` never imports from `server/`
- `client/local.py` imports from `core/` to run game in-process
- `client/remote.py` only uses `httpx` + `websockets` (network calls)
- `server/` imports from `core/` for game logic

---

## REST API Endpoints

### Health
```
GET  /health                                → {"status": "ok"}
```

### Scenarios
```
GET  /api/v1/scenarios                      → List available scenarios
GET  /api/v1/scenarios/{name}               → Scenario details
POST /api/v1/scenarios                      → Save new scenario
```

### Books
```
POST /api/v1/books                          → Open book → {book_id, bookmark}
     body: {scenario: "milk_money", private?: bool}
GET  /api/v1/books                          → List books (owned/joined)
GET  /api/v1/books/{id}                     → Book state
DELETE /api/v1/books/{id}                   → Close book (owner only)
```

### Join/Invite
```
POST /api/v1/books/join                     → Join via bookmark → {book_id}
     body: {bookmark: "MILK-1234"}
GET  /api/v1/books/{id}/bookmark            → Get/regenerate bookmark (owner)
```

### Readers (multiplayer)
```
GET  /api/v1/books/{id}/readers             → List connected readers
DELETE /api/v1/books/{id}/readers/{rid}     → Kick reader (owner)
```

### Characters
```
GET  /api/v1/books/{id}/characters          → List characters
POST /api/v1/books/{id}/characters          → Add character
DELETE /api/v1/books/{id}/characters/{name} → Remove character
POST /api/v1/books/{id}/characters/grab     → Promote NPC → character
     body: {name: "Bartender"}
```

### Pages
```
GET  /api/v1/books/{id}/pages               → Page history
GET  /api/v1/books/{id}/pages/{num}         → Single page with character data
```

### Book Controls (CLI power commands)
```
POST /api/v1/books/{id}/pause               → Pause page generation
POST /api/v1/books/{id}/resume              → Resume
POST /api/v1/books/{id}/page                → Trigger next page
PUT  /api/v1/books/{id}/settings            → Update settings
     body: {page_interval: 30}
```

---

## WebSocket Protocol

### Connection
```
/ws/{book_id}?reader={reader_id}
```

### Client → Server Commands

**Reader identity:**
```json
{"cmd": "join", "nickname": "Boss"}
{"cmd": "ready"}
```

**Character attachment (session-stateful):**
```json
{"cmd": "attach", "character": "Jake"}
{"cmd": "detach"}
```

**Actions (require attachment):**
```json
{"cmd": "action", "text": "..."}
{"cmd": "whisper", "text": "..."}
```

**Director mode (no attachment needed):**
```json
{"cmd": "director", "text": "..."}
```

### Server → Client Events

```json
{"type": "page", "page": 1, "narration": "...", "characters": {...}}
{"type": "page_generating", "page": 2}
{"type": "attached", "character": "Jake"}
{"type": "detached"}
{"type": "reader_joined", "reader_id": "...", "nickname": "..."}
{"type": "reader_left", "reader_id": "..."}
{"type": "error", "message": "..."}
```

---

## CLI Client Modes

```bash
# Local mode (default) - direct imports, no server needed
raunch play milk_money

# Remote mode - connect to any server via WebSocket
raunch connect raunch.onrender.com
raunch connect localhost:8000
raunch connect my-server.com --bookmark MILK-1234
```

### BookClient Protocol

```python
class BookClient(Protocol):
    """Unified interface for CLI - works local or remote"""

    # Book lifecycle
    def open_book(scenario: str) -> tuple[str, str]: ...  # → (book_id, bookmark)
    def close_book(book_id: str): ...
    def join_book(bookmark: str) -> str: ...  # → book_id

    # Reader/character
    def attach(character: str): ...
    def detach(): ...
    def action(text: str): ...
    def whisper(text: str): ...

    # Power commands
    def pause(): ...
    def resume(): ...
    def trigger_page(): ...
    def grab(npc_name: str): ...
    def list_characters() -> list: ...

    # Streaming (callback-based)
    def on_page(callback: Callable[[Page], None]): ...
```

### Implementations

- **LocalClient**: Direct imports from `core/`, runs Orchestrator in-process
- **RemoteClient**: REST + WebSocket to remote server, no game logic imports

---

## Database Schema

SQLite - simple, self-hostable, perfect for single-server deployments.

### New Tables

```sql
-- Librarians (users)
CREATE TABLE librarians (
    id TEXT PRIMARY KEY,
    nickname TEXT NOT NULL,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

-- Books (persistent story instances)
CREATE TABLE books (
    id TEXT PRIMARY KEY,
    bookmark TEXT UNIQUE NOT NULL,
    scenario_name TEXT NOT NULL,
    owner_id TEXT REFERENCES librarians(id),
    private INTEGER DEFAULT 0,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    last_active TEXT,
    page_count INTEGER DEFAULT 0
);

-- Book access (who can join)
CREATE TABLE book_access (
    book_id TEXT REFERENCES books(id),
    librarian_id TEXT REFERENCES librarians(id),
    role TEXT DEFAULT 'reader',  -- 'owner' | 'reader'
    PRIMARY KEY (book_id, librarian_id)
);
```

### Existing Tables (Updated)

- `pages`: `world_id` → `book_id`
- `character_pages`: `world_id` → `book_id`
- `characters`: `world_id` → `book_id`

### Book Limits

```python
MAX_BOOKS_PER_LIBRARIAN = 5  # configurable

def open_book(self, scenario: str, librarian_id: str) -> Book:
    count = db.count_books_for_librarian(librarian_id)
    if count >= MAX_BOOKS_PER_LIBRARIAN:
        raise BookLimitReached(f"Max {MAX_BOOKS_PER_LIBRARIAN} books")
    ...
```

---

## Migration Path

### Phase 1: New API alongside old
- New `server/` module runs alongside existing `api.py`
- Both mounted on same FastAPI app
- Existing React app continues working

### Phase 2: React app updated
- React app migrates to new `/api/v1/books/...` endpoints
- Old endpoints deprecated

### Phase 3: CLI uses client module
- CLI switches from direct orchestrator import to `LocalClient`/`RemoteClient`
- Enables remote play via `raunch connect`

### Phase 4: Cleanup
- Old `api.py` removed
- Single unified API

---

## API Design Rules

| Category | Transport | Examples |
|----------|-----------|----------|
| Queries | REST | Get book state, list characters, page history |
| One-shot mutations | REST | Pause, resume, grab NPC, add character |
| Session-stateful ops | WebSocket | Attach, action, whisper |
| Streaming | WebSocket | Page updates, reader join/leave events |

---

## Authentication (v1)

For alpha/v1, authentication is **anonymous with auto-generated librarians**:

- First request creates an anonymous librarian (UUID stored in browser localStorage / CLI config)
- No login required - the librarian ID acts as a bearer token
- Book ownership tied to librarian ID
- Future: OAuth/magic links layered on top

**How it works:**
```
POST /api/v1/librarians → {librarian_id: "uuid"}  # Create anonymous librarian
Header: X-Librarian-ID: uuid                       # All subsequent requests
```

WebSocket authenticates via query param:
```
/ws/{book_id}?librarian={librarian_id}&reader={reader_id}
```

---

## Book Lifecycle

Books are **always persisted** to SQLite. Memory management:

1. **On startup**: Library loads book metadata (not full state) from DB
2. **On access**: `Library.get_book(id)` loads full state into memory if not present
3. **Active**: Book stays in memory while readers are connected
4. **Idle timeout**: After 30 min with no readers, book state saved and unloaded from memory
5. **On close**: `DELETE /api/v1/books/{id}` removes from memory and DB

When a book unloads:
- WebSocket connections already closed (no readers)
- Next access reloads from DB seamlessly

```python
class Library:
    IDLE_TIMEOUT = 30 * 60  # seconds

    async def _cleanup_loop(self):
        """Background task to unload idle books."""
        while True:
            await asyncio.sleep(60)
            for book_id, book in list(self.books.items()):
                if book.idle_seconds > self.IDLE_TIMEOUT:
                    await book.save()
                    del self.books[book_id]
```

---

## Error Handling

### WebSocket Errors

| Code | Condition | Response |
|------|-----------|----------|
| `not_attached` | `action`/`whisper` sent without attachment | `{"type": "error", "code": "not_attached", "message": "Attach to a character first"}` |
| `character_taken` | Attaching to character another reader has | `{"type": "error", "code": "character_taken", "message": "Jake is controlled by another reader"}` |
| `book_closed` | Book deleted while connected | `{"type": "error", "code": "book_closed", "message": "Book has been closed"}` + connection closed |
| `invalid_command` | Unknown or malformed command | `{"type": "error", "code": "invalid_command", "message": "Unknown command: xyz"}` |
| `not_found` | Character/page doesn't exist | `{"type": "error", "code": "not_found", "message": "Character 'Bob' not found"}` |

### REST Errors

Standard HTTP status codes:
- `400` - Invalid request body
- `401` - Missing/invalid librarian ID
- `403` - Not book owner (for owner-only actions)
- `404` - Book/character/page not found
- `429` - Rate limited (future)

---

## Response Schemas

### Book State
```json
GET /api/v1/books/{id}

{
  "book_id": "abc123",
  "bookmark": "MILK-1234",
  "scenario_name": "milk_money",
  "owner_id": "lib-uuid",
  "private": false,
  "page_count": 42,
  "created_at": "2026-03-15T10:00:00Z",
  "last_active": "2026-03-15T14:30:00Z",
  "characters": ["Jake Morrison", "Bessie Mae"],
  "readers": [
    {"reader_id": "r1", "nickname": "Boss", "attached_to": "Jake Morrison"}
  ],
  "paused": false,
  "page_interval": 30
}
```

### Character List
```json
GET /api/v1/books/{id}/characters

[
  {
    "name": "Jake Morrison",
    "species": "human",
    "emotional_state": "nervous",
    "attached_by": "r1"  // null if unattached
  },
  {
    "name": "Bessie Mae",
    "species": "cow-girl",
    "emotional_state": "playful",
    "attached_by": null
  }
]
```

### Page History
```json
GET /api/v1/books/{id}/pages?limit=10&offset=0

{
  "pages": [
    {
      "page": 1,
      "narration": "The barn doors creaked open...",
      "mood": "tense",
      "world_time": "Morning",
      "created_at": "2026-03-15T10:05:00Z",
      "characters": {
        "Jake Morrison": {
          "action": "stepped inside cautiously",
          "dialogue": "Hello? Anyone here?",
          "emotional_state": "nervous"
        }
      }
    }
  ],
  "total": 42,
  "limit": 10,
  "offset": 0
}
```

### Bookmark Format

Bookmarks are **4 random uppercase letters + 4 digits**: `ABCD-1234`

- Case-insensitive for input
- Generated randomly, checked for uniqueness
- No profanity filter (can add later)

---

## Implementation Phases

This spec covers multiple subsystems. Recommended implementation order:

### Phase 1: Core Server Module
- `server/library.py`, `server/book.py`, `server/reader.py`
- `server/routes/books.py`, `server/routes/health.py`
- `server/ws.py`
- Database schema changes

### Phase 2: Client Module
- `client/base.py`, `client/remote.py`
- `client/models.py`

### Phase 3: CLI Refactor
- `cli/` module using client
- `client/local.py` (in-process mode)

### Phase 4: Migration
- React app endpoint updates
- Old `api.py` deprecation

Each phase can be its own implementation plan.

---

## Success Criteria

- [ ] CLI can connect to remote server with `raunch connect`
- [ ] React app uses same endpoints as CLI
- [ ] Multiple books can run concurrently
- [ ] Bookmark sharing works for multiplayer
- [ ] No duplicate code paths for same operations
