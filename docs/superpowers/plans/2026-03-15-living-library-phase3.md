# Living Library API Phase 3: LocalClient & CLI Refactor

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Create LocalClient (in-process orchestrator) and add `raunch connect` command for remote server connections, enabling both local play and remote multiplayer through the unified BookClient interface.

**Architecture:** LocalClient wraps the existing Orchestrator directly without network calls, implementing the same BookClient interface as RemoteClient. The CLI gets a new `connect` command that uses RemoteClient to join remote servers. The existing `start` command continues working unchanged.

**Tech Stack:** Python 3.11+, Click (CLI), existing Orchestrator, pytest

---

## File Structure

```
raunch/client/
├── __init__.py          # Updated exports
├── base.py              # BookClient protocol (exists)
├── models.py            # Response types (exists)
├── remote.py            # RemoteClient (exists)
└── local.py             # LocalClient - in-process orchestrator (NEW)
```

**CLI changes:**
- Add `raunch connect <host>` command to `raunch/main.py`
- Uses RemoteClient for remote server connections

---

## Chunk 1: LocalClient Implementation

### Task 1: Create LocalClient with book lifecycle methods

**Files:**
- Create: `raunch/client/local.py`
- Test: `tests/test_client_local.py`

- [ ] **Step 1: Write the failing test**

```python
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
        monkeypatch.setattr("raunch.db._local", type("Local", (), {})())

        from raunch import db
        db.init_db()
        yield db_path


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
    assert book.scenario_name == "test_solo_scenario"


def test_local_client_close_book(temp_db):
    """LocalClient should close the book."""
    from raunch.client.local import LocalClient

    client = LocalClient(nickname="TestUser")
    client.open_book("test_solo_scenario")
    client.close_book()

    assert client.book_id is None
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pytest tests/test_client_local.py::test_local_client_creation -v`
Expected: FAIL - module not found

- [ ] **Step 3: Create LocalClient with basic structure**

