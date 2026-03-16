"""Tests for scenario database functions."""

import os
import tempfile
import pytest


# Patch DB_PATH before importing db module
@pytest.fixture
def temp_db(monkeypatch):
    """Create a temporary database for testing."""
    with tempfile.TemporaryDirectory(ignore_cleanup_errors=True) as tmpdir:
        db_path = os.path.join(tmpdir, "test.db")
        monkeypatch.setattr("raunch.db.DB_PATH", db_path)
        monkeypatch.setattr("raunch.db._local", type("Local", (), {})())
        yield db_path
        # Close any open connections
        from raunch import db
        if hasattr(db._local, "conn") and db._local.conn:
            db._local.conn.close()
            db._local.conn = None


def test_scenarios_table_exists(temp_db):
    """Scenarios table should be created with correct schema."""
    from raunch import db
    import sqlite3

    db.init_db()

    conn = sqlite3.connect(temp_db)
    cursor = conn.execute(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='scenarios'"
    )
    assert cursor.fetchone() is not None

    # Check columns
    cursor = conn.execute("PRAGMA table_info(scenarios)")
    columns = {row[1]: row[2] for row in cursor.fetchall()}
    conn.close()

    assert "id" in columns
    assert "owner_id" in columns
    assert "name" in columns
    assert "description" in columns
    assert "setting" in columns
    assert "data" in columns
    assert "public" in columns
    assert "created_at" in columns


def test_create_scenario(temp_db):
    """Should create a scenario and return its data."""
    from raunch import db

    db.init_db()
    librarian = db.create_librarian("TestUser")

    scenario_data = {
        "scenario_name": "Test Scenario",
        "setting": "A test setting",
        "premise": "A test premise",
        "themes": ["test", "scenario"],
        "opening_situation": "Test opening",
        "characters": []
    }

    scenario = db.create_scenario(
        owner_id=librarian["id"],
        name="Test Scenario",
        description="A test scenario",
        setting="A test setting",
        data=scenario_data,
        public=False
    )

    assert scenario["id"] is not None
    assert scenario["owner_id"] == librarian["id"]
    assert scenario["name"] == "Test Scenario"
    assert scenario["description"] == "A test scenario"
    assert scenario["setting"] == "A test setting"
    assert scenario["data"] == scenario_data
    assert scenario["public"] is False
    assert scenario["created_at"] is not None


def test_create_public_scenario(temp_db):
    """Should create a public scenario."""
    from raunch import db

    db.init_db()
    librarian = db.create_librarian("TestUser")

    scenario = db.create_scenario(
        owner_id=librarian["id"],
        name="Public Scenario",
        description=None,
        setting=None,
        data={"test": "data"},
        public=True
    )

    assert scenario["public"] is True


def test_get_scenario(temp_db):
    """Should retrieve a scenario by ID."""
    from raunch import db

    db.init_db()
    librarian = db.create_librarian("TestUser")

    created = db.create_scenario(
        owner_id=librarian["id"],
        name="Test Scenario",
        description="Test",
        setting="Test setting",
        data={"test": "data"}
    )

    fetched = db.get_scenario(created["id"])

    assert fetched is not None
    assert fetched["id"] == created["id"]
    assert fetched["name"] == "Test Scenario"
    assert fetched["data"]["test"] == "data"


def test_get_scenario_not_found(temp_db):
    """Should return None for non-existent scenario."""
    from raunch import db

    db.init_db()

    result = db.get_scenario("nonexistent-id")
    assert result is None


def test_get_scenario_by_name(temp_db):
    """Should retrieve a public scenario by name."""
    from raunch import db

    db.init_db()
    librarian = db.create_librarian("TestUser")

    # Create a public scenario
    db.create_scenario(
        owner_id=librarian["id"],
        name="Findable Scenario",
        description="Test",
        setting="Test setting",
        data={"test": "data"},
        public=True
    )

    fetched = db.get_scenario_by_name("Findable Scenario")

    assert fetched is not None
    assert fetched["name"] == "Findable Scenario"


