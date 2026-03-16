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
