"""Smut Wizard — dynamically generate scenarios, characters, and kinks."""

import json
import logging
import os
import random
from typing import Dict, Any, List, Optional

from .llm import get_client
from .config import SCENARIOS_DIR

logger = logging.getLogger(__name__)

import re


def _repair_json(text: str) -> str:
    """Escape unescaped control characters inside JSON string values.

    Small models often emit literal newlines/tabs inside strings, which is
    invalid JSON. Walk char-by-char and fix them.
    """
    result = []
    in_string = False
    escape_next = False
    for ch in text:
        if escape_next:
            result.append(ch)
            escape_next = False
        elif ch == "\\" and in_string:
            result.append(ch)
            escape_next = True
        elif ch == '"':
            in_string = not in_string
            result.append(ch)
        elif in_string and ch == "\n":
            result.append("\\n")
        elif in_string and ch == "\r":
            result.append("\\r")
        elif in_string and ch == "\t":
            result.append("\\t")
        else:
            result.append(ch)
    return "".join(result)


def _parse_json_response(raw: str) -> Dict[str, Any]:
    """Extract JSON from an LLM response, handling various wrapping formats."""
    text = raw.strip()

    # Pre-strip markdown code fences so all subsequent attempts work on clean text
    # Handles both ```json\n...\n``` and ```\n...\n``` (with or without closing fence)
    text = re.sub(r"^```(?:json)?\s*\n?", "", text)
    text = re.sub(r"\n?```\s*$", "", text)
    text = text.strip()

    # Try direct parse
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        pass

    # Try after repairing unescaped control characters (common with small models)
    try:
        return json.loads(_repair_json(text))
    except json.JSONDecodeError:
        pass

    # Find the first { and last } — handles extra prose before/after the JSON
    first_brace = text.find("{")
    last_brace = text.rfind("}")
    if first_brace != -1 and last_brace > first_brace:
        try:
            return json.loads(_repair_json(text[first_brace:last_brace + 1]))
        except json.JSONDecodeError:
            pass

    # Nothing worked
    logger.error(f"Could not parse JSON from response: {text[:200]}...")
    raise ValueError(f"LLM response was not valid JSON. Raw response starts with: {text[:100]}...")

WIZARD_PROMPT = """\
You are the Smut Wizard — a depraved creative genius who generates adult interactive fiction scenarios.

Given the user's preferences, generate a complete scenario package. Be creative, filthy, and specific.
Don't be generic — make characters feel like real people with flaws, quirks, and genuine desires.

## Rules
- All characters are consenting adults
- Be crude and specific — no flowery euphemisms
- Characters should have genuine tension and chemistry, not just be horny cardboard cutouts
- Make the scenario have actual stakes and story hooks beyond just sex
- Each character needs a distinct voice and personality

## Output Format
Respond with ONLY a JSON object (no markdown, no commentary):
{
  "scenario_name": "A short evocative title",
  "setting": "Detailed description of the location/world (2-3 sentences)",
  "premise": "What's happening and why these characters are together (2-3 sentences)",
  "themes": ["list", "of", "active", "themes"],
  "opening_situation": "The specific scene the narrator should open with (2-3 sentences, set up tension)",
  "characters": [
    {
      "name": "Full Name",
      "species": "Species/race",
      "personality": "2-3 sentence personality with specific quirks and flaws",
      "appearance": "Vivid physical description, be specific about body type and features",
      "desires": "What they want — both sexually and emotionally. Be explicit.",
      "backstory": "2-3 sentences. Why are they here? What baggage do they carry?",
      "kinks": "Their specific sexual preferences, turn-ons, fantasies"
    }
  ]
}
"""

# Flavor pools for random generation
SETTINGS = [
    "wizard's tower", "cyberpunk nightclub", "haunted mansion", "pirate ship",
    "fae court", "underground fighting ring", "space station", "Victorian manor",
    "royal court intrigue", "dragon's lair", "hotel & hot springs", "colony ship",
    "desert oasis", "gladiator arena", "dream realm", "exclusive club",
    "enchanted forest ritual", "frontier saloon", "submarine depths", "penthouse party",
    "alien first contact", "magical academy after dark", "art gallery opening",
]

