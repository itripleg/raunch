"""Tests for Book wrapper class."""

import pytest
from unittest.mock import MagicMock, patch


@pytest.fixture
def mock_orchestrator():
    """Create a mock orchestrator."""
    orch = MagicMock()
    orch.world = MagicMock()
    orch.world.world_id = "test-world"
    orch.world.world_name = "Test World"
    orch.world.tick_count = 5
    orch.characters = {"Jake": MagicMock(), "Bessie": MagicMock()}
    orch._paused = False
    orch.tick_interval = 30
    orch._running = True
    return orch


def test_book_creation():
    """Book should be created with ID and bookmark."""
    from raunch.server.book import Book

    book = Book(
        book_id="test123",
        bookmark="ABCD-1234",
        scenario_name="milk_money",
        owner_id="owner123"
    )

    assert book.book_id == "test123"
    assert book.bookmark == "ABCD-1234"
    assert book.scenario_name == "milk_money"
    assert book.owner_id == "owner123"


def test_book_add_reader():
    """Book should track readers."""
    from raunch.server.book import Book
    from raunch.server.models import Reader

    book = Book(
        book_id="test123",
        bookmark="ABCD-1234",
        scenario_name="milk_money",
        owner_id="owner123"
    )

    reader = Reader.create("TestUser")
    book.add_reader(reader)

    assert reader.reader_id in book.readers
    assert book.get_reader(reader.reader_id) == reader


def test_book_get_state(mock_orchestrator):
    """Book should return its state."""
    from raunch.server.book import Book

    book = Book(
        book_id="test123",
        bookmark="ABCD-1234",
        scenario_name="milk_money",
        owner_id="owner123"
    )
    book._orchestrator = mock_orchestrator

    state = book.get_state()

    assert state.book_id == "test123"
    assert state.bookmark == "ABCD-1234"
    assert state.characters == ["Jake", "Bessie"]
    assert state.paused == False