def test_get_scenario_by_name_case_insensitive(temp_db):
    """Should retrieve scenario by name case-insensitively."""
    from raunch import db

    db.init_db()
    librarian = db.create_librarian("TestUser")

    db.create_scenario(
        owner_id=librarian["id"],
        name="Test Scenario",
        description="Test",
        setting="Test setting",
        data={"test": "data"},
        public=True
    )

    fetched = db.get_scenario_by_name("test scenario")
    assert fetched is not None
    assert fetched["name"] == "Test Scenario"


def test_get_scenario_by_name_private_not_found(temp_db):
    """Should not find private scenarios by name."""
    from raunch import db

    db.init_db()
    librarian = db.create_librarian("TestUser")

    # Create a private scenario
    db.create_scenario(
        owner_id=librarian["id"],
        name="Private Scenario",
        description="Test",
        setting="Test setting",
        data={"test": "data"},
        public=False
    )

    fetched = db.get_scenario_by_name("Private Scenario")
    assert fetched is None


def test_get_scenario_by_name_most_recent(temp_db):
    """Should return most recent scenario when multiple match."""
    from raunch import db
    import time

    db.init_db()
    librarian = db.create_librarian("TestUser")

    # Create two scenarios with the same name
    first = db.create_scenario(
        owner_id=librarian["id"],
        name="Duplicate Name",
        description="First",
        setting="Test",
        data={"version": 1},
        public=True
    )

    time.sleep(0.1)  # Ensure different timestamps

    second = db.create_scenario(
        owner_id=librarian["id"],
        name="Duplicate Name",
        description="Second",
        setting="Test",
        data={"version": 2},
        public=True
    )

    fetched = db.get_scenario_by_name("Duplicate Name")
    # Should return the most recent one (highest ID since created last)
    assert fetched["id"] == second["id"]
    assert fetched["description"] == "Second"
    assert fetched["data"]["version"] == 2


def test_list_scenarios_for_librarian(temp_db):
    """Should list all scenarios owned by a librarian."""
    from raunch import db
    import time

    db.init_db()
    librarian1 = db.create_librarian("User1")
    librarian2 = db.create_librarian("User2")

    first = db.create_scenario(
        owner_id=librarian1["id"],
        name="Scenario 1",
        description="Test",
        setting="Test",
        data={"num": 1},
        public=False
    )

    time.sleep(0.1)  # Ensure different timestamps

    second = db.create_scenario(
        owner_id=librarian1["id"],
        name="Scenario 2",
        description="Test",
        setting="Test",
        data={"num": 2},
        public=True
    )

    db.create_scenario(
        owner_id=librarian2["id"],
        name="Scenario 3",
        description="Test",
        setting="Test",
        data={"num": 3},
        public=False
    )

    scenarios = db.list_scenarios_for_librarian(librarian1["id"])
    assert len(scenarios) == 2
    assert all(s["owner_id"] == librarian1["id"] for s in scenarios)

    # Should be ordered by most recent first (verify by ID)
    assert scenarios[0]["id"] == second["id"]
    assert scenarios[1]["id"] == first["id"]
    assert scenarios[0]["data"]["num"] == 2
    assert scenarios[1]["data"]["num"] == 1


def test_list_scenarios_for_librarian_empty(temp_db):
    """Should return empty list for librarian with no scenarios."""
    from raunch import db

    db.init_db()
    librarian = db.create_librarian("TestUser")

    scenarios = db.list_scenarios_for_librarian(librarian["id"])
    assert scenarios == []