```python
# raunch/client/local.py
"""LocalClient - in-process orchestrator wrapper implementing BookClient."""

import logging
import uuid
from typing import Optional, List, Tuple, Callable, Dict, Any

from .base import PageCallback
from .models import (
    Page,
    BookInfo,
    CharacterInfo,
    CharacterPage,
    ReaderInfo,
)
from ..orchestrator import Orchestrator
from ..wizard import load_scenario
from .. import db

logger = logging.getLogger(__name__)


class LocalClient:
    """
    Client that runs the orchestrator in-process.

    Implements BookClient protocol for local play without network calls.
    This is used by `raunch play` for single-player local games.
    """

    def __init__(self, nickname: str = "Player"):
        """
        Initialize LocalClient.

        Args:
            nickname: Display name for this player
        """
        self.nickname = nickname
        self._librarian_id: Optional[str] = None
        self._book_id: Optional[str] = None
        self._bookmark: Optional[str] = None
        self._orchestrator: Optional[Orchestrator] = None
        self._reader_id: Optional[str] = None
        self._attached_to: Optional[str] = None
        self._page_callbacks: List[PageCallback] = []

        # Ensure database is initialized
        db.init_db()

        # Create or get local librarian
        self._librarian_id = self._get_or_create_librarian(nickname)

    def _get_or_create_librarian(self, nickname: str) -> str:
        """Get existing local librarian or create one."""
        # For local mode, use a consistent local librarian ID
        local_id = "local-player"
        librarian = db.get_librarian(local_id)
        if librarian:
            return local_id

        # Create the local librarian directly in DB
        conn = db._get_conn()
        conn.execute(
            "INSERT OR IGNORE INTO librarians (id, nickname) VALUES (?, ?)",
            (local_id, nickname)
        )
        conn.commit()
        return local_id

    @property
    def librarian_id(self) -> Optional[str]:
        """Current librarian ID."""
        return self._librarian_id

    @property
    def connected(self) -> bool:
        """Whether client has an open book."""
        return self._book_id is not None

    @property
    def book_id(self) -> Optional[str]:
        """Current book ID, if connected."""
        return self._book_id

    @property
    def reader_id(self) -> Optional[str]:
        """Current reader ID."""
        return self._reader_id

    # --- BOOK LIFECYCLE ---

    def open_book(self, scenario: str, private: bool = False) -> Tuple[str, str]:
        """
        Open a new book from a scenario.

        Args:
            scenario: Scenario name to load
            private: Whether book is private (ignored for local)

        Returns:
            Tuple of (book_id, bookmark)
        """
        # Load scenario
        scenario_data = load_scenario(scenario)
        if not scenario_data:
            raise ValueError(f"Scenario '{scenario}' not found")

        # Create book in database
        book_data = db.create_book(scenario, self._librarian_id, private)
        self._book_id = book_data["id"]
        self._bookmark = book_data["bookmark"]

        # Create orchestrator
        self._orchestrator = Orchestrator()
        self._orchestrator.world.world_name = scenario_data.get("scenario_name", scenario)
        self._orchestrator.world.scenario = scenario_data

        # Apply scenario to orchestrator
        self._apply_scenario(scenario_data)

        # Auto-join as reader
        self._reader_id = f"local-{uuid.uuid4().hex[:8]}"

        # Wire up page callback
        def on_page_generated(results: Dict[str, Any]):
            page = self._results_to_page(results)
            for callback in self._page_callbacks:
                try:
                    callback(page)
                except Exception as e:
                    logger.error(f"Page callback error: {e}")

        self._orchestrator.add_page_callback(on_page_generated)

        return self._book_id, self._bookmark

    def _apply_scenario(self, scenario_data: Dict[str, Any]) -> None:
        """Apply scenario to orchestrator."""
        from ..agents.character import Character

        # Set up location from scenario
        setting = scenario_data.get("setting", "")
        loc_name = scenario_data.get("scenario_name", "The Scene")
        self._orchestrator.world.locations = {
            loc_name: {
                "description": setting,
                "characters": [],
            }
        }

        # Create characters
        for char_data in scenario_data.get("characters", []):
            char = Character(
                name=char_data["name"],
                species=char_data.get("species", "Human"),
                personality=char_data.get("personality", ""),
                appearance=char_data.get("appearance", ""),
                desires=char_data.get("desires", ""),
                backstory=char_data.get("backstory", ""),
                kinks=char_data.get("kinks", ""),
            )
            self._orchestrator.add_character(char, location=loc_name)

    def _results_to_page(self, results: Dict[str, Any]) -> Page:
        """Convert orchestrator results to Page model."""
        characters = {}
        for name, char_data in results.get("characters", {}).items():
            characters[name] = CharacterPage(
                name=name,
                inner_thoughts=char_data.get("inner_thoughts"),
                action=char_data.get("action"),
                dialogue=char_data.get("dialogue"),
                emotional_state=char_data.get("emotional_state"),
                desires_update=char_data.get("desires_update"),
            )

        return Page(
            page_num=results.get("page", 0),
            narration=results.get("narration", ""),
            mood=results.get("mood", ""),
            world_time=results.get("world_time", ""),
            events=results.get("events", []),
            characters=characters,
        )

    def close_book(self) -> None:
        """Close the current book."""
        if self._orchestrator:
            self._orchestrator.stop()
            self._orchestrator = None

        if self._book_id:
            db.delete_book(self._book_id)

        self._book_id = None
        self._bookmark = None
        self._reader_id = None
        self._attached_to = None

    def join_book(self, bookmark: str) -> str:
        """Join an existing book via bookmark (not typically used for local)."""
        book_data = db.get_book_by_bookmark(bookmark)
        if not book_data:
            raise ValueError(f"Book with bookmark '{bookmark}' not found")

        self._book_id = book_data["id"]
        self._bookmark = book_data["bookmark"]
        # Note: For local mode, we'd need to load the orchestrator state
        # This is a simplified implementation
        return self._book_id

    def get_book(self) -> Optional[BookInfo]:
        """Get current book information."""
        if not self._book_id:
            return None

        characters = list(self._orchestrator.characters.keys()) if self._orchestrator else []
        page_count = self._orchestrator.world.page_count if self._orchestrator else 0

        return BookInfo(
            book_id=self._book_id,
            bookmark=self._bookmark or "",
            scenario_name=self._orchestrator.world.world_name if self._orchestrator else "",
            owner_id=self._librarian_id,
            private=False,
            page_count=page_count,
            characters=characters,
            paused=self._orchestrator._paused if self._orchestrator else False,
            page_interval=self._orchestrator.page_interval if self._orchestrator else 30,
        )

    def list_books(self) -> List[BookInfo]:
        """List all books for this librarian."""
        books = db.list_books_for_librarian(self._librarian_id)
        return [BookInfo.from_dict(b) for b in books]
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pytest tests/test_client_local.py -v`
Expected: All PASS

