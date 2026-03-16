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


def test_create_user_scenario(client_with_db):
    """POST /api/v1/scenarios should create a user scenario."""
    from raunch import db

    # Create a librarian first
    librarian = db.create_librarian("TestUser")
    librarian_id = librarian["id"]

    scenario_data = {
        "scenario_name": "My Custom Scenario",
        "setting": "A custom setting",
        "premise": "A custom premise",
        "themes": ["custom", "test"],
        "opening_situation": "You are in a custom scenario",
        "characters": [
            {"name": "Custom Character", "species": "Human", "personality": "Test"}
        ],
    }

    resp = client_with_db.post(
        "/api/v1/scenarios",
        json={
            "name": "My Custom Scenario",
            "description": "A test scenario",
            "setting": "A custom setting",
            "data": scenario_data,
            "public": False
        },
        headers={"X-Librarian-ID": librarian_id}
    )

    assert resp.status_code == 201
    data = resp.json()
    assert data["name"] == "My Custom Scenario"
    assert data["owner_id"] == librarian_id
    assert data["public"] is False
    assert "id" in data
    assert "created_at" in data


def test_create_scenario_requires_auth(client_with_db):
    """POST /api/v1/scenarios should require authentication."""
    resp = client_with_db.post(
        "/api/v1/scenarios",
        json={
            "name": "Test",
            "data": {}
        }
    )
    assert resp.status_code == 422  # Missing required header


def test_get_my_scenarios(client_with_db):
    """GET /api/v1/scenarios/mine should list user's scenarios."""
    from raunch import db

    # Create a librarian and scenarios
    librarian = db.create_librarian("TestUser")
    librarian_id = librarian["id"]

    scenario_data = {
        "scenario_name": "Test Scenario 1",
        "characters": []
    }

    db.create_scenario(librarian_id, "Test Scenario 1", None, None, scenario_data, public=False)
    db.create_scenario(librarian_id, "Test Scenario 2", None, None, scenario_data, public=True)

    resp = client_with_db.get(
        "/api/v1/scenarios/mine",
        headers={"X-Librarian-ID": librarian_id}
    )

    assert resp.status_code == 200
    data = resp.json()
    assert len(data) == 2
    assert all(s["owner_id"] == librarian_id for s in data)


def test_update_user_scenario(client_with_db):
    """PUT /api/v1/scenarios/{id} should update user's scenario."""
    from raunch import db

    # Create a librarian and scenario
    librarian = db.create_librarian("TestUser")
    librarian_id = librarian["id"]

    scenario_data = {"scenario_name": "Original", "characters": []}
    scenario = db.create_scenario(librarian_id, "Original Name", None, None, scenario_data, public=False)
    scenario_id = scenario["id"]

    # Update the scenario
    resp = client_with_db.put(
        f"/api/v1/scenarios/{scenario_id}",
        json={"name": "Updated Name", "public": True},
        headers={"X-Librarian-ID": librarian_id}
    )

    assert resp.status_code == 200
    data = resp.json()
    assert data["name"] == "Updated Name"
    assert data["public"] is True


def test_update_scenario_requires_ownership(client_with_db):
    """PUT /api/v1/scenarios/{id} should reject non-owners."""
    from raunch import db

    # Create two librarians
    owner = db.create_librarian("Owner")
    other = db.create_librarian("Other")

    scenario_data = {"scenario_name": "Test", "characters": []}
    scenario = db.create_scenario(owner["id"], "Test", None, None, scenario_data, public=False)
    scenario_id = scenario["id"]

    # Try to update as different user
    resp = client_with_db.put(
        f"/api/v1/scenarios/{scenario_id}",
        json={"name": "Hacked"},
        headers={"X-Librarian-ID": other["id"]}
    )

    assert resp.status_code == 403


def test_delete_user_scenario(client_with_db):
    """DELETE /api/v1/scenarios/{id} should delete user's scenario."""
    from raunch import db

    # Create a librarian and scenario
    librarian = db.create_librarian("TestUser")
    librarian_id = librarian["id"]

    scenario_data = {"scenario_name": "To Delete", "characters": []}
    scenario = db.create_scenario(librarian_id, "To Delete", None, None, scenario_data, public=False)
    scenario_id = scenario["id"]

    # Delete the scenario
    resp = client_with_db.delete(
        f"/api/v1/scenarios/{scenario_id}",
        headers={"X-Librarian-ID": librarian_id}
    )

    assert resp.status_code == 200
    assert resp.json()["deleted"] is True
    assert resp.json()["id"] == scenario_id

    # Verify it's deleted
    assert db.get_scenario(scenario_id) is None


def test_delete_scenario_requires_ownership(client_with_db):
    """DELETE /api/v1/scenarios/{id} should reject non-owners."""
    from raunch import db

    # Create two librarians
    owner = db.create_librarian("Owner")
    other = db.create_librarian("Other")

    scenario_data = {"scenario_name": "Test", "characters": []}
    scenario = db.create_scenario(owner["id"], "Test", None, None, scenario_data, public=False)
    scenario_id = scenario["id"]

    # Try to delete as different user
    resp = client_with_db.delete(
        f"/api/v1/scenarios/{scenario_id}",
        headers={"X-Librarian-ID": other["id"]}
    )

    assert resp.status_code == 403


def test_list_scenarios_includes_public_db_scenarios(client_with_db):
    """GET /api/v1/scenarios should include public DB scenarios."""
    from raunch import db

    # Create a librarian and public scenario
    librarian = db.create_librarian("TestUser")
    scenario_data = {
        "scenario_name": "Public Test",
        "characters": [{"name": "Char1"}],
        "themes": ["test"]
    }
    db.create_scenario(librarian["id"], "Public Test", "A public scenario", "Test setting", scenario_data, public=True)

    resp = client_with_db.get("/api/v1/scenarios")
    assert resp.status_code == 200
    data = resp.json()

    # Should have both file-based and DB scenarios
    db_scenarios = [s for s in data if s["source"] == "db"]
    assert len(db_scenarios) > 0

    public_test = next((s for s in db_scenarios if s["name"] == "Public Test"), None)
    assert public_test is not None
    assert public_test["public"] is True
    assert public_test["characters"] == 1
    assert "test" in public_test["themes"]