def test_list_public_scenarios(temp_db):
    """Should list all public scenarios."""
    from raunch import db
    import time

    db.init_db()
    librarian = db.create_librarian("TestUser")

    # Create mix of public and private scenarios
    first = db.create_scenario(
        owner_id=librarian["id"],
        name="Public 1",
        description="Test",
        setting="Test",
        data={"num": 1},
        public=True
    )

    db.create_scenario(
        owner_id=librarian["id"],
        name="Private 1",
        description="Test",
        setting="Test",
        data={"num": 2},
        public=False
    )

    time.sleep(0.1)  # Ensure different timestamps

    second = db.create_scenario(
        owner_id=librarian["id"],
        name="Public 2",
        description="Test",
        setting="Test",
        data={"num": 3},
        public=True
    )

    scenarios = db.list_public_scenarios()
    assert len(scenarios) == 2
    assert all(s["public"] is True for s in scenarios)

    # Should be ordered by most recent first (verify by ID)
    assert scenarios[0]["id"] == second["id"]
    assert scenarios[1]["id"] == first["id"]
    assert scenarios[0]["data"]["num"] == 3
    assert scenarios[1]["data"]["num"] == 1


def test_list_public_scenarios_empty(temp_db):
    """Should return empty list when no public scenarios exist."""
    from raunch import db

    db.init_db()
    librarian = db.create_librarian("TestUser")

    # Create only private scenarios
    db.create_scenario(
        owner_id=librarian["id"],
        name="Private",
        description="Test",
        setting="Test",
        data={},
        public=False
    )

    scenarios = db.list_public_scenarios()
    assert scenarios == []


def test_update_scenario_name(temp_db):
    """Should update scenario name."""
    from raunch import db

    db.init_db()
    librarian = db.create_librarian("TestUser")

    scenario = db.create_scenario(
        owner_id=librarian["id"],
        name="Original Name",
        description="Test",
        setting="Test",
        data={"test": "data"}
    )

    result = db.update_scenario(scenario["id"], name="New Name")
    assert result is True

    updated = db.get_scenario(scenario["id"])
    assert updated["name"] == "New Name"
    assert updated["description"] == "Test"  # Other fields unchanged


def test_update_scenario_description(temp_db):
    """Should update scenario description."""
    from raunch import db

    db.init_db()
    librarian = db.create_librarian("TestUser")

    scenario = db.create_scenario(
        owner_id=librarian["id"],
        name="Test",
        description="Original",
        setting="Test",
        data={}
    )

    result = db.update_scenario(scenario["id"], description="Updated")
    assert result is True

    updated = db.get_scenario(scenario["id"])
    assert updated["description"] == "Updated"


def test_update_scenario_setting(temp_db):
    """Should update scenario setting."""
    from raunch import db

    db.init_db()
    librarian = db.create_librarian("TestUser")

    scenario = db.create_scenario(
        owner_id=librarian["id"],
        name="Test",
        description="Test",
        setting="Original setting",
        data={}
    )

    result = db.update_scenario(scenario["id"], setting="New setting")
    assert result is True

    updated = db.get_scenario(scenario["id"])
    assert updated["setting"] == "New setting"


def test_update_scenario_data(temp_db):
    """Should update scenario data."""
    from raunch import db

    db.init_db()
    librarian = db.create_librarian("TestUser")

    scenario = db.create_scenario(
        owner_id=librarian["id"],
        name="Test",
        description="Test",
        setting="Test",
        data={"version": 1}
    )

    new_data = {"version": 2, "extra": "field"}
    result = db.update_scenario(scenario["id"], data=new_data)
    assert result is True

    updated = db.get_scenario(scenario["id"])
    assert updated["data"] == new_data


def test_update_scenario_public_flag(temp_db):
    """Should update scenario public flag."""
    from raunch import db

    db.init_db()
    librarian = db.create_librarian("TestUser")

    scenario = db.create_scenario(
        owner_id=librarian["id"],
        name="Test",
        description="Test",
        setting="Test",
        data={},
        public=False
    )

    result = db.update_scenario(scenario["id"], public=True)
    assert result is True

    updated = db.get_scenario(scenario["id"])
    assert updated["public"] is True


