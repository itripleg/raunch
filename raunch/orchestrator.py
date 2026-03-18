"""Orchestrator — manages the world page loop and agent coordination."""

import json
import logging
import re
import threading
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from typing import Dict, Any, Optional, Callable, List

from .agents import Narrator, Character
from .world import WorldState
from .config import BASE_PAGE_SECONDS
from . import db
from .db import save_potential_character

logger = logging.getLogger(__name__)


def _parse_newchar_tags(narration: str) -> List[Dict[str, str]]:
    """Extract [[NewChar: Name | description]] tags from narration."""
    pattern = r'\[\[NewChar:\s*([^|]+)\s*\|\s*([^\]]+)\]\]'
    matches = re.findall(pattern, narration)
    return [{"name": n.strip(), "description": d.strip()} for n, d in matches]


def _strip_newchar_tags(narration: str) -> str:
    """Remove [[NewChar: ...]] tags and similar markers from display text."""
    # Remove [[NewChar: ...]] tags (case insensitive)
    text = re.sub(r'\[\[NewChar:[^\]]+\]\]', '', narration, flags=re.IGNORECASE)
    # Remove [[NEW_CHAR: ...]] variant
    text = re.sub(r'\[\[NEW_CHAR:[^\]]+\]\]', '', text, flags=re.IGNORECASE)
    # Remove any remaining [[...]] tags that might be LLM artifacts
    text = re.sub(r'\[\[[^\]]{0,100}\]\]', '', text)
    return text.strip()


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
        self._page_callbacks: List[Callable] = []  # Called after each page with results
        self._player_input: Optional[str] = None  # Pending player action (legacy)
        self._player_event = threading.Event()
        self._manual_page_event = threading.Event()  # For manual page mode
        self._host_triggered = False  # True when page triggered by CLI/host (bypasses multiplayer wait)

        # Influence system - whisper suggestions to characters
        self._influences: Dict[str, str] = {}  # character_name -> influence text

        # Director system - guidance for the narrator
        self._director_guidance: Optional[str] = None

        # Session tracking
        self.save_name: Optional[str] = None  # Name to save under (derived from scenario/world)
        self._initial_save_done = False  # Track if we've done the first auto-save

        # Page interval (can be changed at runtime, 0 = manual mode)
        self.page_interval = BASE_PAGE_SECONDS

        # Streaming support - disabled by default, use progressive rendering instead
        self.streaming_enabled = False
        self._stream_callback: Optional[Callable[[int, str, str, str], None]] = None
        self._stream_lock = threading.Lock()  # Protects _stream_callback from race conditions

        # Progressive rendering callbacks (for non-streaming mode)
        self._page_start_callback: Optional[Callable[[int], None]] = None  # (page_num)
        self._narrator_callback: Optional[Callable[[int, str, str], None]] = None  # (page, narration, mood)
        self._character_callback: Optional[Callable[[int, str, dict], None]] = None  # (page, name, data)

        # Turn-based multiplayer support
        self.turn_timeout: int = 60  # Seconds before timeout triggers page (0 = no timeout)
        self._player_ready_states: Dict[str, bool] = {}  # player_id -> ready state
        self._turn_start_time: Optional[float] = None  # When current turn started
        self._last_page_trigger_reason: str = 'auto'  # Reason for last page: 'all_ready', 'timeout', 'host', 'auto'

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
        """Whisper an influence/suggestion to a character for their next page."""
        if character_name not in self.characters:
            logger.warning(f"Influence rejected: character '{character_name}' not found")
            return False
        self._influences[character_name] = text
        logger.debug(f"Influence queued for {character_name}")
        return True

    def get_pending_influence(self, character_name: str) -> Optional[str]:
        """Get and clear any pending influence for a character."""
        return self._influences.pop(character_name, None)

    def submit_director_guidance(self, text: str) -> bool:
        """Queue guidance for the narrator for the next page."""
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

    # Turn-based multiplayer methods

    def set_player_ready(self, player_id: str, ready: bool = True) -> None:
        """Set a player's ready state for the current turn."""
        self._player_ready_states[player_id] = ready
        logger.debug(f"Player {player_id} ready state: {ready}")

    def clear_player_ready(self, player_id: str) -> None:
        """Remove a player from ready tracking (on disconnect)."""
        if player_id in self._player_ready_states:
            del self._player_ready_states[player_id]
            logger.debug(f"Player {player_id} removed from ready tracking")

    def reset_ready_states(self) -> None:
        """Reset all player ready states to False (after page completes)."""
        for player_id in self._player_ready_states:
            self._player_ready_states[player_id] = False
        self._turn_start_time = time.time()
        logger.debug("All player ready states reset")

    def get_ready_states(self) -> Dict[str, bool]:
        """Get current ready states for all tracked players."""
        return dict(self._player_ready_states)

    def all_players_ready(self) -> bool:
        """Check if all tracked players are ready. Returns False if no players."""
        if not self._player_ready_states:
            return False
        return all(self._player_ready_states.values())

    def get_player_count(self) -> int:
        """Get number of tracked players."""
        return len(self._player_ready_states)

    def get_waiting_for(self) -> List[str]:
        """Get list of player IDs who are not yet ready."""
        return [pid for pid, ready in self._player_ready_states.items() if not ready]

    def set_turn_timeout(self, seconds: int) -> None:
        """Set the turn timeout in seconds. 0 = no timeout."""
        self.turn_timeout = max(0, seconds)
        logger.info(f"Turn timeout set to {self.turn_timeout}s")

    def get_turn_elapsed(self) -> float:
        """Get seconds elapsed since turn started."""
        if self._turn_start_time is None:
            return 0.0
        return time.time() - self._turn_start_time

    def get_turn_remaining(self) -> float:
        """Get seconds remaining until timeout. Returns 0 if no timeout or expired."""
        if self.turn_timeout == 0:
            return float('inf')  # No timeout
        remaining = self.turn_timeout - self.get_turn_elapsed()
        return max(0.0, remaining)

    def _check_turn_ready(self) -> tuple[bool, str]:
        """Check if turn should proceed. Returns (ready, reason).

        Reasons: 'all_ready', 'timeout', 'no_players', or '' if not ready.
        """
        # No players tracked - don't auto-page (spec: "No auto-page when 0 players connected")
        if not self._player_ready_states:
            return (False, 'no_players')

        # All players ready
        if self.all_players_ready():
            return (True, 'all_ready')

        # Timeout expired (only if timeout is enabled)
        if self.turn_timeout > 0 and self.get_turn_remaining() <= 0:
            return (True, 'timeout')

        return (False, '')

    def _process_single_character(
        self,
        name: str,
        char: Character,
        narration_text: str,
        world_snapshot: str,
        page_num: int
    ) -> tuple[str, Dict[str, Any]]:
        """Process a single character's response to the current page.

        This method encapsulates all character processing logic including:
        - Influence checking
        - Player input handling
        - Streaming/non-streaming execution
        - Error handling

        Args:
            name: Character name
            char: Character instance
            narration_text: The narrator's narration for this page
            world_snapshot: Current world state description
            page_num: Current page number

        Returns:
            Tuple of (character_name, result_dict) where result_dict contains
            inner_thoughts, action, and optionally waiting_for_player flag
        """
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
                # Waiting for player — skip this character's page
                return (name, {
                    "inner_thoughts": "[Awaiting player input...]",
                    "action": None,
                    "waiting_for_player": True,
                })
        elif influence:
            # Character has an influence whispered to them
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
                # Don't send "start" for characters - only narrator gets page_start
                # This preserves the narrator content in the frontend streaming state
                def safe_delta(chunk, n=name):
                    with self._stream_lock:
                        if self._stream_callback:
                            self._stream_callback(page_num, n, "delta", chunk)

                char_result = char.page_stream(char_input, on_delta=safe_delta)

                with self._stream_lock:
                    if self._stream_callback:
                        self._stream_callback(page_num, name, "done", "")
            else:
                # Non-streaming mode - progressive rendering via character callbacks
                char_result = char.page(char_input)
            return (name, char_result)
        except Exception as e:
            logger.error(f"Character {name} page failed: {e}")
            return (name, {"inner_thoughts": f"[Error: {e}]", "action": None})

    def _run_page(self) -> Dict[str, Any]:
        """Execute one world page. Returns all results."""
        self.world.page_count += 1
        page_num = self.world.page_count
        results: Dict[str, Any] = {"page": page_num, "characters": {}}

        # Notify that page generation has started
        if self._page_start_callback:
            try:
                self._page_start_callback(page_num)
            except Exception as e:
                logger.error(f"Page start callback error: {e}")

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
                with self._stream_lock:
                    if self._stream_callback:
                        self._stream_callback(page_num, "narrator", "start", "")

                def on_chunk(chunk):
                    with self._stream_lock:
                        if self._stream_callback:
                            self._stream_callback(page_num, "narrator", "delta", chunk)

                narrator_result = self.narrator.page_stream(narrator_input, on_delta=on_chunk)

                with self._stream_lock:
                    if self._stream_callback:
                        self._stream_callback(page_num, "narrator", "done", "")
            else:
                # Non-streaming mode - progressive rendering via narrator/character callbacks
                narrator_result = self.narrator.page(narrator_input)

            self.world.apply_narrator_update(narrator_result)
            # Extract narration, cleaning up any raw JSON fallback
            narration = narrator_result.get("narration")
            if not narration:
                raw = narrator_result.get("raw", "")
                narration = _extract_narration_from_raw(raw)
            # Final cleanup - strip any remaining JSON artifacts
            narration = _clean_narration(narration)

            # Parse and save new character tags before stripping them
            new_chars = _parse_newchar_tags(narration)
            for char_info in new_chars:
                try:
                    save_potential_character(
                        self.world.world_id,
                        char_info["name"],
                        char_info["description"],
                        page_num
                    )
                    logger.info(f"Detected new character: {char_info['name']}")
                except Exception as e:
                    logger.error(f"Failed to save potential character {char_info['name']}: {e}")

            # Strip character tags from narration before display/save
            narration = _strip_newchar_tags(narration)

            results["narration"] = narration
            results["events"] = narrator_result.get("events", [])

            # Call narrator callback for progressive rendering (non-streaming mode)
            if not self.streaming_enabled and self._narrator_callback:
                try:
                    self._narrator_callback(page_num, narration, self.world.mood or "")
                except Exception as cb_e:
                    logger.error(f"Narrator callback error: {cb_e}")

        except Exception as e:
            logger.error(f"Narrator page failed: {e}", exc_info=True)
            results["narration"] = f"[Narrator error: {e}]"
            results["events"] = []

        # 2. Each character reacts (sequentially to avoid SDK subprocess contention)
        # Take a snapshot to avoid "dictionary changed size during iteration" errors
        narration_text = results["narration"]
        char_items = list(self.characters.items())

        for name, char in char_items:
            try:
                char_name, char_result = self._process_single_character(
                    name, char, narration_text, world_snapshot, page_num
                )
                results["characters"][char_name] = char_result

                # Call character callback for progressive rendering
                if not self.streaming_enabled and self._character_callback:
                    try:
                        self._character_callback(page_num, char_name, char_result)
                    except Exception as cb_e:
                        logger.error(f"Character callback error for {char_name}: {cb_e}")

            except Exception as e:
                logger.error(f"Character {name} processing failed: {e}")
                results["characters"][name] = {"inner_thoughts": f"[Error: {e}]", "action": None}

        # 3. Persist page to database (skip if error page)
        narration = results.get("narration", "")
        is_error_page = (
            narration.startswith("[Narrator error") or
            narration.startswith("[Error") or
            "401" in narration or
            "403" in narration or
            "unauthorized" in narration.lower() or
            "authentication" in narration.lower()
        )

        if is_error_page:
            logger.warning(f"Skipping DB save for error page {page_num}: {narration[:100]}")
            results["_is_error"] = True
        else:
            try:
                db.save_page(
                    self.world.world_id, page_num, narration,
                    results.get("events", []), self.world.world_time, self.world.mood,
                )
                for cname, cdata in results.get("characters", {}).items():
                    if isinstance(cdata, dict) and not cdata.get("waiting_for_player"):
                        db.save_character_page(self.world.world_id, page_num, cname, cdata)
            except Exception as e:
                logger.error(f"DB save failed: {e}")

        # 4. Autosave world state every page (JSON is small, prevents data loss)
        save_name = self.save_name or self._derive_save_name()
        self.world.save(save_name)
        if not self._initial_save_done:
            self._initial_save_done = True
            logger.info(f"Initial save: {save_name}")

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
        """Main page loop (runs in a thread)."""
        consecutive_errors = 0
        while self._running:
            # Wait while paused
            while self._paused and self._running:
                time.sleep(0.2)

            if not self._running:
                break

            # Manual mode: wait for trigger_page() to be called
            if self.page_interval == 0:
                self._manual_page_event.clear()
                self._manual_page_event.wait()
                if not self._running:
                    break

            # If player mode, wait for player input before paging
            if self.player_character and self.player_character in self.characters:
                if not self._player_input:
                    # Signal that we're waiting, then block
                    for cb in self._page_callbacks:
                        try:
                            cb({"waiting_for_player": True, "character": self.player_character})
                        except Exception:
                            pass
                    self._player_event.wait()
                    if not self._running:
                        break

            # Turn-based multiplayer: wait for all players ready OR timeout
            # Skip this wait if page was host-triggered (CLI override)
            # Only enter multiplayer wait if world.multiplayer is True
            page_trigger_reason = 'auto'  # Default for non-multiplayer mode
            if self._host_triggered:
                page_trigger_reason = 'host'
                self._host_triggered = False  # Reset for next page
                logger.info("Page triggered by host, skipping multiplayer wait")
            elif self.world.multiplayer and self._player_ready_states:
                # Initialize turn start time if not set
                if self._turn_start_time is None:
                    self._turn_start_time = time.time()

                # Poll for turn ready condition
                while self._running and not self._paused:
                    ready, reason = self._check_turn_ready()
                    if ready:
                        page_trigger_reason = reason
                        logger.info(f"Turn ready: {reason}")
                        break
                    if reason == 'no_players':
                        # No players connected - don't page, wait for players
                        time.sleep(0.5)
                        continue
                    # Not ready yet, sleep briefly and check again
                    time.sleep(0.25)

                if not self._running:
                    break

            # Check pause again before running page
            if self._paused:
                continue

            # Store trigger reason for streaming callback access
            self._last_page_trigger_reason = page_trigger_reason

            try:
                results = self._run_page()
                results['triggered_by'] = page_trigger_reason
            except Exception as e:
                # Catch any errors in page generation and send error to callbacks
                logger.error(f"Page generation crashed: {e}", exc_info=True)
                results = {
                    "page": self.world.page_count,
                    "narration": f"[Page generation error: {e}]",
                    "events": [],
                    "characters": {},
                    "_is_error": True,
                    "triggered_by": page_trigger_reason,
                }

            # Reset ready states after page completes (for multiplayer)
            if self.world.multiplayer and self._player_ready_states:
                self.reset_ready_states()

            # Check if page had errors
            if results.get("_is_error"):
                consecutive_errors += 1
                backoff = min(30 * consecutive_errors, 120)
                logger.warning(f"Page errors ({consecutive_errors}), backing off {backoff}s")
                # Send error to callbacks so frontend can show it as toast
                for cb in self._page_callbacks:
                    try:
                        cb({"error": results.get("narration", "Unknown error"), "page": results.get("page")})
                    except Exception as e:
                        logger.error(f"Error callback failed: {e}")
                self._interruptible_sleep(backoff)
                continue
            else:
                consecutive_errors = 0

            for cb in self._page_callbacks:
                try:
                    cb(results)
                except Exception as e:
                    logger.error(f"Page callback error: {e}")

            # Interruptible sleep between pages
            if not self._interruptible_sleep(self.page_interval):
                break

    def add_page_callback(self, callback: Callable) -> None:
        """Register a callback that fires after each page."""
        self._page_callbacks.append(callback)

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
        self._player_event.set()  # Unblock if waiting for player
        self._manual_page_event.set()  # Unblock if waiting for manual page
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

    def set_page_interval(self, seconds: int) -> None:
        """Set the page interval in seconds. 0 = manual mode, otherwise min 10, max 86400."""
        was_manual = self.page_interval == 0
        if seconds == 0:
            self.page_interval = 0
            logger.info("Page interval set to manual mode")
        else:
            self.page_interval = max(10, min(86400, seconds))
            logger.info(f"Page interval set to {self.page_interval}s")
            # If transitioning from manual to auto mode, unblock the loop
            if was_manual:
                self._manual_page_event.set()

    def trigger_page(self, host_override: bool = True) -> bool:
        """Manually trigger the next page (only works in manual mode).

        Args:
            host_override: If True, bypasses multiplayer ready-check (CLI/host triggered).
        """
        if self.page_interval != 0:
            logger.warning("trigger_page() called but not in manual mode")
            return False
        if self._paused:
            logger.warning("trigger_page() called but simulation is paused")
            return False
        self._host_triggered = host_override
        self._manual_page_event.set()
        return True

    @property
    def is_manual_mode(self) -> bool:
        return self.page_interval == 0

    def set_stream_callback(self, callback: Optional[Callable[[int, str, str, str], None]]) -> None:
        """Set callback for streaming: callback(page_num, source, event_type, data)."""
        self._stream_callback = callback

    def set_page_start_callback(self, callback: Optional[Callable[[int], None]]) -> None:
        """Set callback for page generation start: callback(page_num)."""
        self._page_start_callback = callback

    def set_narrator_callback(self, callback: Optional[Callable[[int, str, str], None]]) -> None:
        """Set callback for narrator completion (non-streaming): callback(page_num, narration, mood)."""
        self._narrator_callback = callback

    def set_character_callback(self, callback: Optional[Callable[[int, str, dict], None]]) -> None:
        """Set callback for character completion (non-streaming): callback(page_num, name, data)."""
        self._character_callback = callback

    @property
    def is_paused(self) -> bool:
        return self._paused
