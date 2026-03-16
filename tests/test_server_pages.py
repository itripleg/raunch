"""Tests for page history endpoints."""

import pytest
from fastapi.testclient import TestClient
import threading


@pytest.fixture
def client_with_db(monkeypatch, tmp_path):
    """Create a test client with temp database."""
    db_path = str(tmp_path / "test.db")
    monkeypatch.setattr("raunch.db.DB_PATH", db_path)

    # Reset the thread local storage to force fresh connections
    monkeypatch.setattr("raunch.db._local", threading.local())

    from raunch import db
    db.init_db()

    from raunch.server.library import reset_library
    reset_library()

    from raunch.server.app import create_app
    app = create_app()
    yield TestClient(app)

    # Close database connection before cleanup
    if hasattr(db._local, "conn") and db._local.conn:
        db._local.conn.close()
        db._local.conn = None


@pytest.fixture
def librarian_and_book(client_with_db):
    """Create a librarian and book for testing."""
    # Create librarian
    resp = client_with_db.post("/api/v1/librarians", json={"nickname": "TestOwner"})
    librarian_id = resp.json()["librarian_id"]
    headers = {"X-Librarian-ID": librarian_id}

    # Create book
    resp = client_with_db.post(
        "/api/v1/books",
        json={"scenario": "milk_money"},
        headers=headers
    )
    book_id = resp.json()["book_id"]

    return librarian_id, book_id, headers


def test_list_pages_empty(client_with_db, librarian_and_book):
    """GET /api/v1/books/{id}/pages should return empty initially."""
    librarian_id, book_id, headers = librarian_and_book

    resp = client_with_db.get(f"/api/v1/books/{book_id}/pages", headers=headers)
    assert resp.status_code == 200
    data = resp.json()
    assert "pages" in data
    assert data["total"] == 0
    assert data["pages"] == []


def test_list_pages_with_pagination(client_with_db, librarian_and_book):
    """Pages endpoint should support limit and offset."""
    librarian_id, book_id, headers = librarian_and_book

    resp = client_with_db.get(
        f"/api/v1/books/{book_id}/pages?limit=5&offset=0",
        headers=headers
    )
    assert resp.status_code == 200
    data = resp.json()
    assert "pages" in data
    assert data["limit"] == 5
    assert data["offset"] == 0


def test_list_pages_book_not_found(client_with_db, librarian_and_book):
    """Should return 404 for non-existent book."""
    librarian_id, book_id, headers = librarian_and_book

    resp = client_with_db.get("/api/v1/books/nonexistent/pages", headers=headers)
    assert resp.status_code == 404


def test_list_pages_invalid_librarian(client_with_db, librarian_and_book):
    """Invalid librarian ID should return 401."""
    librarian_id, book_id, headers = librarian_and_book

    resp = client_with_db.get(
        f"/api/v1/books/{book_id}/pages",
        headers={"X-Librarian-ID": "invalid"}
    )
    assert resp.status_code == 401


def test_get_page_not_found(client_with_db, librarian_and_book):
    """GET /api/v1/books/{id}/pages/{num} should return 404 for non-existent page."""
    librarian_id, book_id, headers = librarian_and_book

    resp = client_with_db.get(f"/api/v1/books/{book_id}/pages/1", headers=headers)
    assert resp.status_code == 404


def test_get_page_book_not_found(client_with_db, librarian_and_book):
    """Should return 404 for non-existent book when getting page."""
    librarian_id, book_id, headers = librarian_and_book

    resp = client_with_db.get("/api/v1/books/nonexistent/pages/1", headers=headers)
    assert resp.status_code == 404


