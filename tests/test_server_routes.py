"""Tests for server REST routes."""

import os
import tempfile
import pytest
from fastapi.testclient import TestClient


@pytest.fixture
def client():
    """Create a test client."""
    from raunch.server.app import create_app
    app = create_app()
    return TestClient(app)


@pytest.fixture
def client_with_db(monkeypatch, tmp_path):
    """Create a test client with temp database."""
    db_path = str(tmp_path / "test.db")
    monkeypatch.setattr("raunch.db.DB_PATH", db_path)

    # Reset the thread local storage to force fresh connections
    import threading
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


def test_health_endpoint(client):
    """Health endpoint should return ok."""
    response = client.get("/health")
    assert response.status_code == 200
    assert response.json() == {"status": "ok"}


def test_create_librarian(client_with_db):
    """Should create an anonymous librarian."""
    response = client_with_db.post(
        "/api/v1/librarians",
        json={"nickname": "TestUser"}
    )
    assert response.status_code == 201
    data = response.json()
    assert "librarian_id" in data
    assert data["nickname"] == "TestUser"


def test_get_librarian(client_with_db):
    """Should get a librarian by ID."""
    # Create first
    create_resp = client_with_db.post(
        "/api/v1/librarians",
        json={"nickname": "TestUser"}
    )
    librarian_id = create_resp.json()["librarian_id"]

    # Get
    response = client_with_db.get(f"/api/v1/librarians/{librarian_id}")
    assert response.status_code == 200
    assert response.json()["librarian_id"] == librarian_id


def test_create_book(client_with_db):
    """Should create a book."""
    # Create librarian first
    lib_resp = client_with_db.post(
        "/api/v1/librarians",
        json={"nickname": "Owner"}
    )
    librarian_id = lib_resp.json()["librarian_id"]

    response = client_with_db.post(
        "/api/v1/books",
        json={"scenario": "milk_money"},
        headers={"X-Librarian-ID": librarian_id}
    )
    assert response.status_code == 201
    data = response.json()
    assert "book_id" in data
    assert "bookmark" in data


def test_get_book(client_with_db):
    """Should get a book by ID."""
    # Setup
    lib_resp = client_with_db.post(
        "/api/v1/librarians",
        json={"nickname": "Owner"}
    )
    librarian_id = lib_resp.json()["librarian_id"]

    create_resp = client_with_db.post(
        "/api/v1/books",
        json={"scenario": "milk_money"},
        headers={"X-Librarian-ID": librarian_id}
    )
    book_id = create_resp.json()["book_id"]

    # Get
    response = client_with_db.get(
        f"/api/v1/books/{book_id}",
        headers={"X-Librarian-ID": librarian_id}
    )
    assert response.status_code == 200
    assert response.json()["book_id"] == book_id


def test_join_book_by_bookmark(client_with_db):
    """Should join a book via bookmark."""
    # Owner creates book
    lib_resp = client_with_db.post(
        "/api/v1/librarians",
        json={"nickname": "Owner"}
    )
    owner_id = lib_resp.json()["librarian_id"]

    create_resp = client_with_db.post(
        "/api/v1/books",
        json={"scenario": "milk_money"},
        headers={"X-Librarian-ID": owner_id}
    )
    bookmark = create_resp.json()["bookmark"]
    book_id = create_resp.json()["book_id"]

    # Another user joins
    lib2_resp = client_with_db.post(
        "/api/v1/librarians",
        json={"nickname": "Joiner"}
    )
    joiner_id = lib2_resp.json()["librarian_id"]

    join_resp = client_with_db.post(
        "/api/v1/books/join",
        json={"bookmark": bookmark},
        headers={"X-Librarian-ID": joiner_id}
    )
    assert join_resp.status_code == 200
    assert join_resp.json()["book_id"] == book_id


def test_delete_book(client_with_db):
    """Should delete a book (owner only)."""
    # Setup
    lib_resp = client_with_db.post(
        "/api/v1/librarians",
        json={"nickname": "Owner"}
    )
    owner_id = lib_resp.json()["librarian_id"]

    create_resp = client_with_db.post(
        "/api/v1/books",
        json={"scenario": "milk_money"},
        headers={"X-Librarian-ID": owner_id}
    )
    book_id = create_resp.json()["book_id"]

    # Delete
    response = client_with_db.delete(
        f"/api/v1/books/{book_id}",
        headers={"X-Librarian-ID": owner_id}
    )
    assert response.status_code == 200

    # Verify deleted
    get_resp = client_with_db.get(
        f"/api/v1/books/{book_id}",
        headers={"X-Librarian-ID": owner_id}
    )
    assert get_resp.status_code == 404


def test_pause_book(client_with_db):
    """Should pause a book."""
    # Setup
    lib_resp = client_with_db.post(
        "/api/v1/librarians",
        json={"nickname": "Owner"}
    )
    owner_id = lib_resp.json()["librarian_id"]

    create_resp = client_with_db.post(
        "/api/v1/books",
        json={"scenario": "milk_money"},
        headers={"X-Librarian-ID": owner_id}
    )
    book_id = create_resp.json()["book_id"]

    # Pause
    response = client_with_db.post(
        f"/api/v1/books/{book_id}/pause",
        headers={"X-Librarian-ID": owner_id}
    )
    assert response.status_code == 200
    assert response.json()["paused"] == True


