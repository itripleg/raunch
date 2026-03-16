"""Tests for reader endpoints."""

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


def test_list_readers_empty(client_with_db, librarian_and_book):
    """GET /api/v1/books/{id}/readers should return empty list initially."""
    librarian_id, book_id, headers = librarian_and_book

    resp = client_with_db.get(f"/api/v1/books/{book_id}/readers", headers=headers)
    assert resp.status_code == 200
    assert resp.json() == []


def test_list_readers_after_add(client_with_db, librarian_and_book):
    """Readers list should show connected readers."""
    librarian_id, book_id, headers = librarian_and_book

    # Add a reader directly to the book
    from raunch.server.library import get_library
    from raunch.server.models import Reader

    library = get_library()
    book = library.get_book(book_id)
    reader = Reader.create("TestReader")
    book.add_reader(reader)

    resp = client_with_db.get(f"/api/v1/books/{book_id}/readers", headers=headers)
    assert resp.status_code == 200
    data = resp.json()
    assert len(data) == 1
    assert data[0]["nickname"] == "TestReader"
    assert "reader_id" in data[0]


def test_list_readers_book_not_found(client_with_db, librarian_and_book):
    """Should return 404 for non-existent book."""
    librarian_id, book_id, headers = librarian_and_book

    resp = client_with_db.get("/api/v1/books/nonexistent/readers", headers=headers)
    assert resp.status_code == 404


def test_kick_reader_success(client_with_db, librarian_and_book):
    """DELETE /api/v1/books/{id}/readers/{reader_id} should remove reader (owner)."""
    librarian_id, book_id, headers = librarian_and_book

    # Add a reader directly to the book
    from raunch.server.library import get_library
    from raunch.server.models import Reader

    library = get_library()
    book = library.get_book(book_id)
    reader = Reader.create("ToKick")
    book.add_reader(reader)

    # Verify reader exists
    resp = client_with_db.get(f"/api/v1/books/{book_id}/readers", headers=headers)
    assert len(resp.json()) == 1

    # Kick the reader
    resp = client_with_db.delete(
        f"/api/v1/books/{book_id}/readers/{reader.reader_id}",
        headers=headers
    )
    assert resp.status_code == 200
    assert resp.json()["kicked"] is True
    assert resp.json()["reader_id"] == reader.reader_id

    # Verify reader is gone
    resp = client_with_db.get(f"/api/v1/books/{book_id}/readers", headers=headers)
    assert resp.json() == []


def test_kick_reader_not_owner(client_with_db, librarian_and_book):
    """Non-owner should not be able to kick readers."""
    librarian_id, book_id, headers = librarian_and_book

    # Add a reader
    from raunch.server.library import get_library
    from raunch.server.models import Reader

    library = get_library()
    book = library.get_book(book_id)
    reader = Reader.create("Target")
    book.add_reader(reader)

    # Create a different librarian
    resp = client_with_db.post("/api/v1/librarians", json={"nickname": "Other"})
    other_id = resp.json()["librarian_id"]
    other_headers = {"X-Librarian-ID": other_id}

    # Try to kick as non-owner
    resp = client_with_db.delete(
        f"/api/v1/books/{book_id}/readers/{reader.reader_id}",
        headers=other_headers
    )
    assert resp.status_code == 403
    assert "owner" in resp.json()["detail"].lower()


def test_kick_reader_not_found(client_with_db, librarian_and_book):
    """Kicking non-existent reader should return 404."""
    librarian_id, book_id, headers = librarian_and_book

    resp = client_with_db.delete(
        f"/api/v1/books/{book_id}/readers/nonexistent",
        headers=headers
    )
    assert resp.status_code == 404


def test_kick_reader_book_not_found(client_with_db, librarian_and_book):
    """Kicking reader from non-existent book should return 404."""
    librarian_id, book_id, headers = librarian_and_book

    resp = client_with_db.delete(
        "/api/v1/books/nonexistent/readers/somereader",
        headers=headers
    )
    assert resp.status_code == 404


def test_readers_invalid_librarian(client_with_db, librarian_and_book):
    """Invalid librarian ID should return 401."""
    librarian_id, book_id, headers = librarian_and_book

    resp = client_with_db.get(
        f"/api/v1/books/{book_id}/readers",
        headers={"X-Librarian-ID": "invalid"}
    )
    assert resp.status_code == 401
