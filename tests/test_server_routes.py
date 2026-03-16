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
