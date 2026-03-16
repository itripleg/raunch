"""Tests for character endpoints."""

import threading
import pytest
from fastapi.testclient import TestClient


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
    resp = client_with_db.post("/api/v1/librarians", json={"nickname": "Test"})
    librarian_id = resp.json()["librarian_id"]
    headers = {"X-Librarian-ID": librarian_id}

    # Create book
    resp = client_with_db.post("/api/v1/books", json={"scenario": "milk_money"}, headers=headers)
    book_id = resp.json()["book_id"]

    return librarian_id, book_id, headers


def test_list_characters_no_orchestrator(client_with_db, librarian_and_book):
    """GET /api/v1/books/{id}/characters should return empty list when no orchestrator."""
    librarian_id, book_id, headers = librarian_and_book

    resp = client_with_db.get(f"/api/v1/books/{book_id}/characters", headers=headers)
    assert resp.status_code == 200
    data = resp.json()
    assert isinstance(data, list)
    assert len(data) == 0


def test_list_characters_with_orchestrator(client_with_db, librarian_and_book):
    """GET /api/v1/books/{id}/characters should return character list."""
    librarian_id, book_id, headers = librarian_and_book

    # Set up an orchestrator with characters
    from raunch.server.library import get_library
    from raunch.orchestrator import Orchestrator
    from raunch.agents.character import Character

    library = get_library()
    book = library.get_book(book_id)

    # Create minimal orchestrator
    orch = Orchestrator.__new__(Orchestrator)
    orch.characters = {}
    orch.world = type("World", (), {"locations": {}, "world_id": None})()
    book.set_orchestrator(orch)

    # Add a character
    char = Character(name="TestChar", species="Elf", personality="Brave")
    orch.characters["TestChar"] = char

    resp = client_with_db.get(f"/api/v1/books/{book_id}/characters", headers=headers)
    assert resp.status_code == 200
    data = resp.json()
    assert isinstance(data, list)
    assert len(data) == 1
    assert data[0]["name"] == "TestChar"
    assert data[0]["species"] == "Elf"


def test_add_character(client_with_db, librarian_and_book):
    """POST /api/v1/books/{id}/characters should add a character."""
    librarian_id, book_id, headers = librarian_and_book

    # Set up an orchestrator
    from raunch.server.library import get_library
    from raunch.orchestrator import Orchestrator

    library = get_library()
    book = library.get_book(book_id)

    # Create minimal orchestrator
    orch = Orchestrator.__new__(Orchestrator)
    orch.characters = {}
    orch.world = type("World", (), {"locations": {"Main": {"characters": []}}, "world_id": None})()
    orch.world.place_character = lambda name, loc: orch.world.locations.get(loc, {}).setdefault("characters", []).append(name)
    book.set_orchestrator(orch)

    resp = client_with_db.post(
        f"/api/v1/books/{book_id}/characters",
        json={
            "name": "New Character",
            "species": "Elf",
            "personality": "Mysterious",
        },
        headers=headers,
    )
    assert resp.status_code == 201
    data = resp.json()
    assert data["name"] == "New Character"
    assert data["species"] == "Elf"

    # Verify character was added
    assert "New Character" in orch.characters


def test_add_character_no_orchestrator(client_with_db, librarian_and_book):
    """POST /api/v1/books/{id}/characters should fail when no orchestrator."""
    librarian_id, book_id, headers = librarian_and_book

    resp = client_with_db.post(
        f"/api/v1/books/{book_id}/characters",
        json={"name": "Test", "species": "Human"},
        headers=headers,
    )
    assert resp.status_code == 400
    assert "not started" in resp.json()["detail"]


def test_add_character_duplicate(client_with_db, librarian_and_book):
    """POST /api/v1/books/{id}/characters should reject duplicates."""
    librarian_id, book_id, headers = librarian_and_book

    # Set up an orchestrator with existing character
    from raunch.server.library import get_library
    from raunch.orchestrator import Orchestrator
    from raunch.agents.character import Character

    library = get_library()
    book = library.get_book(book_id)

    orch = Orchestrator.__new__(Orchestrator)
    orch.characters = {"Existing": Character(name="Existing", species="Human")}
    orch.world = type("World", (), {"locations": {"Main": {"characters": []}}, "world_id": None})()
    orch.world.place_character = lambda name, loc: None
    book.set_orchestrator(orch)

    # Try to add character with same name (case-insensitive)
    resp = client_with_db.post(
        f"/api/v1/books/{book_id}/characters",
        json={"name": "existing", "species": "Elf"},
        headers=headers,
    )
    assert resp.status_code == 400
    assert "already exists" in resp.json()["detail"]


