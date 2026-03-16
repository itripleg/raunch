# tests/test_client_base.py
"""Tests for BookClient protocol."""

import pytest
from typing import Protocol, runtime_checkable


def test_book_client_protocol_exists():
    """BookClient protocol should be importable."""
    from raunch.client.base import BookClient

    # Should be a Protocol class
    assert hasattr(BookClient, "__protocol_attrs__") or issubclass(BookClient, Protocol)


def test_book_client_has_required_methods():
    """BookClient should define all required methods."""
    from raunch.client.base import BookClient

    # Check key methods exist
    required = [
        "open_book",
        "close_book",
        "join_book",
        "attach",
        "detach",
        "action",
        "whisper",
        "pause",
        "resume",
        "trigger_page",
        "list_characters",
        "on_page",
    ]

    for method in required:
        assert hasattr(BookClient, method), f"Missing method: {method}"
