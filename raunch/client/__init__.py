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
