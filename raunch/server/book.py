"""Book wrapper class - wraps Orchestrator with reader management."""

from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Dict, Optional, List, Any, TYPE_CHECKING
import time

from .models import Reader, BookState


def _utcnow() -> datetime:
    """Return current UTC datetime (timezone-aware)."""
    return datetime.now(timezone.utc)

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
    created_at: datetime = field(default_factory=_utcnow)

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
            page_interval = orch.page_interval
            if orch.world:
                page_count = orch.world.page_count

        return BookState(
            book_id=self.book_id,
            bookmark=self.bookmark,
            scenario_name=self.scenario_name,
            owner_id=self.owner_id,
            private=self.private,
            page_count=page_count,
            created_at=self.created_at.isoformat() if isinstance(self.created_at, datetime) else str(self.created_at),
            last_active=_utcnow().isoformat(),
            characters=characters,
            readers=[r.to_dict() for r in self.readers.values()],
            paused=paused,
            page_interval=page_interval,
        )
