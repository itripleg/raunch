"""Character agent — autonomous NPC with inner monologue."""

import json
import os
from typing import Dict, Any, Optional

from .base import Agent
from ..prompts import build_character_prompt
from ..config import CHARACTERS_DIR


class Character(Agent):
    """An autonomous character in the world."""

    def __init__(
        self,
        name: str,
        species: str = "Human",
        personality: str = "Curious and adaptable",
        appearance: str = "Average build, unremarkable",
        desires: str = "To find their place in the world",
        backstory: str = "A traveler with a mysterious past",
        **extras,
    ):
        self.character_data = {
            "name": name,
            "species": species,
            "personality": personality,
            "appearance": appearance,
            "desires": desires,
            "backstory": backstory,
            **extras,
        }
        prompt = build_character_prompt(**self.character_data)
        super().__init__(name=name, system_prompt=prompt)

        # Tracked state
        self.emotional_state: str = "neutral"
        self.location: str = "unknown"
        self.relationships: Dict[str, str] = {}
        self.pregnancy: Optional[Dict[str, Any]] = None

    def page(self, world_context: str, _retry: bool = False) -> Dict[str, Any]:
        """Run a character page — returns inner thoughts + action."""
        result = super().page(world_context, _retry=_retry)
        self._update_from_result(result)
        return result

    def page_stream(self, world_context: str, on_delta=None, _retry: bool = False) -> Dict[str, Any]:
        """Run a character page with streaming — returns inner thoughts + action."""
        result = super().page_stream(world_context, on_delta=on_delta, _retry=_retry)
        self._update_from_result(result)
        return result

    def _update_from_result(self, result: Dict[str, Any]) -> None:
        """Update tracked state from page response."""
        if isinstance(result, dict) and "raw" not in result:
            self.emotional_state = result.get("emotional_state", self.emotional_state)

    def get_state(self) -> Dict[str, Any]:
        """Full character state for saving."""
        state = super().get_state()
        state.update({
            "character_data": self.character_data,
            "emotional_state": self.emotional_state,
            "location": self.location,
            "relationships": self.relationships,
            "pregnancy": self.pregnancy,
        })
        return state

    def load_state(self, state: Dict[str, Any]) -> None:
        """Restore character state."""
        super().load_state(state)
        self.emotional_state = state.get("emotional_state", "neutral")
        self.location = state.get("location", "unknown")
        self.relationships = state.get("relationships", {})
        self.pregnancy = state.get("pregnancy")

    def save_template(self) -> None:
        """Save character definition as a reusable template."""
        path = os.path.join(CHARACTERS_DIR, f"{self.name.lower().replace(' ', '_')}.json")
        with open(path, "w") as f:
            json.dump(self.character_data, f, indent=2)

    @classmethod
    def from_template(cls, path: str) -> "Character":
        """Load a character from a template JSON file."""
        with open(path, "r") as f:
            data = json.load(f)
        return cls(**data)