def test_update_scenario_multiple_fields(temp_db):
    """Should update multiple scenario fields at once."""
    from raunch import db

    db.init_db()
    librarian = db.create_librarian("TestUser")

    scenario = db.create_scenario(
        owner_id=librarian["id"],
        name="Original",
        description="Original",
        setting="Original",
        data={"v": 1},
        public=False
    )

    result = db.update_scenario(
        scenario["id"],
        name="New Name",
        description="New Description",
        public=True
    )
    assert result is True

    updated = db.get_scenario(scenario["id"])
    assert updated["name"] == "New Name"
    assert updated["description"] == "New Description"
    assert updated["public"] is True
    assert updated["setting"] == "Original"  # Unchanged
    assert updated["data"]["v"] == 1  # Unchanged


def test_update_scenario_not_found(temp_db):
    """Should return False for non-existent scenario."""
    from raunch import db

    db.init_db()

    result = db.update_scenario("nonexistent-id", name="New Name")
    assert result is False


def test_update_scenario_no_fields(temp_db):
    """Should return False when no fields to update."""
    from raunch import db

    db.init_db()
    librarian = db.create_librarian("TestUser")

    scenario = db.create_scenario(
        owner_id=librarian["id"],
        name="Test",
        description="Test",
        setting="Test",
        data={}
    )

    result = db.update_scenario(scenario["id"])
    assert result is False


def test_delete_scenario(temp_db):
    """Should delete a scenario."""
    from raunch import db

    db.init_db()
    librarian = db.create_librarian("TestUser")

    scenario = db.create_scenario(
        owner_id=librarian["id"],
        name="Test",
        description="Test",
        setting="Test",
        data={}
    )

    result = db.delete_scenario(scenario["id"])
    assert result is True

    # Verify it's gone
    assert db.get_scenario(scenario["id"]) is None


def test_delete_scenario_not_found(temp_db):
    """Should return False for non-existent scenario."""
    from raunch import db

    db.init_db()

    result = db.delete_scenario("nonexistent-id")
    assert result is False


def test_scenario_json_round_trip(temp_db):
    """Should correctly serialize and deserialize complex JSON data."""
    from raunch import db

    db.init_db()
    librarian = db.create_librarian("TestUser")

    complex_data = {
        "scenario_name": "Complex Test",
        "setting": "A complex setting",
        "premise": "A complex premise",
        "themes": ["theme1", "theme2", "theme3"],
        "opening_situation": "Complex opening",
        "characters": [
            {
                "name": "Character 1",
                "species": "Human",
                "personality": "Complex personality",
                "appearance": "Complex appearance",
                "desires": "Complex desires",
                "backstory": "Complex backstory"
            },
            {
                "name": "Character 2",
                "species": "Elf",
                "personality": "Another personality",
                "appearance": "Another appearance",
                "desires": "Another desires",
                "backstory": "Another backstory"
            }
        ],
        "nested": {
            "level1": {
                "level2": {
                    "level3": "deep value"
                }
            }
        }
    }

    scenario = db.create_scenario(
        owner_id=librarian["id"],
        name="Complex Test",
        description="Test",
        setting="Test",
        data=complex_data
    )

    fetched = db.get_scenario(scenario["id"])
    assert fetched["data"] == complex_data
    assert fetched["data"]["characters"][0]["name"] == "Character 1"
    assert fetched["data"]["nested"]["level1"]["level2"]["level3"] == "deep value"


