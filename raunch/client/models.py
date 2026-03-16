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
