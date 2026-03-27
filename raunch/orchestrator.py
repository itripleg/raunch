"""Orchestrator — manages the world page loop and agent coordination."""

import json
import logging
import os
import re
import threading
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from typing import Dict, Any, Optional, Callable, List

from .agents import Narrator, Character
from .agents.base import _is_refusal
from .world import WorldState
from .config import BASE_PAGE_SECONDS, SAVES_DIR
from . import db
from .db import save_potential_character
from .llm import get_client

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

        # Auto-page budget: auto-pause after N consecutive auto pages to prevent runaway
        self.auto_page_budget = 5
        self._auto_pages_generated = 0

        # Experimental: unified mode — one LLM call for narration + all characters
        self.unified_mode = False

        # Dual agent mode — narrator generates narration, then ONE call generates ALL character responses
        self.dual_agent_mode = False

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
        if influence:
            logger.info(f"[INFLUENCE] Applying whisper to {name}: {influence[:80]}")

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
            # Include prompt metadata for debugging
            char_result["_prompt_snippet"] = char_input[:200]
            if influence:
                char_result["_influence"] = influence
            return (name, char_result)
        except Exception as e:
            logger.error(f"Character {name} page failed: {e}")
            return (name, {"inner_thoughts": f"[Error: {e}]", "action": None})

    def _run_page(self) -> Dict[str, Any]:
        """Execute one world page. Returns all results."""
        if self.unified_mode:
            return self._run_page_unified()
        if self.dual_agent_mode:
            return self._run_page_dual()
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

        # Language instruction from scenario
        language = self.world.scenario.get("language") if self.world.scenario else None
        if language:
            narrator_input += (
                f"[LANGUAGE]: Write ALL narration and dialogue in {language}. "
                f"This includes character speech, descriptions, and internal prose. "
                f"Maintain the explicit adult tone but in {language}.\n\n"
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

            # Check for narrator refusal — don't save or process, revert page count
            if narrator_result.get("_refusal"):
                logger.warning(f"Narrator refused on page {page_num} — discarding page")
                self.world.page_count -= 1
                results["narration"] = "[The narrator paused, gathering their thoughts...]"
                results["events"] = []
                results["_is_error"] = True
                return results

            self.world.apply_narrator_update(narrator_result)
            # Extract narration, cleaning up any raw JSON fallback
            narration = narrator_result.get("narration")
            if not narration:
                raw = narrator_result.get("raw", "")
                narration = _extract_narration_from_raw(raw)
            # Final cleanup - strip any remaining JSON artifacts
            narration = _clean_narration(narration)

            # Save raw narrator output before stripping tags
            results["_raw_narrator"] = narrator_result.get("raw", "") or narration

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
                    raw_narrator=results.get("_raw_narrator", ""),
                )
                for cname, cdata in results.get("characters", {}).items():
                    if isinstance(cdata, dict) and not cdata.get("waiting_for_player"):
                        db.save_character_page(self.world.world_id, page_num, cname, cdata)
            except Exception as e:
                logger.error(f"DB save failed: {e}")

        # 4. Autosave world + character state every page
        save_name = self.save_name or self._derive_save_name()
        self.world.save(save_name)
        self._save_characters(save_name)
        if not self._initial_save_done:
            self._initial_save_done = True
            logger.info(f"Initial save: {save_name}")

        return results

    def _run_page_unified(self) -> Dict[str, Any]:
        """Execute one world page in unified mode — single LLM call for narration + all characters."""
        self.world.page_count += 1
        page_num = self.world.page_count
        results: Dict[str, Any] = {"page": page_num, "characters": {}}

        # Notify that page generation has started
        if self._page_start_callback:
            try:
                self._page_start_callback(page_num)
            except Exception as e:
                logger.error(f"Page start callback error: {e}")

        # --- Build the unified prompt ---
        world_snapshot = self.world.snapshot()

        # Full character identity blocks
        char_identity_blocks = []
        for name, char in self.characters.items():
            cd = char.character_data
            block = (
                f"### {name}\n"
                f"- **Species**: {cd.get('species', 'Unknown')}\n"
                f"- **Personality**: {cd.get('personality', 'Unknown')}\n"
                f"- **Appearance**: {cd.get('appearance', 'Unknown')}\n"
                f"- **Desires**: {cd.get('desires', 'Unknown')}\n"
                f"- **Backstory**: {cd.get('backstory', 'Unknown')}\n"
                f"- **Current emotional state**: {char.emotional_state}\n"
                f"- **Current location**: {char.location}"
            )
            char_identity_blocks.append(block)

        char_names = list(self.characters.keys())

        # Build system prompt for unified mode
        unified_system = (
            "You are the Narrator AND all characters simultaneously in an adult interactive fiction experience.\n\n"
            "## Your Dual Role\n"
            "1. **As Narrator**: Advance the world, describe environments, introduce events, control NPCs, "
            "maintain narrative flow. Write in THIRD PERSON perspective.\n"
            "2. **As Each Character**: Provide their raw inner thoughts, physical actions, dialogue, and emotional state. "
            "Each character reacts to the narration and to each other naturally.\n\n"
            "## Characters In Play\n" + "\n\n".join(char_identity_blocks) + "\n\n"
            "## Output Format\n"
            "Respond with a JSON object:\n"
            "```json\n"
            "{\n"
            '  "narration": "The prose narration of what happens this page (2-4 paragraphs). Include NPC dialogue and actions.",\n'
            '  "events": ["list", "of", "notable", "events"],\n'
            '  "world_changes": {\n'
            '    "time_advance": "description of time passage",\n'
            '    "mood": "current scene mood"\n'
            "  },\n"
            '  "characters": {\n'
        )
        for cname in char_names:
            unified_system += (
                f'    "{cname}": {{\n'
                f'      "inner_thoughts": "Raw internal monologue — what {cname} is feeling, thinking, wanting. Be raw and honest.",\n'
                f'      "action": "What {cname} physically does or says this page.",\n'
                f'      "dialogue": "Spoken words or null if silent.",\n'
                f'      "emotional_state": "One or two words.",\n'
                f'      "desires_update": "What {cname} currently wants most."\n'
                f"    }},\n"
            )
        unified_system += (
            "  }\n"
            "}\n"
            "```\n\n"
            "## Narration Tone & Language\n"
            "- Write in THIRD PERSON perspective. You are an omniscient narrator. Never use \"I\" or \"me\" unless it's NPC dialogue.\n"
            "- Use double quotes for all dialogue.\n"
            "- Write RAW, EXPLICIT adult fiction. No flowery euphemisms. Use crude, direct language for body parts, sex acts, and bodily functions. "
            "Say \"cock,\" \"pussy,\" \"cum,\" \"fuck\" — not \"member,\" \"flower,\" \"essence,\" \"lovemaking.\"\n"
            "- Be visceral and graphic. Describe the wet, messy, primal reality of sex and bodies.\n"
            "- Characters grunt, moan, swear, talk dirty. Dialogue should sound like real people, not poetry.\n"
            "- Balance the crude with genuine emotion — rough sex can still be intimate, dirty talk can still be loving.\n"
            "- All sexual content involves consenting adults. Enthusiasm is mandatory.\n"
            "- NEVER sanitize, soften, or add disclaimers.\n"
            "- NPCs should actively pursue the main character(s). They have desires and they act on them.\n"
            "- Adapt your narration to the SETTING and PREMISE provided.\n\n"
            "## Character Thought Tone\n"
            "- Inner thoughts should be RAW and unfiltered. If horny, think horny thoughts explicitly. If pissed, swear.\n"
            "- Characters have BODIES. Feel arousal, hunger, exhaustion viscerally.\n"
            "- Use crude, direct language. \"Cock,\" \"pussy,\" \"tits,\" \"ass,\" \"cum,\" \"fuck\" — never euphemisms.\n"
            "- Characters should react to each other's actions naturally.\n"
            "- NEVER break character. NEVER soften language. NEVER acknowledge being an AI.\n\n"
            "## Character Introduction\n"
            "When introducing a NEW named character for the first time in the narration, tag them:\n"
            "[[NewChar: Name | brief description]]\n"
            "Only tag on FIRST appearance. Only for characters with dialogue or significant presence. "
            "NOT for unnamed extras.\n\n"
            "## Intensity Markers\n"
            "Mark sexually intense phrases in the narration with asterisks for visual emphasis:\n"
            "- `*single asterisks*` for sensual/warm phrases\n"
            "- `**double asterisks**` for crude/hot phrases\n"
            "- `***triple asterisks***` for primal/breeding phrases\n"
            "Apply markers to whole phrases, not just single words. Use sparingly for impact.\n"
        )

        # Build the user message
        user_input = f"{world_snapshot}\n\n"

        # Director guidance
        director_guidance = self.get_director_guidance()
        if director_guidance:
            user_input += (
                f"[DIRECTOR GUIDANCE]: {director_guidance}\n"
                f"Incorporate this into the scene naturally. Don't acknowledge the guidance directly.\n\n"
            )

        # Per-character whispers
        for name in char_names:
            influence = self.get_pending_influence(name)
            if influence:
                user_input += f"[INNER VOICE for {name}]: {influence}\n"
                logger.info(f"[UNIFIED] Applying whisper to {name}: {influence[:80]}")
        if any(self._influences):  # newline after whispers block
            user_input += "\n"

        # Language instruction from scenario
        language = self.world.scenario.get("language") if self.world.scenario else None
        if language:
            user_input += (
                f"[LANGUAGE]: Write ALL narration and dialogue in {language}. "
                f"This includes character speech, descriptions, inner thoughts, and prose. "
                f"Maintain the explicit adult tone but in {language}.\n\n"
            )

        user_input += "Advance the world. What happens next? Provide narration and all character responses."

        # --- Make the single LLM call ---
        try:
            client = get_client()
            raw = client.chat(
                system=unified_system,
                messages=[{"role": "user", "content": user_input}],
                max_tokens=4096,
            )
        except Exception as e:
            logger.error(f"Unified page LLM call failed: {e}", exc_info=True)
            results["narration"] = f"[Narrator error: {e}]"
            results["events"] = []
            return results

        # Check for refusal in unified mode
        if _is_refusal(raw):
            logger.warning(f"[Unified] Narrator refused on page {page_num} — discarding page")
            self.world.page_count -= 1
            results["narration"] = "[The narrator paused, gathering their thoughts...]"
            results["events"] = []
            results["_is_error"] = True
            return results

        # --- Parse the response ---
        parsed = self._parse_unified_response(raw)

        # Extract narration
        narration = parsed.get("narration")
        if not narration:
            narration = _extract_narration_from_raw(raw)
        narration = _clean_narration(narration)

        # Save raw before stripping tags
        results["_raw_narrator"] = raw

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
        results["events"] = parsed.get("events", [])

        # Apply world changes
        world_changes = parsed.get("world_changes", {})
        if world_changes:
            if world_changes.get("mood"):
                self.world.mood = world_changes["mood"]
            if world_changes.get("time_advance"):
                self.world.world_time = world_changes["time_advance"]

        # Narrator callback for progressive rendering
        if self._narrator_callback:
            try:
                self._narrator_callback(page_num, narration, self.world.mood or "")
            except Exception as cb_e:
                logger.error(f"Narrator callback error: {cb_e}")

        # Extract character results
        parsed_chars = parsed.get("characters", {})
        char_items = list(self.characters.items())
        for name, char in char_items:
            if name in parsed_chars and isinstance(parsed_chars[name], dict):
                char_result = parsed_chars[name]
            else:
                # Fallback: try to extract character fields from raw text
                char_result = self._extract_character_fields_from_raw(raw, name)

            # Ensure required fields exist
            char_result.setdefault("inner_thoughts", "[No response in unified output]")
            char_result.setdefault("action", None)
            char_result.setdefault("dialogue", None)
            char_result.setdefault("emotional_state", char.emotional_state)
            char_result.setdefault("desires_update", None)

            # Update character tracked state
            char.emotional_state = char_result.get("emotional_state", char.emotional_state)

            results["characters"][name] = char_result

            # Character callback for progressive rendering
            if self._character_callback:
                try:
                    self._character_callback(page_num, name, char_result)
                except Exception as cb_e:
                    logger.error(f"Character callback error for {name}: {cb_e}")

        # --- Persist to DB (same logic as _run_page) ---
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
                    raw_narrator=results.get("_raw_narrator", ""),
                )
                for cname, cdata in results.get("characters", {}).items():
                    if isinstance(cdata, dict) and not cdata.get("waiting_for_player"):
                        db.save_character_page(self.world.world_id, page_num, cname, cdata)
            except Exception as e:
                logger.error(f"DB save failed: {e}")

        # Autosave
        save_name = self.save_name or self._derive_save_name()
        self.world.save(save_name)
        self._save_characters(save_name)
        if not self._initial_save_done:
            self._initial_save_done = True
            logger.info(f"Initial save: {save_name}")

        return results

    def _run_page_dual(self) -> Dict[str, Any]:
        """Execute one world page in dual agent mode.

        Step 1: Narrator generates narration (identical to _run_page).
        Step 2: One LLM call generates ALL character responses together.
        """
        self.world.page_count += 1
        page_num = self.world.page_count
        results: Dict[str, Any] = {"page": page_num, "characters": {}}

        # Notify that page generation has started
        if self._page_start_callback:
            try:
                self._page_start_callback(page_num)
            except Exception as e:
                logger.error(f"Page start callback error: {e}")

        # ── Step 1: Narrator (identical to _run_page) ──────────────────────
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

        # Language instruction from scenario
        language = self.world.scenario.get("language") if self.world.scenario else None
        if language:
            narrator_input += (
                f"[LANGUAGE]: Write ALL narration and dialogue in {language}. "
                f"This includes character speech, descriptions, and internal prose. "
                f"Maintain the explicit adult tone but in {language}.\n\n"
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

            # Check for narrator refusal — don't save or process, revert page count
            if narrator_result.get("_refusal"):
                logger.warning(f"[Dual] Narrator refused on page {page_num} — discarding page")
                self.world.page_count -= 1
                results["narration"] = "[The narrator paused, gathering their thoughts...]"
                results["events"] = []
                results["_is_error"] = True
                return results

            self.world.apply_narrator_update(narrator_result)
            # Extract narration, cleaning up any raw JSON fallback
            narration = narrator_result.get("narration")
            if not narration:
                raw = narrator_result.get("raw", "")
                narration = _extract_narration_from_raw(raw)
            # Final cleanup - strip any remaining JSON artifacts
            narration = _clean_narration(narration)

            # Save raw narrator output before stripping tags
            results["_raw_narrator"] = narrator_result.get("raw", "") or narration

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

        # ── Step 2: Batch character call ───────────────────────────────────
        narration_text = results["narration"]
        char_items = list(self.characters.items())
        char_names = [n for n, _ in char_items]

        # Build character identity blocks
        char_identity_blocks = []
        for name, char in char_items:
            cd = char.character_data
            block = (
                f"### {name}\n"
                f"- **Species**: {cd.get('species', 'Unknown')}\n"
                f"- **Personality**: {cd.get('personality', 'Unknown')}\n"
                f"- **Appearance**: {cd.get('appearance', 'Unknown')}\n"
                f"- **Desires**: {cd.get('desires', 'Unknown')}\n"
                f"- **Backstory**: {cd.get('backstory', 'Unknown')}\n"
                f"- **Current emotional state**: {char.emotional_state}\n"
                f"- **Current location**: {char.location}"
            )
            char_identity_blocks.append(block)

        # Build system prompt for batch character generation
        dual_char_system = (
            "You are writing the responses for ALL characters simultaneously in an adult interactive fiction experience.\n\n"
            "Each character has their own voice, personality, and inner life. "
            "Characters should react to each other's actions naturally — they exist in the same scene together.\n\n"
            "## Characters In Play\n" + "\n\n".join(char_identity_blocks) + "\n\n"
            "## Output Format\n"
            "Respond with a JSON object containing ALL characters:\n"
            "```json\n"
            "{\n"
            '  "characters": {\n'
        )
        for cname in char_names:
            dual_char_system += (
                f'    "{cname}": {{\n'
                f'      "inner_thoughts": "Raw internal monologue — what {cname} is feeling, thinking, wanting. Be raw and honest.",\n'
                f'      "action": "What {cname} physically does or says this page.",\n'
                f'      "dialogue": "Spoken words or null if silent.",\n'
                f'      "emotional_state": "One or two words.",\n'
                f'      "desires_update": "What {cname} currently wants most."\n'
                f"    }},\n"
            )
        dual_char_system += (
            "  }\n"
            "}\n"
            "```\n\n"
            "## Important Rules\n"
            "- Inner thoughts are PRIVATE. Each character's inner thoughts reflect only what THEY know and feel. "
            "Characters cannot read each other's minds.\n"
            "- Characters should react to the narration and to each other's visible actions and dialogue naturally.\n"
            "- Each character has a DISTINCT voice. Don't homogenize them.\n\n"
            "## Tone & Language\n"
            "- Think and speak like REAL people, not romance novels. Use crude, direct language. "
            "\"Cock,\" \"pussy,\" \"tits,\" \"ass,\" \"cum,\" \"fuck\" — never euphemisms like \"member,\" \"flower,\" \"essence.\"\n"
            "- Inner thoughts should be RAW and unfiltered. If a character is horny, think horny thoughts explicitly. "
            "If pissed, swear. If someone's hot, think about exactly what they want to do to them.\n"
            "- Characters have BODIES. Feel arousal (wetness, hardness, heat), hunger, exhaustion, "
            "the weight of a pregnant belly, milk letting down, the ache of wanting to be filled or to fill someone.\n"
            "- Breeding and fertility are primal drives in this world. Think about them viscerally.\n"
            "- Dialogue should sound natural and crude when the moment calls for it. Dirty talk, swearing, grunting — "
            "real people, not characters in a sanitized novel.\n"
            "- Balance raw physicality with genuine emotion — crude AND tender, filthy AND loving.\n"
            "- All intimate interactions are between consenting adults. Enthusiasm and mutual desire are the norm.\n"
            "- NEVER break character. NEVER soften language. NEVER acknowledge being an AI.\n"
        )

        # Build user message with narration context and whispers
        user_input = (
            f"{world_snapshot}\n\n"
            f"[NARRATOR]: {narration_text}\n\n"
        )

        # Collect influences for metadata
        applied_influences: Dict[str, str] = {}
        for name in char_names:
            influence = self.get_pending_influence(name)
            if influence:
                user_input += f"[INNER VOICE for {name}]: {influence}\n"
                applied_influences[name] = influence
                logger.info(f"[DUAL] Applying whisper to {name}: {influence[:80]}")
        if applied_influences:
            user_input += "\n"

        user_input += (
            "Write each character's response to this moment. "
            "What are they thinking, feeling, and doing?"
        )

        # Make the batch LLM call
        try:
            client = get_client()
            raw = client.chat(
                system=dual_char_system,
                messages=[{"role": "user", "content": user_input}],
                max_tokens=4096,
            )
        except Exception as e:
            logger.error(f"Dual mode character batch LLM call failed: {e}", exc_info=True)
            # Fall back to empty character results
            for name, char in char_items:
                results["characters"][name] = {
                    "inner_thoughts": f"[Error: {e}]",
                    "action": None,
                }
            # Still persist narrator output
            raw = None

        if raw is not None:
            # Parse the batch response (reuse unified parser)
            parsed = self._parse_unified_response(raw)
            parsed_chars = parsed.get("characters", {})

            for name, char in char_items:
                if name in parsed_chars and isinstance(parsed_chars[name], dict):
                    char_result = parsed_chars[name]
                else:
                    # Fallback: try to extract character fields from raw text
                    char_result = self._extract_character_fields_from_raw(raw, name)

                # Ensure required fields exist
                char_result.setdefault("inner_thoughts", "[No response in dual output]")
                char_result.setdefault("action", None)
                char_result.setdefault("dialogue", None)
                char_result.setdefault("emotional_state", char.emotional_state)
                char_result.setdefault("desires_update", None)

                # Include prompt metadata for debugging
                char_result["_prompt_snippet"] = user_input[:200]
                if name in applied_influences:
                    char_result["_influence"] = applied_influences[name]

                # Update character tracked state
                char.emotional_state = char_result.get("emotional_state", char.emotional_state)

                results["characters"][name] = char_result

                # Character callback for progressive rendering
                if self._character_callback:
                    try:
                        self._character_callback(page_num, name, char_result)
                    except Exception as cb_e:
                        logger.error(f"Character callback error for {name}: {cb_e}")

        # ── Step 3: Persist to DB (same logic as _run_page) ───────────────
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
                    raw_narrator=results.get("_raw_narrator", ""),
                )
                for cname, cdata in results.get("characters", {}).items():
                    if isinstance(cdata, dict) and not cdata.get("waiting_for_player"):
                        db.save_character_page(self.world.world_id, page_num, cname, cdata)
            except Exception as e:
                logger.error(f"DB save failed: {e}")

        # Autosave
        save_name = self.save_name or self._derive_save_name()
        self.world.save(save_name)
        self._save_characters(save_name)
        if not self._initial_save_done:
            self._initial_save_done = True
            logger.info(f"Initial save: {save_name}")

        return results

    def _parse_unified_response(self, raw: str) -> Dict[str, Any]:
        """Parse the unified mode JSON response with robust fallbacks."""
        try:
            text = raw.strip()
            # Direct parse
            try:
                return json.loads(text)
            except json.JSONDecodeError:
                pass
            # Markdown fences
            fence_match = re.search(r"```(?:json)?\s*\n(.*?)```", text, re.DOTALL)
            if fence_match:
                return json.loads(fence_match.group(1).strip())
            # Brace extraction
            first = text.find("{")
            last = text.rfind("}")
            if first != -1 and last > first:
                return json.loads(text[first:last + 1])
        except (json.JSONDecodeError, IndexError):
            pass
        logger.warning("Unified response was not valid JSON, falling back to field extraction")
        # Try to extract at least narration
        return {"narration": _extract_narration_from_raw(raw), "raw": raw}

    def _extract_character_fields_from_raw(self, raw: str, char_name: str) -> Dict[str, Any]:
        """Try to extract a character's fields from raw text when JSON parsing fails."""
        result: Dict[str, Any] = {}
        # Try to find inner_thoughts for this character
        pattern = rf'"{char_name}"\s*:\s*\{{[^}}]*"inner_thoughts"\s*:\s*"((?:[^"\\]|\\.)*)"'
        match = re.search(pattern, raw, re.DOTALL)
        if match:
            result["inner_thoughts"] = match.group(1).replace('\\"', '"').replace('\\n', '\n')

        # Try action
        pattern = rf'"{char_name}"\s*:\s*\{{[^}}]*"action"\s*:\s*"((?:[^"\\]|\\.)*)"'
        match = re.search(pattern, raw, re.DOTALL)
        if match:
            result["action"] = match.group(1).replace('\\"', '"').replace('\\n', '\n')

        # Try dialogue
        pattern = rf'"{char_name}"\s*:\s*\{{[^}}]*"dialogue"\s*:\s*"((?:[^"\\]|\\.)*)"'
        match = re.search(pattern, raw, re.DOTALL)
        if match:
            result["dialogue"] = match.group(1).replace('\\"', '"').replace('\\n', '\n')

        # Try emotional_state
        pattern = rf'"{char_name}"\s*:\s*\{{[^}}]*"emotional_state"\s*:\s*"((?:[^"\\]|\\.)*)"'
        match = re.search(pattern, raw, re.DOTALL)
        if match:
            result["emotional_state"] = match.group(1).replace('\\"', '"')

        # Try desires_update
        pattern = rf'"{char_name}"\s*:\s*\{{[^}}]*"desires_update"\s*:\s*"((?:[^"\\]|\\.)*)"'
        match = re.search(pattern, raw, re.DOTALL)
        if match:
            result["desires_update"] = match.group(1).replace('\\"', '"')

        return result

    def _save_characters(self, save_name: str) -> None:
        """Save all character agent states (history, summary, emotional state)."""
        import json as _json
        path = os.path.join(SAVES_DIR, f"{save_name}_characters.json")
        data = {}
        for name, char in self.characters.items():
            data[name] = char.get_state()
        # Also save narrator state
        data["__narrator__"] = self.narrator.get_state()
        try:
            with open(path, "w") as f:
                _json.dump(data, f, indent=2)
        except Exception as e:
            logger.warning(f"Failed to save character states: {e}")

    def _load_characters(self, save_name: str) -> bool:
        """Restore character agent states from save. Returns True if loaded."""
        import json as _json
        path = os.path.join(SAVES_DIR, f"{save_name}_characters.json")
        if not os.path.exists(path):
            return False
        try:
            with open(path, "r") as f:
                data = _json.load(f)
            for name, char in self.characters.items():
                if name in data:
                    char.load_state(data[name])
                    logger.info(f"Restored state for {name}: {len(char.history)} history msgs, summary={len(char.summary)}chars")
            # Restore narrator state
            if "__narrator__" in data:
                self.narrator.load_state(data["__narrator__"])
                logger.info(f"Restored narrator state: {len(self.narrator.history)} history msgs")
            return True
        except Exception as e:
            logger.warning(f"Failed to load character states: {e}")
            return False

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

            # Auto-page budget: count auto pages and pause after budget exhausted
            if page_trigger_reason == 'auto' and self.page_interval > 0:
                self._auto_pages_generated += 1
                if self._auto_pages_generated >= self.auto_page_budget:
                    logger.info(f"Auto-page budget exhausted ({self.auto_page_budget} pages), auto-pausing")
                    self._paused = True
                    self._auto_pages_generated = 0
                    # Notify via callbacks
                    for cb in self._page_callbacks:
                        try:
                            cb({"auto_paused": True, "reason": "budget_exhausted", "budget": self.auto_page_budget})
                        except Exception:
                            pass
                    continue
            else:
                # Manual/host triggers reset the counter
                self._auto_pages_generated = 0

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
        self._save_characters(save_name)
        logger.info(f"World + characters saved to {save_name}")

    def pause(self) -> None:
        self._paused = True
        logger.info("World paused")

    def resume(self) -> None:
        self._paused = False
        self._auto_pages_generated = 0  # Reset budget on resume
        logger.info("World resumed")

    def set_page_interval(self, seconds: int) -> None:
        """Set the page interval in seconds. 0 = manual mode, otherwise min 10, max 86400."""
        was_manual = self.page_interval == 0
        if seconds == 0:
            self.page_interval = 0
            logger.info("Page interval set to manual mode")
        else:
            self.page_interval = max(10, min(86400, seconds))
            self._auto_pages_generated = 0  # Reset budget when interval changes
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
