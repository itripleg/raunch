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
