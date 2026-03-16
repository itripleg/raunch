"""Data models for the Living Library server."""

from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Optional, List, Dict, Any
import uuid


def _utcnow() -> datetime:
    """Return current UTC datetime (timezone-aware)."""
    return datetime.now(timezone.utc)


@dataclass
class Reader:
    """A reader connected to a book."""

    reader_id: str
    nickname: str
    librarian_id: Optional[str] = None
    attached_to: Optional[str] = None  # Character name
    ready: bool = False
    connected_at: datetime = field(default_factory=_utcnow)

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