def test_resume_book(client_with_db):
    """Should resume a paused book."""
    # Setup
    lib_resp = client_with_db.post(
        "/api/v1/librarians",
        json={"nickname": "Owner"}
    )
    owner_id = lib_resp.json()["librarian_id"]

    create_resp = client_with_db.post(
        "/api/v1/books",
        json={"scenario": "milk_money"},
        headers={"X-Librarian-ID": owner_id}
    )
    book_id = create_resp.json()["book_id"]

    # Pause then resume
    client_with_db.post(
        f"/api/v1/books/{book_id}/pause",
        headers={"X-Librarian-ID": owner_id}
    )

    response = client_with_db.post(
        f"/api/v1/books/{book_id}/resume",
        headers={"X-Librarian-ID": owner_id}
    )
    assert response.status_code == 200
    assert response.json()["paused"] == False


def test_trigger_page(client_with_db):
    """Should trigger next page generation."""
    # Setup
    lib_resp = client_with_db.post(
        "/api/v1/librarians",
        json={"nickname": "Owner"}
    )
    owner_id = lib_resp.json()["librarian_id"]

    create_resp = client_with_db.post(
        "/api/v1/books",
        json={"scenario": "milk_money"},
        headers={"X-Librarian-ID": owner_id}
    )
    book_id = create_resp.json()["book_id"]

    # Trigger page (no orchestrator, so triggered=False)
    response = client_with_db.post(
        f"/api/v1/books/{book_id}/page",
        headers={"X-Librarian-ID": owner_id}
    )
    assert response.status_code == 200
    assert "triggered" in response.json()


def test_update_settings(client_with_db):
    """Should update book settings."""
    # Setup
    lib_resp = client_with_db.post(
        "/api/v1/librarians",
        json={"nickname": "Owner"}
    )
    owner_id = lib_resp.json()["librarian_id"]

    create_resp = client_with_db.post(
        "/api/v1/books",
        json={"scenario": "milk_money"},
        headers={"X-Librarian-ID": owner_id}
    )
    book_id = create_resp.json()["book_id"]

    # Update settings
    response = client_with_db.put(
        f"/api/v1/books/{book_id}/settings",
        json={"page_interval": 60},
        headers={"X-Librarian-ID": owner_id}
    )
    assert response.status_code == 200
    assert response.json()["updated"] == True


def test_reset_book_owner_only(client_with_db):
    """Should reset a book (owner only)."""
    # Create owner
    lib_resp = client_with_db.post(
        "/api/v1/librarians",
        json={"nickname": "Owner"}
    )
    owner_id = lib_resp.json()["librarian_id"]

    # Create book
    create_resp = client_with_db.post(
        "/api/v1/books",
        json={"scenario": "milk_money"},
        headers={"X-Librarian-ID": owner_id}
    )
    book_id = create_resp.json()["book_id"]

    # Reset as owner (should succeed)
    response = client_with_db.post(
        f"/api/v1/books/{book_id}/reset",
        headers={"X-Librarian-ID": owner_id}
    )
    assert response.status_code == 200
    assert response.json()["reset"] == True


def test_reset_book_not_owner(client_with_db):
    """Non-owner should not be able to reset a book."""
    # Create owner
    lib_resp = client_with_db.post(
        "/api/v1/librarians",
        json={"nickname": "Owner"}
    )
    owner_id = lib_resp.json()["librarian_id"]

    # Create book
    create_resp = client_with_db.post(
        "/api/v1/books",
        json={"scenario": "milk_money"},
        headers={"X-Librarian-ID": owner_id}
    )
    book_id = create_resp.json()["book_id"]
    bookmark = create_resp.json()["bookmark"]

    # Create another librarian
    lib2_resp = client_with_db.post(
        "/api/v1/librarians",
        json={"nickname": "NotOwner"}
    )
    not_owner_id = lib2_resp.json()["librarian_id"]

    # Join book as non-owner
    client_with_db.post(
        "/api/v1/books/join",
        json={"bookmark": bookmark},
        headers={"X-Librarian-ID": not_owner_id}
    )

    # Try to reset as non-owner (should fail)
    response = client_with_db.post(
        f"/api/v1/books/{book_id}/reset",
        headers={"X-Librarian-ID": not_owner_id}
    )
    assert response.status_code == 403
    assert "owner" in response.json()["detail"].lower()


def test_reset_book_not_found(client_with_db):
    """Should return 404 for non-existent book."""
    lib_resp = client_with_db.post(
        "/api/v1/librarians",
        json={"nickname": "Owner"}
    )
    owner_id = lib_resp.json()["librarian_id"]

    response = client_with_db.post(
        "/api/v1/books/nonexistent/reset",
        headers={"X-Librarian-ID": owner_id}
    )
    assert response.status_code == 404