PAIRINGS = [
    "bi exploration", "lesbian/sapphic", "anonymous/masked", "throuple",
    "gay/mlm", "nonbinary character(s)", "straight", "cuckold/cuckquean",
    "group/orgy", "trans-inclusive", "solo with toys", "androgynous",
]

KINK_POOLS = [
    "bondage/restraint", "enemies to lovers", "telepathic bond", "size difference",
    "breeding", "caught in the act", "monster/alien", "mind control",
    "dom/sub", "strangers with chemistry", "body worship", "public/semi-public",
    "transformation", "praise kink", "rough/primal", "friends to lovers",
    "corruption/temptation", "pet play", "sensation play", "marking/claiming",
    "oral fixation", "forbidden attraction", "degradation", "magic-enhanced sensation",
    "service/devotion", "first time", "voyeurism/exhibition", "breath play",
    "aphrodisiac/heat", "reunion/exes",
]

VIBES = [
    "mysterious and seductive", "desperate and needy", "playful and fun",
    "dark and intense", "possessive", "slow burn tension", "chaotic and wild",
    "emotionally charged", "reluctant/dubcon", "competitive", "sweet and tender",
    "worshipful/reverent", "primal and animalistic", "humorous/lighthearted",
    "immediate filth",
]


def generate_scenario(
    preferences: Optional[str] = None,
    num_characters: int = 3,
    pairings: Optional[List[str]] = None,
    kinks: Optional[List[str]] = None,
    setting_hint: Optional[str] = None,
    vibe: Optional[str] = None,
    debug: bool = False,
) -> Dict[str, Any]:
    """Use Claude to generate a complete scenario.

    Args:
        debug: If True, print the outgoing prompt before sending.
               Also prints on failure for troubleshooting content blocks.
    """
    client = get_client()

    parts = [f"Generate a scenario with {num_characters} characters."]

    if setting_hint:
        parts.append(f"Setting: {setting_hint}")
    if pairings:
        parts.append(f"Pairing types: {', '.join(pairings)}")
    if kinks:
        parts.append(f"Must include these kinks/themes: {', '.join(kinks)}")
    if vibe:
        parts.append(f"Vibe/tone: {vibe}")
    if preferences:
        parts.append(f"Additional preferences: {preferences}")

    user_msg = "\n".join(parts)

    # Debug output - show what we're sending
    if debug:
        print("\n" + "=" * 60)
        print("DEBUG: OUTGOING PROMPT")
        print("=" * 60)
        print("\n[SYSTEM PROMPT]")
        print("-" * 40)
        print(WIZARD_PROMPT)
        print("-" * 40)
        print("\n[USER MESSAGE]")
        print("-" * 40)
        print(user_msg)
        print("-" * 40)
        print("=" * 60 + "\n")

    try:
        raw = client.chat(
            system=WIZARD_PROMPT,
            messages=[{"role": "user", "content": user_msg}],
            max_tokens=4096,
            temperature=1.0,
        )
    except Exception as e:
        # On failure (content block, etc), always show the prompt for debugging
        print("\n" + "!" * 60)
        print("GENERATION FAILED - DUMPING PROMPT FOR DEBUG")
        print("!" * 60)
        print(f"\nError: {e}")
        print("\n[SYSTEM PROMPT]")
        print("-" * 40)
        print(WIZARD_PROMPT)
        print("-" * 40)
        print("\n[USER MESSAGE]")
        print("-" * 40)
        print(user_msg)
        print("-" * 40)
        print("!" * 60 + "\n")
        raise

    # Debug output - show response
    if debug:
        print("\n" + "=" * 60)
        print("DEBUG: RAW RESPONSE")
        print("=" * 60)
        print(raw[:500] + "..." if len(raw) > 500 else raw)
        print("=" * 60 + "\n")

    return _parse_json_response(raw)