- [ ] **Step 5: Commit**

```bash
git add raunch/client/local.py tests/test_client_local.py
git commit -m "feat(client): add LocalClient with book lifecycle methods"
```

---

### Task 2: Add control methods to LocalClient

**Files:**
- Modify: `raunch/client/local.py`
- Test: `tests/test_client_local.py`

- [ ] **Step 1: Add more tests**

```python
# Add to tests/test_client_local.py

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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pytest tests/test_client_local.py::test_local_client_pause_resume -v`
Expected: FAIL - methods not implemented

- [ ] **Step 3: Add control methods to LocalClient**

```python
# Add to raunch/client/local.py, inside LocalClient class

    # --- READER/CHARACTER ---

    def join_as_reader(self, nickname: str) -> ReaderInfo:
        """Join as reader (auto-done in local mode)."""
        return ReaderInfo(
            reader_id=self._reader_id or "",
            nickname=nickname,
        )

    def attach(self, character: str) -> None:
        """Attach to a character's POV."""
        if not self._orchestrator:
            raise ValueError("No book open")

        if character not in self._orchestrator.characters:
            raise ValueError(f"Character '{character}' not found")

        self._attached_to = character
        self._orchestrator.attach(character)

    def detach(self) -> None:
        """Detach from current character."""
        self._attached_to = None
        if self._orchestrator:
            self._orchestrator.attach(None)

    def action(self, text: str) -> None:
        """Submit an action for the attached character."""
        if not self._orchestrator:
            raise ValueError("No book open")
        if not self._attached_to:
            raise ValueError("Not attached to a character")

        # Submit as player action
        self._orchestrator.submit_player_action(self._attached_to, text)

    def whisper(self, text: str) -> None:
        """Send a whisper to the attached character."""
        if not self._orchestrator:
            raise ValueError("No book open")
        if not self._attached_to:
            raise ValueError("Not attached to a character")

        self._orchestrator.submit_influence(self._attached_to, text)

    def director(self, text: str) -> None:
        """Send director guidance."""
        if not self._orchestrator:
            raise ValueError("No book open")

        self._orchestrator.submit_director_guidance(text)

    # --- POWER COMMANDS ---

    def pause(self) -> None:
        """Pause page generation."""
        if self._orchestrator:
            self._orchestrator.pause()

    def resume(self) -> None:
        """Resume page generation."""
        if self._orchestrator:
            self._orchestrator.resume()

    def trigger_page(self) -> bool:
        """Manually trigger next page generation."""
        if not self._orchestrator:
            return False
        return self._orchestrator.trigger_page()

    def set_page_interval(self, seconds: int) -> None:
        """Set page generation interval."""
        if self._orchestrator:
            self._orchestrator.set_page_interval(seconds)

    def grab(self, npc_name: str) -> CharacterInfo:
        """Promote NPC to character."""
        # TODO: Implement NPC promotion
        raise NotImplementedError("NPC promotion not yet implemented")

    def list_characters(self) -> List[CharacterInfo]:
        """List all characters in the current book."""
        if not self._orchestrator:
            return []

        return [
            CharacterInfo(
                name=name,
                species=char.character_data.get("species", ""),
                emotional_state=char.emotional_state,
            )
            for name, char in self._orchestrator.characters.items()
        ]

    # --- STREAMING ---

    def on_page(self, callback: PageCallback) -> None:
        """Register callback for page events."""
        self._page_callbacks.append(callback)

    def disconnect(self) -> None:
        """Disconnect (close book for local mode)."""
        self.close_book()

    def start(self) -> None:
        """Start the orchestrator loop."""
        if self._orchestrator:
            self._orchestrator.start()

    def stop(self) -> None:
        """Stop the orchestrator loop."""
        if self._orchestrator:
            self._orchestrator.stop()
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pytest tests/test_client_local.py -v`
Expected: All PASS

