"""World state — single source of truth for the simulation."""

import json
import os
import time
import uuid
from datetime import datetime
from typing import Dict, Any, List, Optional

from .config import SAVES_DIR


class WorldState:
    """Tracks all world state: locations, characters, time, events."""

    def __init__(self, name: str = None):
        self.world_id: str = uuid.uuid4().hex[:8]
        self.world_name: str = name or f"world-{self.world_id}"
        self.created_at: str = datetime.now().strftime("%Y-%m-%d %H:%M")
        self.tick_count: int = 0
        self.world_time: str = "Dawn of the First Day"
        self.mood: str = "anticipation"
        self.locations: Dict[str, Dict[str, Any]] = {
            "The Nexus Station": {
                "description": "A sprawling orbital hub where magic-infused starships dock alongside ancient spell-gates. Markets, taverns, and pleasure houses line its curved corridors.",
                "characters": [],
            }
        }
        self.scenario: Optional[Dict[str, Any]] = None  # Generated scenario context
        self.active_events: List[str] = []
        self.event_log: List[Dict[str, Any]] = []

    def snapshot(self) -> str:
        """Produce a text summary of current world state for agents."""
        lines = [
            f"[WORLD STATE — Tick {self.tick_count}]",
            f"Time: {self.world_time}",
            f"Mood: {self.mood}",
        ]

        if self.scenario:
            lines.append("")
            lines.append(f"Setting: {self.scenario.get('setting', '')}")
            lines.append(f"Premise: {self.scenario.get('premise', '')}")
            themes = ", ".join(self.scenario.get("themes", []))
            if themes:
                lines.append(f"Themes: {themes}")
            if self.tick_count <= 1:
                lines.append(f"Opening: {self.scenario.get('opening_situation', '')}")
            # Include NPCs from scenario for narrator to introduce
            npcs = self.scenario.get("npcs", [])
            if npcs:
                lines.append("")
                lines.append("NPCs available to introduce:")
                for npc in npcs:
                    lines.append(f"  - {npc.get('name', '?')}: {npc.get('description', '')}")

        lines.append("")
        lines.append("Locations:")
        for loc_name, loc in self.locations.items():
            chars = ", ".join(loc.get("characters", [])) or "empty"
            lines.append(f"  {loc_name}: {chars}")
            lines.append(f"    {loc['description']}")

        if self.active_events:
            lines.append("")
            lines.append("Active events:")
            for e in self.active_events:
                lines.append(f"  - {e}")

        if self.event_log:
            lines.append("")
            lines.append("Recent events:")
            for entry in self.event_log[-5:]:
                lines.append(f"  [{entry['tick']}] {entry['event']}")

        return "\n".join(lines)

    def apply_narrator_update(self, narrator_result: Dict[str, Any]) -> None:
        """Apply changes from the narrator's tick output."""
        changes = narrator_result.get("world_changes", {})
        if changes.get("time_advance"):
            self.world_time = changes["time_advance"]
        if changes.get("mood"):
            self.mood = changes["mood"]

        # Log events
        for event in narrator_result.get("events", []):
            self.event_log.append({"tick": self.tick_count, "event": event})

        self.active_events = narrator_result.get("events", self.active_events)

    def place_character(self, name: str, location: str) -> None:
        """Place a character at a location."""
        # Remove from current location
        for loc in self.locations.values():
            if name in loc.get("characters", []):
                loc["characters"].remove(name)

        # Add to new location (create if needed)
        if location not in self.locations:
            self.locations[location] = {
                "description": "A newly discovered area.",
                "characters": [],
            }
        self.locations[location]["characters"].append(name)

    def info(self) -> Dict[str, Any]:
        """Summary info about this world."""
        char_count = sum(len(loc.get("characters", [])) for loc in self.locations.values())
        return {
            "world_id": self.world_id,
            "world_name": self.world_name,
            "created_at": self.created_at,
            "tick_count": self.tick_count,
            "world_time": self.world_time,
            "mood": self.mood,
            "characters": char_count,
        }

    def save(self, name: str = "autosave") -> str:
        """Save world state to JSON file."""
        path = os.path.join(SAVES_DIR, f"{name}.json")
        data = {
            "world_id": self.world_id,
            "world_name": self.world_name,
            "created_at": self.created_at,
            "tick_count": self.tick_count,
            "world_time": self.world_time,
            "mood": self.mood,
            "locations": self.locations,
            "scenario": self.scenario,
            "active_events": self.active_events,
            "event_log": self.event_log,
            "saved_at": time.time(),
        }
        with open(path, "w") as f:
            json.dump(data, f, indent=2)
        return path

    def load(self, name: str = "autosave") -> bool:
        """Load world state from JSON. Returns True if successful."""
        path = os.path.join(SAVES_DIR, f"{name}.json")
        if not os.path.exists(path):
            return False
        with open(path, "r") as f:
            data = json.load(f)
        self.world_id = data.get("world_id", self.world_id)
        self.world_name = data.get("world_name", self.world_name)
        self.created_at = data.get("created_at", self.created_at)
        self.tick_count = data["tick_count"]
        self.world_time = data["world_time"]
        self.mood = data["mood"]
        self.locations = data["locations"]
        self.scenario = data.get("scenario")
        self.active_events = data["active_events"]
        self.event_log = data["event_log"]
        return True