def random_scenario(num_characters: int = 3, debug: bool = False) -> Dict[str, Any]:
    """Generate a fully random scenario.

    Args:
        debug: If True, print the outgoing prompt for troubleshooting.
    """
    setting = random.choice(SETTINGS)
    kinks = random.sample(KINK_POOLS, k=random.randint(2, 4))
    vibe = random.choice(VIBES)

    if debug:
        print(f"\n[RANDOM SELECTION]")
        print(f"  Setting: {setting}")
        print(f"  Kinks: {kinks}")
        print(f"  Vibe: {vibe}\n")

    return generate_scenario(
        num_characters=num_characters,
        setting_hint=setting,
        kinks=kinks,
        vibe=vibe,
        debug=debug,
    )


def save_scenario(scenario: Dict[str, Any]) -> str:
    """Save a scenario to disk. Returns the file path."""
    name = scenario.get("scenario_name", "untitled")
    slug = name.lower().replace(" ", "_").replace("'", "")[:40]
    path = os.path.join(SCENARIOS_DIR, f"{slug}.json")

    # Avoid overwriting
    i = 1
    while os.path.exists(path):
        path = os.path.join(SCENARIOS_DIR, f"{slug}_{i}.json")
        i += 1

    with open(path, "w") as f:
        json.dump(scenario, f, indent=2)

    return path


def delete_scenario(name: str) -> bool:
    """Delete a scenario file. Returns True if deleted, False if not found."""
    # Try exact match first
    path = os.path.join(SCENARIOS_DIR, name)
    if not path.endswith(".json"):
        path += ".json"

    if os.path.exists(path):
        os.remove(path)
        return True

    # Try fuzzy match
    for fname in os.listdir(SCENARIOS_DIR):
        if fname.endswith(".json") and name.lower() in fname.lower():
            os.remove(os.path.join(SCENARIOS_DIR, fname))
            return True

    return False


def load_scenario(name: str) -> Optional[Dict[str, Any]]:
    """Load a scenario by name, filename, or database ID."""
    # Try exact filename
    path = os.path.join(SCENARIOS_DIR, name)
    if not path.endswith(".json"):
        path += ".json"
    if os.path.exists(path):
        with open(path) as f:
            return json.load(f)

    # Try matching by slug
    for fname in os.listdir(SCENARIOS_DIR):
        if fname.endswith(".json") and name.lower() in fname.lower():
            with open(os.path.join(SCENARIOS_DIR, fname)) as f:
                return json.load(f)

    # Try database lookup by ID
    from . import db
    scenario = db.get_scenario(name)
    if scenario and scenario.get("data"):
        return scenario["data"]

    # Try database lookup by name
    scenario = db.get_scenario_by_name(name)
    if scenario and scenario.get("data"):
        return scenario["data"]

    return None


def list_scenarios() -> List[Dict[str, Any]]:
    """List all saved scenarios with summary info (files + database)."""
    results = []

    # Load file-based scenarios
    try:
        for fname in sorted(os.listdir(SCENARIOS_DIR)):
            if not fname.endswith(".json"):
                continue
            path = os.path.join(SCENARIOS_DIR, fname)
            try:
                with open(path) as f:
                    data = json.load(f)
                results.append({
                    "file": fname,
                    "name": data.get("scenario_name", "?"),
                    "setting": (data.get("setting", "")[:80] + "...") if len(data.get("setting", "")) > 80 else data.get("setting", ""),
                    "characters": len(data.get("characters", [])),
                    "themes": data.get("themes", []),
                    "source": "file",
                })
            except (json.JSONDecodeError, KeyError):
                continue
    except FileNotFoundError:
        # scenarios directory doesn't exist (e.g., on Render)
        pass

    # Load public database scenarios
    try:
        from . import db
        db_scenarios = db.list_public_scenarios()
        for s in db_scenarios:
            data = s.get("data", {})
            results.append({
                "id": s["id"],
                "name": s.get("name", data.get("scenario_name", "?")),
                "setting": (s.get("setting", "")[:80] + "...") if len(s.get("setting", "") or "") > 80 else s.get("setting", ""),
                "characters": len(data.get("characters", [])),
                "themes": data.get("themes", []),
                "source": "db",
                "public": s.get("public", True),
                "owner_id": s.get("owner_id"),
            })
    except Exception:
        # DB not available
        pass

    return results
