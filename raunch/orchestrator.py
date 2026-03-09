"""Orchestrator — manages the world tick loop and agent coordination."""

import json
import logging
import threading
import time
from typing import Dict, Any, Optional, Callable, List

from .agents import Narrator, Character
from .world import WorldState
from .config import BASE_TICK_SECONDS
from . import db

logger = logging.getLogger(__name__)


class Orchestrator:
    """Runs the autonomous world simulation."""

    def __init__(self):
        self.world = WorldState()
        self.narrator = Narrator()
        db.init_db()
        self.characters: Dict[str, Character] = {}
        self.player_character: Optional[str] = None  # Name of player-controlled character
        self.attached_to: Optional[str] = None  # Character whose thoughts we're viewing

        self._running = False
        self._paused = False
        self._thread: Optional[threading.Thread] = None
        self._tick_callbacks: List[Callable] = []  # Called after each tick with results
        self._player_input: Optional[str] = None  # Pending player action
        self._player_event = threading.Event()

    def add_character(self, character: Character, location: str = "The Nexus Station") -> None:
        """Add a character to the world."""
        self.characters[character.name] = character
        self.world.place_character(character.name, location)
        logger.info(f"Added character: {character.name} at {location}")

    def remove_character(self, name: str) -> None:
        """Remove a character from the world."""
        if name in self.characters:
            del self.characters[name]
            for loc in self.world.locations.values():
                if name in loc.get("characters", []):
                    loc["characters"].remove(name)

    def set_player(self, name: Optional[str]) -> None:
        """Set which character is player-controlled (None for fully autonomous)."""
        self.player_character = name

    def attach(self, name: Optional[str]) -> None:
        """Attach to a character to view their inner thoughts."""
        self.attached_to = name

    def submit_player_action(self, action: str) -> None:
        """Submit an action for the player character."""
        self._player_input = action
        self._player_event.set()

    def _run_tick(self) -> Dict[str, Any]:
        """Execute one world tick. Returns all results."""
        self.world.tick_count += 1
        tick_num = self.world.tick_count
        results: Dict[str, Any] = {"tick": tick_num, "characters": {}}

        # 1. Narrator advances the world
        world_snapshot = self.world.snapshot()
        char_summaries = []
        for name, char in self.characters.items():
            char_summaries.append(f"- {name} ({char.character_data.get('species', '?')}): {char.emotional_state}, at {char.location}")

        narrator_input = (
            f"{world_snapshot}\n\n"
            f"Characters in play:\n" + "\n".join(char_summaries) + "\n\n"
            f"Advance the world. What happens next?"
        )

        try:
            narrator_result = self.narrator.tick(narrator_input)
            self.world.apply_narrator_update(narrator_result)
            results["narration"] = narrator_result.get("narration", narrator_result.get("raw", ""))
            results["events"] = narrator_result.get("events", [])
        except Exception as e:
            logger.error(f"Narrator tick failed: {e}")
            results["narration"] = f"[Narrator error: {e}]"
            results["events"] = []

        # 2. Each character reacts
        narration_text = results["narration"]
        for name, char in self.characters.items():
            # Skip player character if waiting for input
            if name == self.player_character:
                if self._player_input:
                    # Use player's action
                    char_input = (
                        f"{world_snapshot}\n\n"
                        f"[NARRATOR]: {narration_text}\n\n"
                        f"You ({name}) decide to: {self._player_input}\n\n"
                        f"Describe your inner thoughts and how you carry out this action."
                    )
                    self._player_input = None
                    self._player_event.clear()
                else:
                    # Waiting for player — skip this character's tick
                    results["characters"][name] = {
                        "inner_thoughts": "[Awaiting player input...]",
                        "action": None,
                        "waiting_for_player": True,
                    }
                    continue
            else:
                char_input = (
                    f"{world_snapshot}\n\n"
                    f"[NARRATOR]: {narration_text}\n\n"
                    f"What do you do? What are you thinking and feeling?"
                )

            try:
                char_result = char.tick(char_input)
                results["characters"][name] = char_result
            except Exception as e:
                logger.error(f"Character {name} tick failed: {e}")
                results["characters"][name] = {"inner_thoughts": f"[Error: {e}]", "action": None}

        # 3. Persist tick to database
        try:
            db.save_tick(
                self.world.world_id, tick_num, results.get("narration", ""),
                results.get("events", []), self.world.world_time, self.world.mood,
            )
            for cname, cdata in results.get("characters", {}).items():
                if isinstance(cdata, dict) and not cdata.get("waiting_for_player"):
                    db.save_character_tick(self.world.world_id, tick_num, cname, cdata)
        except Exception as e:
            logger.error(f"DB save failed: {e}")

        # 4. Autosave world state every 10 ticks
        if tick_num % 10 == 0:
            self.world.save()

        return results

    def _loop(self) -> None:
        """Main tick loop (runs in a thread)."""
        consecutive_errors = 0
        while self._running:
            if self._paused:
                time.sleep(0.5)
                continue

            # If player mode, wait for player input before ticking
            if self.player_character and self.player_character in self.characters:
                if not self._player_input:
                    # Signal that we're waiting, then block
                    for cb in self._tick_callbacks:
                        try:
                            cb({"waiting_for_player": True, "character": self.player_character})
                        except Exception:
                            pass
                    self._player_event.wait()
                    if not self._running:
                        break

            results = self._run_tick()

            # Check if tick had errors (narrator failed = all failed)
            narration = results.get("narration", "")
            if narration.startswith("[Narrator error"):
                consecutive_errors += 1
                backoff = min(30 * consecutive_errors, 120)
                logger.warning(f"Tick errors ({consecutive_errors}), backing off {backoff}s")
                time.sleep(backoff)
                continue
            else:
                consecutive_errors = 0

            for cb in self._tick_callbacks:
                try:
                    cb(results)
                except Exception as e:
                    logger.error(f"Tick callback error: {e}")

            time.sleep(BASE_TICK_SECONDS)

    def add_tick_callback(self, callback: Callable) -> None:
        """Register a callback that fires after each tick."""
        self._tick_callbacks.append(callback)

    def start(self) -> None:
        """Start the world simulation in a background thread."""
        if self._running:
            return
        self._running = True
        self._thread = threading.Thread(target=self._loop, daemon=True)
        self._thread.start()
        logger.info("World simulation started")

    def stop(self) -> None:
        """Stop the simulation."""
        self._running = False
        self._player_event.set()  # Unblock if waiting
        if self._thread:
            self._thread.join(timeout=5)
        self.world.save()
        logger.info("World simulation stopped")

    def pause(self) -> None:
        self._paused = True

    def resume(self) -> None:
        self._paused = False