def test_pages_with_data(client_with_db, librarian_and_book):
    """Should return pages when data exists in database."""
    librarian_id, book_id, headers = librarian_and_book

    # Create a mock orchestrator with a world_id
    from raunch.server.library import get_library
    from raunch.world import WorldState

    library = get_library()
    book = library.get_book(book_id)

    # Create a mock orchestrator with a world
    class MockOrchestrator:
        def __init__(self):
            self.world = WorldState("test")
            self.characters = {}

    book.set_orchestrator(MockOrchestrator())
    world_id = book.orchestrator.world.world_id

    # Manually insert a page into the database
    from raunch import db
    db.save_page(
        world_id=world_id,
        page_num=1,
        narration="The story begins.",
        events=["event1"],
        world_time="morning",
        mood="hopeful"
    )

    # Now query the pages endpoint
    resp = client_with_db.get(f"/api/v1/books/{book_id}/pages", headers=headers)
    assert resp.status_code == 200
    data = resp.json()
    assert data["total"] == 1
    assert len(data["pages"]) == 1
    assert data["pages"][0]["page"] == 1
    assert data["pages"][0]["narration"] == "The story begins."
    assert data["pages"][0]["mood"] == "hopeful"
    assert data["pages"][0]["world_time"] == "morning"
    assert data["pages"][0]["events"] == ["event1"]


def test_get_specific_page(client_with_db, librarian_and_book):
    """GET /api/v1/books/{id}/pages/{num} should return specific page."""
    librarian_id, book_id, headers = librarian_and_book

    # Create a mock orchestrator with a world_id
    from raunch.server.library import get_library
    from raunch.world import WorldState

    library = get_library()
    book = library.get_book(book_id)

    # Create a mock orchestrator with a world
    class MockOrchestrator:
        def __init__(self):
            self.world = WorldState("test")
            self.characters = {}

    book.set_orchestrator(MockOrchestrator())
    world_id = book.orchestrator.world.world_id

    # Insert a page with character data
    from raunch import db
    db.save_page(
        world_id=world_id,
        page_num=2,
        narration="A new chapter unfolds.",
        events=["meeting"],
        world_time="afternoon",
        mood="tense"
    )

    db.save_character_page(
        world_id=world_id,
        page_num=2,
        character_name="Alice",
        data={
            "action": "looks around",
            "dialogue": "Hello there!",
            "emotional_state": "curious",
            "inner_thoughts": "What is this place?",
            "desires_update": None
        }
    )

    # Query specific page
    resp = client_with_db.get(f"/api/v1/books/{book_id}/pages/2", headers=headers)
    assert resp.status_code == 200
    data = resp.json()
    assert data["page"] == 2
    assert data["narration"] == "A new chapter unfolds."
    assert data["mood"] == "tense"
    assert "Alice" in data["characters"]
    assert data["characters"]["Alice"]["action"] == "looks around"
    assert data["characters"]["Alice"]["dialogue"] == "Hello there!"


def test_pages_pagination(client_with_db, librarian_and_book):
    """Should respect limit and offset parameters."""
    librarian_id, book_id, headers = librarian_and_book

    # Create a mock orchestrator with a world_id
    from raunch.server.library import get_library
    from raunch.world import WorldState

    library = get_library()
    book = library.get_book(book_id)

    # Create a mock orchestrator with a world
    class MockOrchestrator:
        def __init__(self):
            self.world = WorldState("test")
            self.characters = {}

    book.set_orchestrator(MockOrchestrator())
    world_id = book.orchestrator.world.world_id

    # Insert multiple pages
    from raunch import db
    for i in range(1, 6):
        db.save_page(
            world_id=world_id,
            page_num=i,
            narration=f"Page {i} narration",
            events=[],
            world_time="",
            mood=""
        )

    # Test pagination
    resp = client_with_db.get(
        f"/api/v1/books/{book_id}/pages?limit=2&offset=0",
        headers=headers
    )
    assert resp.status_code == 200
    data = resp.json()
    assert data["total"] == 5
    assert len(data["pages"]) == 2
    assert data["limit"] == 2
    assert data["offset"] == 0

    # Test offset
    resp = client_with_db.get(
        f"/api/v1/books/{book_id}/pages?limit=2&offset=2",
        headers=headers
    )
    assert resp.status_code == 200
    data = resp.json()
    assert data["total"] == 5
    assert len(data["pages"]) == 2
    assert data["offset"] == 2