def test_delete_character(client_with_db, librarian_and_book):
    """DELETE /api/v1/books/{id}/characters/{name} should remove character."""
    librarian_id, book_id, headers = librarian_and_book

    # Set up an orchestrator with a character
    from raunch.server.library import get_library
    from raunch.orchestrator import Orchestrator
    from raunch.agents.character import Character

    library = get_library()
    book = library.get_book(book_id)

    orch = Orchestrator.__new__(Orchestrator)
    orch.characters = {"ToDelete": Character(name="ToDelete", species="Human")}
    orch.world = type("World", (), {"locations": {"Main": {"characters": ["ToDelete"]}}, "world_id": None})()
    book.set_orchestrator(orch)

    # Delete it
    resp = client_with_db.delete(f"/api/v1/books/{book_id}/characters/ToDelete", headers=headers)
    assert resp.status_code == 200
    assert resp.json()["deleted"] is True

    # Verify it's gone
    assert "ToDelete" not in orch.characters


def test_delete_character_not_found(client_with_db, librarian_and_book):
    """DELETE /api/v1/books/{id}/characters/{name} should 404 if not found."""
    librarian_id, book_id, headers = librarian_and_book

    # Set up an orchestrator
    from raunch.server.library import get_library
    from raunch.orchestrator import Orchestrator

    library = get_library()
    book = library.get_book(book_id)

    orch = Orchestrator.__new__(Orchestrator)
    orch.characters = {}
    orch.world = type("World", (), {"locations": {}, "world_id": None})()
    book.set_orchestrator(orch)

    resp = client_with_db.delete(f"/api/v1/books/{book_id}/characters/NonExistent", headers=headers)
    assert resp.status_code == 404


def test_grab_character(client_with_db, librarian_and_book):
    """POST /api/v1/books/{id}/characters/grab should promote NPC."""
    librarian_id, book_id, headers = librarian_and_book

    # Set up an orchestrator with a world_id
    from raunch.server.library import get_library
    from raunch.orchestrator import Orchestrator
    from raunch import db

    library = get_library()
    book = library.get_book(book_id)

    world_id = "test-world-123"
    orch = Orchestrator.__new__(Orchestrator)
    orch.characters = {}
    orch.world = type("World", (), {
        "locations": {"Main": {"characters": []}},
        "world_id": world_id
    })()
    orch.world.place_character = lambda name, loc: orch.world.locations.get(loc, {}).setdefault("characters", []).append(name)
    book.set_orchestrator(orch)

    # Add a potential character to the database
    db.save_potential_character(world_id, "SomeNPC", "A mysterious stranger", 1)

    # Grab the NPC
    resp = client_with_db.post(
        f"/api/v1/books/{book_id}/characters/grab",
        json={"name": "SomeNPC"},
        headers=headers,
    )
    assert resp.status_code == 200
    data = resp.json()
    assert data["name"] == "SomeNPC"
    assert "promoted" in data["message"].lower()

    # Verify character was added
    assert "SomeNPC" in orch.characters


def test_grab_character_not_found(client_with_db, librarian_and_book):
    """POST /api/v1/books/{id}/characters/grab should 404 if NPC not found."""
    librarian_id, book_id, headers = librarian_and_book

    # Set up an orchestrator
    from raunch.server.library import get_library
    from raunch.orchestrator import Orchestrator

    library = get_library()
    book = library.get_book(book_id)

    orch = Orchestrator.__new__(Orchestrator)
    orch.characters = {}
    orch.world = type("World", (), {"locations": {}, "world_id": "test-world"})()
    book.set_orchestrator(orch)

    resp = client_with_db.post(
        f"/api/v1/books/{book_id}/characters/grab",
        json={"name": "NonExistent"},
        headers=headers,
    )
    assert resp.status_code == 404


def test_characters_book_not_found(client_with_db, librarian_and_book):
    """Character endpoints should 404 if book not found."""
    librarian_id, book_id, headers = librarian_and_book

    resp = client_with_db.get("/api/v1/books/nonexistent/characters", headers=headers)
    assert resp.status_code == 404


def test_characters_invalid_librarian(client_with_db, librarian_and_book):
    """Character endpoints should 401 with invalid librarian."""
    librarian_id, book_id, headers = librarian_and_book

    resp = client_with_db.get(
        f"/api/v1/books/{book_id}/characters",
        headers={"X-Librarian-ID": "invalid-id"}
    )
    assert resp.status_code == 401
