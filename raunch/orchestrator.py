"""Orchestrator — manages the world tick loop and agent coordination."""

import json
import logging
import re
import threading
import time
from typing import Dict, Any, Optional, Callable, List

from .agents import Narrator, Character
from .world import WorldState
from .config import BASE_TICK_SECONDS
from . import db

logger = logging.getLogger(__name__)


def _extract_narration_from_raw(raw: str) -> str:
    """Extract narration text from raw LLM response that may contain JSON."""
    # Try to extract "narration": "..." field
    match = re.search(r'"narration"\s*:\s*"((?:[^"\\]|\\.)*)"\s*[,}]', raw, re.DOTALL)
    if match:
        text = match.group(1)
        # Unescape JSON string
        text = text.replace('\\"', '"').replace('\\n', '\n').replace('\\t', '\t')
        return text

    # Strip markdown code fences and JSON blocks
    text = re.sub(r'```(?:json)?\s*', '', raw)
    text = re.sub(r'```', '', text)

    # Try to remove JSON object if present
    text = re.sub(r'\{\s*"narration".*?\}', '', text, flags=re.DOTALL)

    return text.strip() or raw


def _clean_narration(narration: str) -> str:
    """Final cleanup of narration text - remove any JSON/markdown artifacts."""
    if not narration:
        return narration

    # Remove markdown code fences
    narration = re.sub(r'```(?:json)?\s*', '', narration)
    narration = re.sub(r'```', '', narration)

    # Remove JSON-like structures
    narration = re.sub(r'\{\s*"[^"]+"\s*:', '', narration)  # Opening: {"key":
    narration = re.sub(r'",\s*"[^"]+"\s*:', '', narration)  # Middle: ", "key":
    narration = re.sub(r'"\s*\}', '', narration)  # Closing: "}
    narration = re.sub(r'^\s*\[\s*', '', narration)  # Opening array
    narration = re.sub(r'\s*\]\s*$', '', narration)  # Closing array

    # Remove isolated JSON punctuation
    narration = re.sub(r'^\s*[{}\[\]]\s*', '', narration)
    narration = re.sub(r'\s*[{}\[\]]\s*$', '', narration)

    # Clean up excessive whitespace
    narration = re.sub(r'\n{3,}', '\n\n', narration)

    return narration.strip()


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
        self._player_input: Optional[str] = None  # Pending player action (legacy)
        self._player_event = threading.Event()
        self._pause_event = threading.Event()  # Signaled when pause state changes
        self._pause_event.set()  # Start unpaused (set = not paused)

        # Influence system - whisper suggestions to characters
        self._influences: Dict[str, str] = {}  # character_name -> influence text

        # Director system - guidance for the narrator
        self._director_guidance: Optional[str] = None

        # Session tracking
        self.is_loaded_session = False  # True if this was loaded from a save
        self.save_name: Optional[str] = None  # Name to save under (derived from scenario/world)
        self._initial_save_done = False  # Track if we've done the first auto-save

        # Tick interval (can be changed at runtime)
        self.tick_interval = BASE_TICK_SECONDS

        # Streaming support
        self.streaming_enabled = True
        self._stream_callback: Optional[Callable[[int, str, str, str], None]] = None

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

    def submit_influence(self, character_name: str, text: str) -> bool:
        """Whisper an influence/suggestion to a character for their next tick."""
        logger.warning(f"[INFLUENCE] submit_influence called for '{character_name}'")
        logger.warning(f"[INFLUENCE] Available characters: {list(self.characters.keys())}")
        if character_name not in self.characters:
            logger.warning(f"[INFLUENCE] Character '{character_name}' NOT FOUND!")
            return False
        self._influences[character_name] = text
        logger.warning(f"[INFLUENCE] Queued for {character_name}: {text[:50]}...")
        return True

    def get_pending_influence(self, character_name: str) -> Optional[str]:
        """Get and clear any pending influence for a character."""
        influence = self._influences.pop(character_name, None)
        if influence:
            logger.warning(f"[INFLUENCE] Retrieved for {character_name}: {influence[:50]}...")
        return influence

    def submit_director_guidance(self, text: str) -> bool:
        """Queue guidance for the narrator for the next tick."""
        self._director_guidance = text
        logger.info(f"[DIRECTOR] Queued guidance: {text[:50]}...")
        return True

    def get_director_guidance(self) -> Optional[str]:
        """Get and clear any pending director guidance."""
        guidance = self._director_guidance
        self._director_guidance = None
        if guidance:
            logger.info(f"[DIRECTOR] Retrieved guidance: {guidance[:50]}...")
        return guidance

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

        # Check for director guidance
        director_guidance = self.get_director_guidance()

        narrator_input = (
            f"{world_snapshot}\n\n"
            f"Characters in play:\n" + "\n".join(char_summaries) + "\n\n"
        )

        if director_guidance:
            narrator_input += (
                f"[DIRECTOR GUIDANCE]: {director_guidance}\n"
                f"Incorporate this into the scene naturally. Don't acknowledge the guidance directly.\n\n"
            )

        narrator_input += "Advance the world. What happens next?"

        try:
            if self.streaming_enabled and self._stream_callback:
                # Streaming mode
                logger.warning(f"[STREAM] Starting narrator stream for tick {tick_num}")
                self._stream_callback(tick_num, "narrator", "start", "")
                chunk_count = 0
                def on_chunk(chunk):
                    nonlocal chunk_count
                    chunk_count += 1
                    self._stream_callback(tick_num, "narrator", "delta", chunk)
                narrator_result = self.narrator.tick_stream(narrator_input, on_delta=on_chunk)
                logger.warning(f"[STREAM] Narrator done, sent {chunk_count} chunks")
                self._stream_callback(tick_num, "narrator", "done", "")
            else:
                logger.warning(f"[STREAM] Streaming disabled or no callback, streaming_enabled={self.streaming_enabled}, has_callback={self._stream_callback is not None}")
                narrator_result = self.narrator.tick(narrator_input)

            self.world.apply_narrator_update(narrator_result)
            # Extract narration, cleaning up any raw JSON fallback
            narration = narrator_result.get("narration")
            if not narration:
                raw = narrator_result.get("raw", "")
                narration = _extract_narration_from_raw(raw)
            # Final cleanup - strip any remaining JSON artifacts
            narration = _clean_narration(narration)
            results["narration"] = narration
            results["events"] = narrator_result.get("events", [])
        except Exception as e:
            logger.error(f"Narrator tick failed: {e}", exc_info=True)
            results["narration"] = f"[Narrator error: {e}]"
            results["events"] = []

        # 2. Each character reacts
        narration_text = results["narration"]
        logger.warning(f"[TICK] Processing characters: {list(self.characters.keys())}")
        logger.warning(f"[TICK] Pending influences: {list(self._influences.keys())}")
        for name, char in self.characters.items():
            # Check for pending influence (whispered suggestion)
            influence = self.get_pending_influence(name)

            # Skip player character if waiting for input (legacy mode)
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
            elif influence:
                # Character has an influence whispered to them
                logger.warning(f"[INFLUENCE] APPLYING to {name}: {influence[:50]}...")
                char_input = (
                    f"{world_snapshot}\n\n"
                    f"[NARRATOR]: {narration_text}\n\n"
                    f"[INNER VOICE - a sudden urge, desire, or thought wells up within you]: {influence}\n\n"
                    f"This thought feels compelling. Let it guide your actions and feelings this moment.\n\n"
                    f"What do you do? What are you thinking and feeling?"
                )
            else:
                char_input = (
                    f"{world_snapshot}\n\n"
                    f"[NARRATOR]: {narration_text}\n\n"
                    f"What do you do? What are you thinking and feeling?"
                )

            try:
                if self.streaming_enabled and self._stream_callback:
                    self._stream_callback(tick_num, name, "start", "")
                    char_result = char.tick_stream(
                        char_input,
                        on_delta=lambda chunk, n=name: self._stream_callback(tick_num, n, "delta", chunk)
                    )
                    self._stream_callback(tick_num, name, "done", "")
                else:
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

        # 4. Autosave world state
        # - First tick of new session: always save immediately
        # - Otherwise: save every 10 ticks
        save_name = self.save_name or self._derive_save_name()
        if not self._initial_save_done:
            self.world.save(save_name)
            self._initial_save_done = True
            logger.info(f"Initial save: {save_name}")
        elif tick_num % 10 == 0:
            self.world.save(save_name)

        return results

    def _derive_save_name(self) -> str:
        """Generate a save name from scenario or world name."""
        if self.world.scenario:
            name = self.world.scenario.get("scenario_name", "")
            if name:
                # Convert to slug: lowercase, replace spaces with underscores
                return name.lower().replace(" ", "_").replace("'", "")[:50]
        return self.world.world_name or "autosave"

    def _interruptible_sleep(self, seconds: float) -> bool:
        """Sleep for up to `seconds`, but wake early if pause state changes.
        Returns True if we should continue running, False if stopped."""
        # Sleep in small chunks so we can respond to pause/stop quickly
        interval = 0.5
        elapsed = 0.0
        while elapsed < seconds and self._running:
            if self._paused:
                # If paused, wait for unpause
                return True
            time.sleep(min(interval, seconds - elapsed))
            elapsed += interval
        return self._running

    def _loop(self) -> None:
        """Main tick loop (runs in a thread)."""
        consecutive_errors = 0
        while self._running:
            # Wait while paused
            while self._paused and self._running:
                time.sleep(0.2)

            if not self._running:
                break

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

            # Check pause again before running tick
            if self._paused:
                continue

            results = self._run_tick()

            # Check if tick had errors (narrator failed = all failed)
            narration = results.get("narration", "")
            if narration.startswith("[Narrator error"):
                consecutive_errors += 1
                backoff = min(30 * consecutive_errors, 120)
                logger.warning(f"Tick errors ({consecutive_errors}), backing off {backoff}s")
                self._interruptible_sleep(backoff)
                continue
            else:
                consecutive_errors = 0

            for cb in self._tick_callbacks:
                try:
                    cb(results)
                except Exception as e:
                    logger.error(f"Tick callback error: {e}")

            # Interruptible sleep between ticks
            if not self._interruptible_sleep(self.tick_interval):
                break

    def add_tick_callback(self, callback: Callable) -> None:
        """Register a callback that fires after each tick."""
        self._tick_callbacks.append(callback)

    def start(self) -> None:
        """Start the world simulation in a background thread."""
        if self._running:
            return
        self._running = True
        self._paused = False
        self._thread = threading.Thread(target=self._loop, daemon=True)
        self._thread.start()
        logger.info("World simulation started")

    def stop(self) -> None:
        """Stop the simulation."""
        self._running = False
        self._player_event.set()  # Unblock if waiting
        if self._thread:
            self._thread.join(timeout=5)
        save_name = self.save_name or self._derive_save_name()
        self.world.save(save_name)
        logger.info(f"World saved to {save_name}")

    def pause(self) -> None:
        self._paused = True
        logger.info("World paused")

    def resume(self) -> None:
        self._paused = False
        logger.info("World resumed")

    def set_tick_interval(self, seconds: int) -> None:
        """Set the tick interval in seconds (min 10, max 86400 / 24h)."""
        self.tick_interval = max(10, min(86400, seconds))
        logger.info(f"Tick interval set to {self.tick_interval}s")

    def set_stream_callback(self, callback: Optional[Callable[[int, str, str, str], None]]) -> None:
        """Set callback for streaming: callback(tick_num, source, event_type, data)."""
        self._stream_callback = callback
        logger.warning(f"[STREAM] Stream callback set: {callback is not None}")

    @property
    def is_paused(self) -> bool:
        return self._paused