- [ ] **Step 5: Commit**

```bash
git add raunch/client/local.py tests/test_client_local.py
git commit -m "feat(client): add control methods to LocalClient"
```

---

### Task 3: Update client module exports

**Files:**
- Modify: `raunch/client/__init__.py`

- [ ] **Step 1: Add LocalClient export**

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
from .local import LocalClient

__all__ = [
    # Protocol
    "BookClient",
    "PageCallback",
    # Implementations
    "RemoteClient",
    "LocalClient",
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
git commit -m "feat(client): export LocalClient"
```

---

## Chunk 2: CLI `connect` Command

### Task 4: Add `raunch connect` command

**Files:**
- Modify: `raunch/main.py`
- Test: Manual testing (CLI integration)

- [ ] **Step 1: Add connect command to CLI**

Add after the existing `attach` command in `raunch/main.py`:

```python
# Add these imports at top of main.py
from .client import RemoteClient, Page

# Add this command after the existing 'attach' command

@cli.command()
@click.argument("host")
@click.option("--port", default=8000, type=int, help="Server port (default: 8000)")
@click.option("--bookmark", default=None, help="Book bookmark to join")
@click.option("--nickname", default=None, help="Your display name")
def connect(host, port, bookmark, nickname):
    """Connect to a remote Living Library server.

    Examples:
        raunch connect localhost
        raunch connect raunch.example.com --port 8000
        raunch connect my-server.com --bookmark MILK-1234
    """
    # Build server URL
    if not host.startswith("http"):
        host = f"http://{host}"
    if port != 80 and port != 443:
        server_url = f"{host}:{port}"
    else:
        server_url = host

    # Get nickname
    if not nickname:
        nickname = os.environ.get("USER", os.environ.get("USERNAME", "Anonymous"))

    console.print(f"[cyan]Connecting to {server_url}...[/cyan]")

    try:
        client = RemoteClient(server_url, nickname=nickname)
        console.print(f"[green]Connected as {nickname}[/green]")
        console.print(f"[dim]Librarian ID: {client.librarian_id}[/dim]")
    except Exception as e:
        console.print(f"[red]Failed to connect: {e}[/red]")
        return

    # If bookmark provided, join that book
    if bookmark:
        try:
            book_id = client.join_book(bookmark)
            console.print(f"[green]Joined book: {book_id}[/green]")
        except Exception as e:
            console.print(f"[red]Failed to join book: {e}[/red]")
            return
    else:
        # List available books or create new one
        books = client.list_books()
        if books:
            console.print("\n[bold]Your Books:[/bold]")
            for i, book in enumerate(books, 1):
                console.print(f"  {i}. {book.scenario_name} [{book.bookmark}] - {book.page_count} pages")

            console.print("\n[dim]Enter number to join, 'new' to create, or 'q' to quit[/dim]")
            try:
                choice = input("> ").strip().lower()
            except (EOFError, KeyboardInterrupt):
                return

            if choice == 'q':
                return
            elif choice == 'new':
                _connect_create_book(client)
            elif choice.isdigit() and 1 <= int(choice) <= len(books):
                book = books[int(choice) - 1]
                client.join_book(book.bookmark)
                console.print(f"[green]Joined: {book.scenario_name}[/green]")
            else:
                console.print("[red]Invalid choice[/red]")
                return
        else:
            console.print("[dim]No books yet. Creating a new one...[/dim]")
            _connect_create_book(client)

    # Now we're connected to a book - start interactive session
    if not client.book_id:
        console.print("[red]No book selected[/red]")
        return

    _connect_interactive_loop(client)


def _connect_create_book(client: RemoteClient) -> None:
    """Create a new book on remote server."""
    from .wizard import list_scenarios

    scenarios = list_scenarios()
    if not scenarios:
        console.print("[yellow]No scenarios available on this server[/yellow]")
        return

    console.print("\n[bold]Available Scenarios:[/bold]")
    for i, s in enumerate(scenarios, 1):
        console.print(f"  {i}. {s['name']}")

    try:
        choice = input("\nChoose scenario > ").strip()
    except (EOFError, KeyboardInterrupt):
        return

    if choice.isdigit() and 1 <= int(choice) <= len(scenarios):
        scenario = scenarios[int(choice) - 1]
        book_id, bookmark = client.open_book(scenario['file'].replace('.json', ''))
        console.print(f"[green]Created book: {bookmark}[/green]")
        console.print(f"[dim]Share this code with friends to let them join![/dim]")


def _connect_interactive_loop(client: RemoteClient) -> None:
    """Interactive session for remote connection."""
    # Connect WebSocket
    try:
        client.connect_ws()
        reader = client.join_as_reader(client.nickname)
        console.print(f"[green]Joined as reader: {reader.nickname}[/green]")
    except Exception as e:
        console.print(f"[red]WebSocket error: {e}[/red]")
        return

    # Register page callback
    def on_page(page: Page):
        console.print(f"\n[bold cyan]── Page {page.page_num} ──[/bold cyan]")
        console.print(page.narration)
        for name, char in page.characters.items():
            if char.dialogue:
                console.print(f"  [bold]{name}:[/bold] \"{char.dialogue}\"")

    client.on_page(on_page)

    # Show help
    console.print(
        Panel(
            "[bold]Commands:[/bold]\n"
            "  [bold]c[/bold], [bold]characters[/bold]  List characters\n"
            "  [bold]a[/bold] <name>        Attach to character\n"
            "  [bold]d[/bold]               Detach\n"
            "  [bold]w[/bold] <text>        Whisper to attached character\n"
            "  [bold]>[/bold] <text>        Submit action\n"
            "  [bold]q[/bold]               Quit",
            title="Remote Session",
            border_style="cyan",
        )
    )

    # Input loop
    try:
        while True:
            try:
                cmd = input("> ").strip()
            except EOFError:
                break

            if not cmd:
                continue

            parts = cmd.split(None, 1)
            cmd_name = parts[0].lower()
            cmd_arg = parts[1] if len(parts) > 1 else ""

            if cmd_name in ('q', 'quit', 'exit'):
                break
            elif cmd_name in ('c', 'chars', 'characters'):
                chars = client.list_characters()
                for c in chars:
                    attached = " [attached]" if c.name == client._attached_to else ""
                    console.print(f"  {c.name}{attached}")
            elif cmd_name in ('a', 'attach'):
                if not cmd_arg:
                    console.print("[red]Usage: a <character_name>[/red]")
                else:
                    try:
                        client.attach(cmd_arg)
                        console.print(f"[green]Attached to {cmd_arg}[/green]")
                    except Exception as e:
                        console.print(f"[red]{e}[/red]")
            elif cmd_name in ('d', 'detach'):
                client.detach()
                console.print("[dim]Detached[/dim]")
            elif cmd_name in ('w', 'whisper'):
                if not cmd_arg:
                    console.print("[red]Usage: w <whisper text>[/red]")
                else:
                    try:
                        client.whisper(cmd_arg)
                        console.print("[dim]Whispered[/dim]")
                    except Exception as e:
                        console.print(f"[red]{e}[/red]")
            elif cmd_name.startswith('>'):
                # Action - include the > in the text if needed
                action_text = cmd[1:].strip() if cmd.startswith('>') else cmd_arg
                if action_text:
                    try:
                        client.action(action_text)
                        console.print("[dim]Action submitted[/dim]")
                    except Exception as e:
                        console.print(f"[red]{e}[/red]")
            else:
                # Treat as action
                try:
                    client.action(cmd)
                    console.print("[dim]Action submitted[/dim]")
                except Exception as e:
                    console.print(f"[red]{e}[/red]")

    except KeyboardInterrupt:
        pass
    finally:
        client.disconnect()
        console.print("[dim]Disconnected[/dim]")
```

- [ ] **Step 2: Test manually**

Run: `python -m raunch.main connect localhost --port 8000`
Expected: Shows connection attempt (may fail if no server running, which is fine)

- [ ] **Step 3: Commit**

```bash
git add raunch/main.py
git commit -m "feat(cli): add 'raunch connect' command for remote servers"
```

---

### Task 5: Add `raunch play` command using LocalClient

**Files:**
- Modify: `raunch/main.py`

- [ ] **Step 1: Add play command**

Add this command after `connect`:

```python
@cli.command()
@click.argument("scenario")
@click.option("--name", "nickname", default=None, help="Your display name")
def play(scenario, nickname):
    """Play a scenario locally (single-player mode).

    This runs the game entirely on your machine without a server.

    Examples:
        raunch play milk_money
        raunch play my_scenario --name "Boss"
    """
    from .client import LocalClient

    if not nickname:
        nickname = os.environ.get("USER", os.environ.get("USERNAME", "Player"))

    console.print(f"[cyan]Loading scenario: {scenario}[/cyan]")

    try:
        client = LocalClient(nickname=nickname)
        book_id, bookmark = client.open_book(scenario)
        console.print(f"[green]Book opened: {bookmark}[/green]")
    except ValueError as e:
        console.print(f"[red]Error: {e}[/red]")
        return
    except Exception as e:
        console.print(f"[red]Failed to start: {e}[/red]")
        return

    # Show characters
    chars = client.list_characters()
    console.print(f"\n[bold]Characters:[/bold]")
    for c in chars:
        console.print(f"  • {c.name} ({c.species})")

    # Register page callback
    def on_page(page: Page):
        console.print(f"\n[bold bright_magenta]━━━ Page {page.page_num} ━━━[/bold bright_magenta]")
        console.print(f"[dim]{page.mood} | {page.world_time}[/dim]\n")
        console.print(page.narration)
        console.print()
        for name, char in page.characters.items():
            if char.action or char.dialogue:
                action_text = char.action or ""
                dialogue_text = f'"{char.dialogue}"' if char.dialogue else ""
                console.print(f"  [bold]{name}[/bold] {action_text} {dialogue_text}")

    client.on_page(on_page)

    # Show help
    console.print(
        Panel(
            "[bold]Commands:[/bold]\n"
            "  [bold]n[/bold], Enter       Next page (manual mode)\n"
            "  [bold]p[/bold]              Pause/resume\n"
            "  [bold]t[/bold] <seconds>    Set page interval (0=manual)\n"
            "  [bold]c[/bold]              List characters\n"
            "  [bold]a[/bold] <name>       Attach to character\n"
            "  [bold]d[/bold]              Detach\n"
            "  [bold]w[/bold] <text>       Whisper to character\n"
            "  [bold]>[/bold] <text>       Submit action\n"
            "  [bold]q[/bold]              Quit",
            title="Local Play",
            border_style="bright_magenta",
        )
    )

    # Start orchestrator
    client.start()
    console.print("[green]Game started! Press Enter to advance pages.[/green]")

    # Input loop
    try:
        while True:
            try:
                cmd = input("> ").strip()
            except EOFError:
                break

            parts = cmd.split(None, 1)
            cmd_name = parts[0].lower() if parts else ""
            cmd_arg = parts[1] if len(parts) > 1 else ""

            if cmd_name in ('q', 'quit', 'exit'):
                break
            elif not cmd or cmd_name in ('n', 'next'):
                if client.trigger_page():
                    console.print("[dim]Generating page...[/dim]")
                else:
                    console.print("[yellow]Cannot generate page (already running or paused)[/yellow]")
            elif cmd_name in ('p', 'pause'):
                book = client.get_book()
                if book and book.paused:
                    client.resume()
                    console.print("[green]Resumed[/green]")
                else:
                    client.pause()
                    console.print("[yellow]Paused[/yellow]")
            elif cmd_name in ('t', 'timer', 'interval'):
                if cmd_arg:
                    try:
                        seconds = int(cmd_arg)
                        client.set_page_interval(seconds)
                        if seconds == 0:
                            console.print("[green]Manual mode[/green]")
                        else:
                            console.print(f"[green]Interval: {seconds}s[/green]")
                    except ValueError:
                        console.print("[red]Usage: t <seconds>[/red]")
            elif cmd_name in ('c', 'chars', 'characters'):
                chars = client.list_characters()
                for c in chars:
                    attached = " [attached]" if c.name == client._attached_to else ""
                    console.print(f"  {c.name} ({c.species}){attached}")
            elif cmd_name in ('a', 'attach'):
                if not cmd_arg:
                    console.print("[red]Usage: a <character_name>[/red]")
                else:
                    try:
                        client.attach(cmd_arg)
                        console.print(f"[green]Attached to {cmd_arg}[/green]")
                    except Exception as e:
                        console.print(f"[red]{e}[/red]")
            elif cmd_name in ('d', 'detach'):
                client.detach()
                console.print("[dim]Detached[/dim]")
            elif cmd_name in ('w', 'whisper'):
                if not cmd_arg:
                    console.print("[red]Usage: w <whisper text>[/red]")
                else:
                    try:
                        client.whisper(cmd_arg)
                        console.print("[dim]Whispered[/dim]")
                    except Exception as e:
                        console.print(f"[red]{e}[/red]")
            elif cmd_name.startswith('>') or cmd_arg:
                # Action
                action_text = cmd[1:].strip() if cmd.startswith('>') else cmd
                if action_text:
                    try:
                        client.action(action_text)
                        console.print("[dim]Action submitted[/dim]")
                    except Exception as e:
                        console.print(f"[red]{e}[/red]")
            else:
                console.print("[dim]Unknown command. Type 'q' to quit.[/dim]")

    except KeyboardInterrupt:
        pass
    finally:
        client.stop()
        console.print("[dim]Game ended.[/dim]")
```

- [ ] **Step 2: Test manually**

Run: `python -m raunch.main play test_solo_scenario`
Expected: Loads scenario and shows interactive prompt

- [ ] **Step 3: Commit**

```bash
git add raunch/main.py
git commit -m "feat(cli): add 'raunch play' command using LocalClient"
```

---

## Chunk 3: Final Verification

### Task 6: Run all tests and verify

- [ ] **Step 1: Run all client tests**

Run: `pytest tests/test_client_*.py -v`
Expected: All PASS

- [ ] **Step 2: Run all tests**

Run: `pytest tests/ -v --ignore=tests/test_parallel_characters.py`
Expected: All PASS (ignoring the pre-existing failures in test_parallel_characters.py)

- [ ] **Step 3: Manual CLI test**

Test the new commands:
```bash
# Test play command
python -m raunch.main play test_solo_scenario

# Test connect command (requires running server)
python -m raunch.main connect localhost --port 8000
```

- [ ] **Step 4: Final commit**

```bash
git add .
git commit -m "feat(cli): complete Phase 3 - LocalClient and CLI refactor"
```

---

## Summary

Phase 3 delivers:
- ✅ LocalClient - in-process orchestrator wrapper implementing BookClient
- ✅ LocalClient book lifecycle (open, close, join, get, list)
- ✅ LocalClient control methods (pause, resume, trigger_page, attach, etc.)
- ✅ `raunch connect` command for remote server connections
- ✅ `raunch play` command for local single-player mode
- ✅ Both commands use the unified BookClient interface

## Deferred to Phase 4

- Additional REST endpoints (characters CRUD, pages history, readers)
- React app migration to new API
- Old `api.py` deprecation
- Server-side orchestrator management (start book with running orchestrator)