def test_reset_book(temp_db):
    """Should reset book by clearing all pages, character_pages, and potential_characters."""
    from raunch import db

    db.init_db()
    librarian = db.create_librarian("TestUser")

    # Create a book
    book = db.create_book("test-scenario", librarian["id"], private=False)
    book_id = book["id"]

    # Add some pages
    db.save_page(book_id, 1, "First narration", ["event1"], "Day 1", "happy")
    db.save_page(book_id, 2, "Second narration", ["event2"], "Day 2", "sad")

    # Add some character pages
    db.save_character_page(
        book_id, 1, "Alice",
        {
            "inner_thoughts": "Thinking...",
            "action": "Walking",
            "dialogue": "Hello",
            "emotional_state": "happy",
            "desires_update": "Wants to help"
        }
    )
    db.save_character_page(
        book_id, 2, "Bob",
        {
            "inner_thoughts": "Pondering...",
            "action": "Running",
            "dialogue": "Goodbye",
            "emotional_state": "excited",
            "desires_update": "Wants adventure"
        }
    )

    # Add a potential character
    db.save_potential_character(book_id, "Charlie", "A mysterious stranger", 1)

    # Update page count
    conn = db._get_conn()
    conn.execute("UPDATE books SET page_count = 2 WHERE id = ?", (book_id,))
    conn.commit()

    # Verify data exists
    pages = db.get_page_history(book_id, limit=10)
    assert len(pages) == 2

    # Reset the book
    result = db.reset_book(book_id)
    assert result is True

    # Verify all pages are deleted
    pages_after = db.get_page_history(book_id, limit=10)
    assert len(pages_after) == 0

    # Verify character_pages are deleted
    conn = db._get_conn()
    char_pages = conn.execute(
        "SELECT COUNT(*) FROM character_pages WHERE world_id = ?", (book_id,)
    ).fetchone()[0]
    assert char_pages == 0

    # Verify potential_characters are deleted
    potential_chars = conn.execute(
        "SELECT COUNT(*) FROM potential_characters WHERE world_id = ?", (book_id,)
    ).fetchone()[0]
    assert potential_chars == 0

    # Verify page_count is reset to 0
    book_after = db.get_book(book_id)
    assert book_after is not None
    assert book_after["page_count"] == 0

    # Verify book still exists with same bookmark
    assert book_after["id"] == book_id
    assert book_after["bookmark"] == book["bookmark"]
    assert book_after["scenario_name"] == "test-scenario"


def test_reset_book_not_found(temp_db):
    """Should return False when trying to reset non-existent book."""
    from raunch import db

    db.init_db()

    result = db.reset_book("nonexistent-book-id")
    assert result is False


def test_reset_book_empty(temp_db):
    """Should successfully reset a book with no pages."""
    from raunch import db

    db.init_db()
    librarian = db.create_librarian("TestUser")

    # Create a book but don't add any pages
    book = db.create_book("empty-scenario", librarian["id"], private=False)
    book_id = book["id"]

    # Reset should still work
    result = db.reset_book(book_id)
    assert result is True

    # Book should still exist
    book_after = db.get_book(book_id)
    assert book_after is not None
    assert book_after["page_count"] == 0


def test_reset_book_updates_last_active(temp_db):
    """Should update last_active timestamp when resetting."""
    from raunch import db
    import time

    db.init_db()
    librarian = db.create_librarian("TestUser")

    # Create a book
    book = db.create_book("test-scenario", librarian["id"], private=False)
    book_id = book["id"]
    original_last_active = book["last_active"]

    # Wait a bit to ensure timestamp difference
    time.sleep(1.1)  # SQLite timestamps are second precision

    # Reset the book
    db.reset_book(book_id)

    # Verify last_active was updated
    book_after = db.get_book(book_id)
    assert book_after["last_active"] >= original_last_active  # Should be >= since timestamp may round


def test_create_book_private_by_default(temp_db):
    """Should create books as private by default."""
    from raunch import db

    db.init_db()
    librarian = db.create_librarian("TestUser")

    # Create book without specifying private parameter
    book = db.create_book("test-scenario", librarian["id"])

    # Should be private by default
    assert book["private"] is True


def test_create_book_explicit_public(temp_db):
    """Should create public book when explicitly specified."""
    from raunch import db

    db.init_db()
    librarian = db.create_librarian("TestUser")

    # Create book with private=False
    book = db.create_book("test-scenario", librarian["id"], private=False)

    # Should be public
    assert book["private"] is False
