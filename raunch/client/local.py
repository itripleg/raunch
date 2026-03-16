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
        self._orchestrator.submit_player_action(text)

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
