"""Tests for scenario endpoints."""

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


def test_list_scenarios(client_with_db):
    """GET /api/v1/scenarios should return scenario list."""
    resp = client_with_db.get("/api/v1/scenarios")
    assert resp.status_code == 200
    data = resp.json()
    assert isinstance(data, list)


def test_get_scenario_details(client_with_db):
    """GET /api/v1/scenarios/{name} should return scenario details."""
    # First get the list to find an existing scenario
    list_resp = client_with_db.get("/api/v1/scenarios")
    scenarios = list_resp.json()

    if scenarios:
        # Use the first scenario's file (without .json extension)
        scenario_file = scenarios[0]["file"]
        name = scenario_file.replace(".json", "")

        resp = client_with_db.get(f"/api/v1/scenarios/{name}")
        assert resp.status_code == 200
        data = resp.json()
        assert "scenario_name" in data
        assert "characters" in data
        assert isinstance(data["characters"], list)


def test_get_scenario_not_found(client_with_db):
    """GET /api/v1/scenarios/{name} should return 404 for nonexistent scenario."""
    resp = client_with_db.get("/api/v1/scenarios/nonexistent_scenario_xyz")
    assert resp.status_code == 404


def test_get_wizard_options(client_with_db):
    """GET /api/v1/wizard/options should return options."""
    resp = client_with_db.get("/api/v1/wizard/options")
    assert resp.status_code == 200
    data = resp.json()
    assert "settings" in data
    assert "kinks" in data
    assert "vibes" in data
    assert isinstance(data["settings"], list)
    assert isinstance(data["kinks"], list)
    assert isinstance(data["vibes"], list)
    assert len(data["settings"]) > 0
    assert len(data["kinks"]) > 0
    assert len(data["vibes"]) > 0


def test_roll_scenario_with_mock(client_with_db, monkeypatch):
    """POST /api/v1/scenarios/roll should call random_scenario and return data."""
    mock_scenario = {
        "scenario_name": "Test Scenario",
        "setting": "A test setting",
        "premise": "A test premise",
        "themes": ["test", "mock"],
        "opening_situation": "You are testing",
        "characters": [
            {"name": "Test Character", "species": "Human", "personality": "Test"}
        ],
    }
    monkeypatch.setattr(
        "raunch.server.routes.scenarios.random_scenario",
        lambda: mock_scenario
    )

    resp = client_with_db.post("/api/v1/scenarios/roll")
    assert resp.status_code == 200
    data = resp.json()
    assert data["scenario_name"] == "Test Scenario"
    assert len(data["characters"]) == 1


def test_wizard_generate_with_mock(client_with_db, monkeypatch):
    """POST /api/v1/wizard/generate should call generate_scenario and return data."""
    mock_scenario = {
        "scenario_name": "Generated Scenario",
        "setting": "A generated setting",
        "premise": "A generated premise",
        "themes": ["generated"],
        "opening_situation": "You are generating",
        "characters": [
            {"name": "Gen Character", "species": "Elf", "personality": "Mysterious"}
        ],
    }
    monkeypatch.setattr(
        "raunch.server.routes.scenarios.generate_scenario",
        lambda **kwargs: mock_scenario
    )

    resp = client_with_db.post(
        "/api/v1/wizard/generate",
        json={"num_characters": 2, "setting": "fantasy"}
    )
    assert resp.status_code == 200
    data = resp.json()
    assert data["scenario_name"] == "Generated Scenario"
    assert len(data["characters"]) == 1
