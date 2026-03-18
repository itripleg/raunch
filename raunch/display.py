"""Display utilities for the CLI — premium narration rendering with immersive effects."""

import sys
import time
import re
import math
import random
from typing import Dict, Any, Optional, List, Tuple, TYPE_CHECKING
from rich.console import Console
from rich.panel import Panel
from rich.text import Text
from rich.style import Style
from rich.box import HEAVY, ROUNDED, DOUBLE

console = Console()

# ═══════════════════════════════════════════════════════════════════════════════
# PREMIUM CLI NARRATION FEED — Immersive storytelling in the terminal
# ═══════════════════════════════════════════════════════════════════════════════

# ANSI 256-color helpers
def _c256(code: int) -> str:
    """Return ANSI escape for 256-color palette."""
    return f"\033[38;5;{code}m"

RESET = "\033[0m"
DIM = "\033[2m"
ITALIC = "\033[3m"
BOLD = "\033[1m"

# Intensity word categories (crude/hot/primal/warm)
INTENSITY_WORDS: Dict[str, str] = {
    # Primal/breeding (deep rose) - 204, 205, 211
    "breed": "primal", "breeding": "primal", "bred": "primal", "impregnate": "primal",
    "pregnant": "primal", "fertility": "primal", "fertile": "primal", "womb": "primal",
    "seed": "primal", "knocked": "primal", "belly": "primal", "swollen": "primal",
    # Hot/crude (warm amber) - 214, 220, 221
    "cock": "hot", "cunt": "hot", "pussy": "hot", "fuck": "hot", "fucking": "hot",
    "fucked": "hot", "cum": "hot", "cumming": "hot", "dick": "hot", "tits": "hot",
    "ass": "hot", "slut": "hot", "whore": "hot", "hole": "hot", "wet": "hot",
    "dripping": "hot", "throb": "hot", "throbbing": "hot", "ache": "hot", "aching": "hot",
    # Warm/sensual (soft coral) - 209, 215, 216
    "moan": "warm", "moaning": "warm", "gasp": "warm", "gasping": "warm",
    "shudder": "warm", "tremble": "warm", "trembling": "warm", "quiver": "warm",
    "pleasure": "warm", "desire": "warm", "need": "warm", "wanting": "warm",
    "desperate": "warm", "hunger": "warm", "hungry": "warm", "bury": "warm",
    "deep": "warm", "deeper": "warm", "tight": "warm", "spread": "warm",
}

INTENSITY_COLORS = {
    "primal": [204, 205, 211],  # Rose (matches frontend text-rose-400)
    "hot": [214, 220, 178],     # Amber (matches frontend text-amber-400)
    "warm": [215, 216, 222],    # Orange (matches frontend text-orange-300)
}

# Mood-based border styles (matches frontend MOOD_COLORS)
MOOD_STYLES_UNICODE = {
    "anticipation": ("deep_pink4", "✧"),       # rose-500
    "tension": ("dark_goldenrod", "⚡"),         # amber-500
    "passion": ("hot_pink", "♥"),               # pink-500
    "desire": ("indian_red", "❧"),              # red-400
    "tenderness": ("medium_purple", "♡"),       # violet-400
    "climax": ("deep_pink4", "✦"),              # rose-400
    "afterglow": ("dark_goldenrod", "✿"),       # amber-300
    "default": ("bright_blue", "·"),
}

MOOD_STYLES_ASCII = {
    "anticipation": ("deep_pink4", "*"),
    "tension": ("dark_goldenrod", "!"),
    "passion": ("hot_pink", "<3"),
    "desire": ("indian_red", "~"),
    "tenderness": ("medium_purple", "<3"),
    "climax": ("deep_pink4", "*"),
    "afterglow": ("dark_goldenrod", "*"),
    "default": ("bright_blue", "."),
}


def _get_mood_styles() -> Dict[str, Tuple[str, str]]:
    """Get mood styles based on unicode support."""
    return MOOD_STYLES_UNICODE if _supports_unicode() else MOOD_STYLES_ASCII

# Character colors for distinct dialogue (matches frontend CHARACTER_COLORS)
CHARACTER_STYLES = [
    "green3",           # emerald-400
    "medium_purple1",   # violet-400
    "dark_goldenrod",   # amber-400
    "dark_cyan",        # cyan-400
    "deep_pink4",       # rose-400
    "chartreuse3",      # lime-400
]

# Scene break decorators
SCENE_BREAKS = [
    "· · ·  ✧  · · ·",
    "─────  ❧  ─────",
    "╌╌╌  ♥  ╌╌╌",
    "·  ·  ·",
]

# Track character color assignments
_char_colors: Dict[str, str] = {}


def _get_char_color(name: str) -> str:
    """Get consistent color for a character."""
    if name not in _char_colors:
        idx = len(_char_colors) % len(CHARACTER_STYLES)
        _char_colors[name] = CHARACTER_STYLES[idx]
    return _char_colors[name]


def _extract_character_data(raw: str) -> Dict[str, Any]:
    """Extract character data from unparsed raw JSON response."""
    import json

    result = {}

    # Try to find and parse JSON
    try:
        text = raw.strip()

        # Remove markdown code blocks
        if "```json" in text:
            text = text.split("```json", 1)[1]
        if "```" in text:
            text = text.split("```", 1)[0]

        # Find JSON object
        first = text.find("{")
        last = text.rfind("}")
        if first != -1 and last != -1:
            json_str = text[first:last + 1]
            result = json.loads(json_str)
    except (json.JSONDecodeError, IndexError, ValueError):
        # If JSON parsing fails, try regex extraction
        import re

        # Extract inner_thoughts
        match = re.search(r'"inner_thoughts"\s*:\s*"([^"]*(?:\\.[^"]*)*)"', raw, re.DOTALL)
        if match:
            result["inner_thoughts"] = match.group(1).replace("\\n", "\n").replace('\\"', '"')

        # Extract action
        match = re.search(r'"action"\s*:\s*"([^"]*(?:\\.[^"]*)*)"', raw, re.DOTALL)
        if match:
            result["action"] = match.group(1).replace("\\n", "\n").replace('\\"', '"')

        # Extract dialogue
        match = re.search(r'"dialogue"\s*:\s*"([^"]*(?:\\.[^"]*)*)"', raw, re.DOTALL)
        if match:
            result["dialogue"] = match.group(1).replace("\\n", "\n").replace('\\"', '"')

        # Extract emotional_state
        match = re.search(r'"emotional_state"\s*:\s*"([^"]*)"', raw)
        if match:
            result["emotional_state"] = match.group(1)

    return result


def _supports_unicode() -> bool:
    """Check if terminal supports unicode."""
    try:
        "✧".encode(sys.stdout.encoding or "utf-8")
        return True
    except (UnicodeEncodeError, LookupError):
        return False


def _parse_intensity(text: str) -> List[Tuple[str, Optional[str]]]:
    """Parse text into segments with intensity markers."""
    pattern = r'\b(' + '|'.join(re.escape(w) for w in INTENSITY_WORDS.keys()) + r')\b'
    result = []
    last_end = 0

    for match in re.finditer(pattern, text, re.IGNORECASE):
        # Add text before match
        if match.start() > last_end:
            result.append((text[last_end:match.start()], None))
        # Add the intensity word
        word = match.group(0)
        level = INTENSITY_WORDS.get(word.lower())
        result.append((word, level))
        last_end = match.end()

    # Add remaining text
    if last_end < len(text):
        result.append((text[last_end:], None))

    return result if result else [(text, None)]


def _render_intensity_text(text: str, use_ansi: bool = True) -> str:
    """Render text with intensity word coloring using ANSI codes."""
    if not use_ansi:
        return text

    segments = _parse_intensity(text)
    result = []

    for content, level in segments:
        if level and level in INTENSITY_COLORS:
            color = random.choice(INTENSITY_COLORS[level])
            result.append(f"{_c256(color)}{content}{RESET}")
        else:
            result.append(content)

    return "".join(result)


def _typewriter(text: str, delay: float = 0.015, intensity: bool = True) -> None:
    """Print text with typewriter effect and optional intensity highlighting."""
    # Parse into words for natural pacing
    words = text.split(' ')

    for i, word in enumerate(words):
        # Check for intensity words
        word_lower = word.strip('.,!?;:"\'').lower()
        level = INTENSITY_WORDS.get(word_lower)

        if level and intensity:
            # Dramatic pause before intensity words
            time.sleep(0.08)
            color = random.choice(INTENSITY_COLORS[level])
            sys.stdout.write(f"{_c256(color)}{word}{RESET}")
            time.sleep(0.05)  # Extra pause after
        else:
            sys.stdout.write(word)

        # Add space (except for last word)
        if i < len(words) - 1:
            sys.stdout.write(' ')

        sys.stdout.flush()

        # Variable delay based on punctuation
        if word.endswith(('.', '!', '?')):
            time.sleep(delay * 4)
        elif word.endswith(','):
            time.sleep(delay * 2)
        else:
            time.sleep(delay)

    sys.stdout.write('\n')
    sys.stdout.flush()


def _dramatic_reveal(text: str, style: str = "bright_magenta") -> None:
    """Reveal text with a dramatic pause-based effect."""
    console.print()

    # Split into sentences for dramatic pacing
    sentences = re.split(r'(?<=[.!?])\s+', text)

    for i, sentence in enumerate(sentences):
        if not sentence.strip():
            continue

        # First sentence gets emphasis
        if i == 0:
            rich_text = Text()
            segments = _parse_intensity(sentence)
            for content, level in segments:
                if level == "primal":
                    rich_text.append(content, style="bold deep_pink4")
                elif level == "hot":
                    rich_text.append(content, style="bold dark_goldenrod")
                elif level == "warm":
                    rich_text.append(content, style="italic orange3")
                else:
                    rich_text.append(content)
            console.print(rich_text)
        else:
            # Subsequent sentences use Rich with intensity
            rich_text = Text()
            segments = _parse_intensity(sentence)
            for content, level in segments:
                if level == "primal":
                    rich_text.append(content, style="deep_pink4")
                elif level == "hot":
                    rich_text.append(content, style="dark_goldenrod")
                elif level == "warm":
                    rich_text.append(content, style="orange3")
                else:
                    rich_text.append(content, style="dim")
            console.print(rich_text)

        time.sleep(0.15)


def _scene_break(variant: int = 0) -> None:
    """Print a decorative scene break."""
    if _supports_unicode():
        pattern = SCENE_BREAKS[variant % len(SCENE_BREAKS)]
    else:
        pattern = "- - - * - - -"

    console.print()
    console.print(f"[dim]{pattern:^60}[/dim]")
    console.print()


def render_page(
    results: Dict[str, Any],
    attached_to: Optional[str] = None,
    typewriter: bool = True,
    quick: bool = False,
) -> None:
    """Render a full page's output with premium immersive effects."""
    page_num = results.get("page", "?")
    mood = results.get("mood", "default")

    # Get mood-based styling
    mood_styles = _get_mood_styles()
    border_style, mood_symbol = mood_styles.get(mood, mood_styles["default"])

    # Check if waiting for player
    if results.get("waiting_for_player"):
        star = "*" if not _supports_unicode() else "✦"
        console.print()
        console.print(
            Panel(
                f"[bold bright_yellow]Waiting for [bright_white]{results['character']}[/] to act...[/]\n\n"
                "[dim italic]Type your action and press Enter.[/]",
                title=f"[bold]{star} YOUR TURN {star}[/]",
                border_style="bright_yellow",
                box=HEAVY,
                padding=(1, 3),
            )
        )
        return

    # ─── NARRATION ─────────────────────────────────────────────────────────
    narration = results.get("narration", "")
    if narration:
        console.print()

        # Build rich text with intensity highlighting
        rich_narration = Text()
        segments = _parse_intensity(narration)

        for content, level in segments:
            if level == "primal":
                rich_narration.append(content, style="bold deep_pink4")
            elif level == "hot":
                rich_narration.append(content, style="dark_goldenrod")
            elif level == "warm":
                rich_narration.append(content, style="orange3")
            else:
                rich_narration.append(content)

        # Decorative title with mood symbol
        if _supports_unicode():
            title = f"[bold]{mood_symbol} PAGE {page_num} {mood_symbol}[/]"
        else:
            title = f"[bold]* PAGE {page_num} *[/]"

        console.print(
            Panel(
                rich_narration,
                title=title,
                subtitle=f"[dim italic]{mood}[/]",
                border_style=border_style,
                box=ROUNDED,
                padding=(1, 3),
            )
        )

    # ─── CHARACTERS ────────────────────────────────────────────────────────
    characters = results.get("characters", {})

    for name, data in characters.items():
        if not isinstance(data, dict):
            continue

        if data.get("waiting_for_player"):
            continue

        # Handle unparsed "raw" JSON responses
        if "raw" in data and "inner_thoughts" not in data:
            data = _extract_character_data(data.get("raw", ""))

        is_attached = (name == attached_to)
        char_color = _get_char_color(name)

        if is_attached:
            # ═══ ATTACHED CHARACTER — Full inner experience ═══
            inner = data.get("inner_thoughts", "")
            emotion = data.get("emotional_state", "")
            action = data.get("action", "")
            dialogue = data.get("dialogue", "")

            console.print()

            # Build inner thoughts with intensity
            rich_inner = Text()
            if inner:
                segments = _parse_intensity(inner)
                for content, level in segments:
                    if level == "primal":
                        rich_inner.append(content, style="italic bright_red")
                    elif level == "hot":
                        rich_inner.append(content, style="italic bright_yellow")
                    elif level == "warm":
                        rich_inner.append(content, style="italic bright_magenta")
                    else:
                        rich_inner.append(content, style="italic")

            # Compose the full panel content using Text object with styles
            panel_content = Text()

            if emotion:
                panel_content.append(f"~ {emotion} ~", style="dim italic")
                panel_content.append("\n\n")

            if inner:
                panel_content.append_text(rich_inner)
                panel_content.append("\n\n")

            if action:
                panel_content.append("Action: ", style="bold")
                panel_content.append(f"{action}\n")

            if dialogue and dialogue.lower() != "null":
                panel_content.append("Says: ", style="bold")
                panel_content.append(f'"{dialogue}"', style="green3 italic")

            heart = "<3" if not _supports_unicode() else "♥"
            title = f"[bold medium_purple1]{heart} {name} {heart}[/]"

            console.print(
                Panel(
                    panel_content,
                    title=title,
                    subtitle="[dim]attached[/]",
                    border_style="medium_purple1",
                    box=DOUBLE,
                    padding=(1, 3),
                )
            )
        else:
            # ═══ OTHER CHARACTERS — Only show spoken dialogue ═══
            dialogue = data.get("dialogue")
            action = data.get("action")

            # If no explicit dialogue, extract quoted speech from action
            if (not dialogue or dialogue.lower() == "null") and action:
                import re as _re
                match = _re.search(r'["\u201C\u201D\u2018\u2019\'"](.{2,}?)["\u201C\u201D\u2018\u2019\'"]', action)
                if match:
                    dialogue = match.group(1)

            if dialogue and dialogue.lower() != "null":
                dash = "-" if not _supports_unicode() else "—"
                console.print()
                console.print(
                    f"  [{char_color} bold]{name}[/] [dim]{dash}[/] "
                    f"[{char_color} italic]\"{dialogue}\"[/]"
                )

    # ─── EVENTS (after characters) ────────────────────────────────────────
    events = results.get("events", [])
    if events:
        event_lines = []
        for e in events:
            if _supports_unicode():
                event_lines.append(f"  [dim]✧[/] [italic]{e}[/]")
            else:
                event_lines.append(f"  [dim]*[/] [italic]{e}[/]")

        console.print()
        console.print(
            Panel(
                "\n".join(event_lines),
                title="[dim]events[/]",
                border_style="dim",
                box=ROUNDED,
                padding=(0, 2),
            )
        )


def render_narrator_panel(page_num: int, narration: str, mood: str = "default") -> None:
    """Render just the narrator panel (for progressive display)."""
    if not narration:
        return

    mood_styles = _get_mood_styles()
    border_style, mood_symbol = mood_styles.get(mood, mood_styles["default"])

    console.print()

    # Build rich text with intensity highlighting
    rich_narration = Text()
    segments = _parse_intensity(narration)

    for content, level in segments:
        if level == "primal":
            rich_narration.append(content, style="bold bright_red")
        elif level == "hot":
            rich_narration.append(content, style="bright_yellow")
        elif level == "warm":
            rich_narration.append(content, style="bright_magenta")
        else:
            rich_narration.append(content)

    if _supports_unicode():
        title = f"[bold]{mood_symbol} PAGE {page_num} {mood_symbol}[/]"
    else:
        title = f"[bold]* PAGE {page_num} *[/]"

    console.print(
        Panel(
            rich_narration,
            title=title,
            subtitle=f"[dim italic]{mood}[/]",
            border_style=border_style,
            box=ROUNDED,
            padding=(1, 3),
        )
    )


def render_character_panel_inline(
    name: str,
    data: Dict[str, Any],
    is_attached: bool = False
) -> None:
    """Render a single character's output (for progressive display)."""
    if not data:
        return

    char_color = _get_char_color(name)

    if is_attached:
        # Full inner experience for attached character
        inner = data.get("inner_thoughts", "")
        emotion = data.get("emotional_state", "")
        action = data.get("action", "")
        dialogue = data.get("dialogue", "")

        console.print()

        # Build inner thoughts with intensity
        rich_inner = Text()
        if inner:
            segments = _parse_intensity(inner)
            for content, level in segments:
                if level == "primal":
                    rich_inner.append(content, style="italic deep_pink4")
                elif level == "hot":
                    rich_inner.append(content, style="italic dark_goldenrod")
                elif level == "warm":
                    rich_inner.append(content, style="italic orange3")
                else:
                    rich_inner.append(content, style="italic")

        panel_content = Text()

        if emotion:
            panel_content.append(f"~ {emotion} ~", style="dim italic")
            panel_content.append("\n\n")

        if inner:
            panel_content.append_text(rich_inner)
            panel_content.append("\n\n")

        if action:
            panel_content.append("Action: ", style="bold")
            panel_content.append(f"{action}\n")

        if dialogue and dialogue.lower() != "null":
            panel_content.append("Says: ", style="bold")
            panel_content.append(f'"{dialogue}"', style="green3 italic")

        heart = "<3" if not _supports_unicode() else "♥"
        title = f"[bold medium_purple1]{heart} {name} {heart}[/]"

        console.print(
            Panel(
                panel_content,
                title=title,
                subtitle="[dim]attached[/]",
                border_style="medium_purple1",
                box=DOUBLE,
                padding=(1, 3),
            )
        )
    else:
        # Just dialogue for non-attached characters
        dialogue = data.get("dialogue")
        action = data.get("action")

        # If no explicit dialogue, extract quoted speech from action
        if (not dialogue or dialogue.lower() == "null") and action:
            import re as _re
            match = _re.search(r'["\u201C\u201D\u2018\u2019\'"](.{2,}?)["\u201C\u201D\u2018\u2019\'"]', action)
            if match:
                dialogue = match.group(1)

        if dialogue and dialogue.lower() != "null":
            dash = "-" if not _supports_unicode() else "—"
            console.print()
            console.print(
                f"  [{char_color} bold]{name}[/] [dim]{dash}[/] "
                f"[{char_color} italic]\"{dialogue}\"[/]"
            )


def render_events_panel(events: List[str]) -> None:
    """Render just the events panel (for progressive display)."""
    if not events:
        return

    event_lines = []
    for e in events:
        if _supports_unicode():
            event_lines.append(f"  [dim]✧[/] [italic]{e}[/]")
        else:
            event_lines.append(f"  [dim]*[/] [italic]{e}[/]")

    console.print()
    console.print(
        Panel(
            "\n".join(event_lines),
            title="[dim]events[/]",
            border_style="dim",
            box=ROUNDED,
            padding=(0, 2),
        )
    )


def render_page_streaming(
    source: str,
    text: str,
    page_num: int,
    is_narrator: bool = False,
) -> None:
    """Render streaming text updates in real-time."""
    if is_narrator:
        # Narrator streaming - show with intensity highlighting
        sys.stdout.write(f"\r\033[K")  # Clear line
        preview = text[-80:] if len(text) > 80 else text
        colored = _render_intensity_text(preview)
        sys.stdout.write(f"{DIM}[Page {page_num}]{RESET} {colored}")
        sys.stdout.flush()
    else:
        # Character streaming
        sys.stdout.write(f"\r\033[K")
        preview = text[-60:] if len(text) > 60 else text
        sys.stdout.write(f"{DIM}{source}:{RESET} {preview}")
        sys.stdout.flush()


def render_character_history(character_name: str, pages: List[Dict[str, Any]]) -> None:
    """Render a character's thought history beautifully."""
    if not pages:
        console.print(f"[dim]No history for {character_name}.[/dim]")
        return

    char_color = _get_char_color(character_name)
    heart = "<3" if not _supports_unicode() else "♥"
    divider = "-" * 40 if not _supports_unicode() else "─" * 40

    console.print()
    console.print(f"  [{char_color} bold]{heart} {character_name}'s Inner Journey {heart}[/]")
    console.print(f"  [dim]{divider}[/dim]")
    console.print()

    for i, p in enumerate(pages):
        page_num = p.get("page", "?")
        emotion = p.get("emotional_state", "")
        inner = p.get("inner_thoughts", "") or ""
        action = p.get("action", "") or ""
        dialogue = p.get("dialogue", "") or ""

        # Skip empty entries (refusals)
        if not inner and not action and not dialogue:
            continue

        # Page header
        console.print(f"  [bold bright_white]Page {page_num}[/]", end="")
        if emotion:
            console.print(f"  [dim italic]~ {emotion} ~[/]")
        else:
            console.print()

        # Inner thoughts - truncate but keep readable
        if inner:
            # Clean up and format
            inner_clean = inner.replace("\n", " ").strip()
            if len(inner_clean) > 200:
                inner_clean = inner_clean[:200] + "..."
            console.print(f"    [italic medium_purple1]{inner_clean}[/]")

        # Action - subtle
        if action:
            action_clean = action.replace("\n", " ").strip()
            if len(action_clean) > 100:
                action_clean = action_clean[:100] + "..."
            console.print(f"    [dim]{action_clean}[/]")

        # Dialogue - if present
        if dialogue and dialogue.lower() != "null":
            console.print(f"    [green3]\"{dialogue}\"[/]")

        # Separator between entries (except last)
        if i < len(pages) - 1:
            console.print()

    console.print()
    console.print(f"  [dim]Use 'r <page>' to replay any page in full.[/dim]")
    console.print()


def render_character_list(characters: Dict[str, Any], attached_to: Optional[str] = None) -> None:
    """Show a summary of all characters with style."""
    if not characters:
        console.print("[dim italic]No characters in the world yet...[/]")
        return

    heart = "<3" if not _supports_unicode() else "♥"
    console.print()
    for name, char in characters.items():
        char_color = _get_char_color(name)
        marker = f" [bright_magenta]({heart} attached)[/]" if name == attached_to else ""
        species = char.character_data.get("species", "?")
        emotion = char.emotional_state
        location = char.location

        console.print(
            f"  [{char_color} bold]{name}[/]{marker}\n"
            f"    [dim]{species} · feeling [italic]{emotion}[/] · at {location}[/]"
        )
    console.print()


def render_world_state(world_snapshot: str) -> None:
    """Display the current world state with atmosphere."""
    star = "*" if not _supports_unicode() else "✧"
    title = f"[bold]{star} World State {star}[/]"

    console.print(
        Panel(
            world_snapshot,
            title=title,
            border_style="bright_cyan",
            box=ROUNDED,
            padding=(1, 2),
        )
    )


def render_scene_intro(scenario_name: str, setting: str, mood: str = "anticipation") -> None:
    """Render a dramatic scene introduction."""
    mood_styles = _get_mood_styles()
    border_style, symbol = mood_styles.get(mood, mood_styles["default"])

    console.print()

    if _supports_unicode():
        header = f"{symbol}  {symbol}  {symbol}"
    else:
        header = "* * *"

    console.print(f"[{border_style}]{header:^60}[/]")
    console.print()
    console.print(f"[bold {border_style}]{scenario_name:^60}[/]")
    console.print()
    console.print(f"[dim italic]{setting[:80]:^60}[/]")
    console.print()
    console.print(f"[{border_style}]{header:^60}[/]")
    console.print()


def render_waiting_indicator(character: str) -> None:
    """Show an animated waiting indicator."""
    symbols = ["◐", "◓", "◑", "◒"] if _supports_unicode() else ["|", "/", "-", "\\"]

    for _ in range(8):
        for sym in symbols:
            sys.stdout.write(f"\r  [dim]{sym}[/] Waiting for {character}...")
            sys.stdout.flush()
            time.sleep(0.1)

    sys.stdout.write("\r\033[K")  # Clear line
    sys.stdout.flush()


# ═══════════════════════════════════════════════════════════════════════════════
# SERVER STARTUP ANIMATION
# ═══════════════════════════════════════════════════════════════════════════════

RAUNCH_LOGO = r"""
 ██████╗  █████╗ ██╗   ██╗███╗   ██╗ ██████╗██╗  ██╗
 ██╔══██╗██╔══██╗██║   ██║████╗  ██║██╔════╝██║  ██║
 ██████╔╝███████║██║   ██║██╔██╗ ██║██║     ███████║
 ██╔══██╗██╔══██║██║   ██║██║╚██╗██║██║     ██╔══██║
 ██║  ██║██║  ██║╚██████╔╝██║ ╚████║╚██████╗██║  ██║
 ╚═╝  ╚═╝╚═╝  ╚═╝ ╚═════╝ ╚═╝  ╚═══╝ ╚═════╝╚═╝  ╚═╝
"""

RAUNCH_LOGO_ASCII = r"""
 ____   _   _   _ _   _  ____ _   _
|  _ \ / \ | | | | \ | |/ ___| | | |
| |_) / _ \| | | |  \| | |   | |_| |
|  _ / ___ \ |_| | |\  | |___|  _  |
|_| \_\/_/ \_\___/|_| \_|\____|_| |_|
"""

# Gradient colors for logo (ANSI 256)
LOGO_GRADIENT = [199, 198, 197, 204, 205, 206, 212, 213, 219]


def _animate_logo_line(line: str, color_offset: int) -> str:
    """Apply gradient color to a logo line."""
    result = []
    for i, char in enumerate(line):
        if char not in ' \n':
            color_idx = (i + color_offset) % len(LOGO_GRADIENT)
            result.append(f"{_c256(LOGO_GRADIENT[color_idx])}{char}{RESET}")
        else:
            result.append(char)
    return "".join(result)


def _animate_motherhaven_tagline(animated: bool = True) -> None:
    """Animate the Motherhaven tagline under the logo.

    'a' and 'joint' stay dim, 'motherhaven' gets the spotlight.
    """
    prefix = "a "
    highlight = "motherhaven"
    suffix = " joint"
    full_tagline = prefix + highlight + suffix

    if not animated:
        console.print(f"[dim italic]{prefix}[/][bold bright_magenta]{highlight}[/][dim italic]{suffix}[/]")
        return

    # Animate: only 'motherhaven' gets revealed letter by letter
    sys.stdout.write("\033[?25l")  # Hide cursor

    try:
        # Center the tagline (logo is ~54 chars wide)
        padding = (54 - len(full_tagline)) // 2

        # Phase 1: Show static prefix, animate 'motherhaven' reveal
        for i in range(len(highlight) + 1):
            revealed = highlight[:i]
            sparkle = "✧" if _supports_unicode() and i < len(highlight) else ""
            # prefix dim, motherhaven bright, suffix hidden until done
            line = f"{' ' * padding}{DIM}{ITALIC}{prefix}{RESET}{_c256(213)}{BOLD}{revealed}{RESET}{sparkle}"
            sys.stdout.write(f"\r{line}")
            sys.stdout.flush()
            time.sleep(0.05)

        # Phase 2: Color pulse on 'motherhaven'
        for color in [213, 219, 225, 255, 231, 225, 219, 213]:
            line = f"{' ' * padding}{DIM}{ITALIC}{prefix}{RESET}{_c256(color)}{BOLD}{highlight}{RESET}"
            sys.stdout.write(f"\r{line}")
            sys.stdout.flush()
            time.sleep(0.04)

        # Phase 3: Fade in suffix
        line = f"{' ' * padding}{DIM}{ITALIC}{prefix}{RESET}{_c256(213)}{BOLD}{highlight}{RESET}{DIM}{ITALIC}{suffix}{RESET}"
        sys.stdout.write(f"\r{line}\n")
        sys.stdout.flush()

    finally:
        sys.stdout.write("\033[?25h")  # Show cursor


def render_server_startup(
    world_name: str,
    world_id: str,
    created_at: str,
    page_count: int,
    animated: bool = True,
) -> None:
    """Render an animated server startup banner."""
    logo = RAUNCH_LOGO if _supports_unicode() else RAUNCH_LOGO_ASCII
    lines = logo.strip().split('\n')

    # Extra spacing to prevent overlap with any previous output
    console.print()
    console.print()

    if animated:
        # Hide cursor during animation
        sys.stdout.write("\033[?25l")
        sys.stdout.flush()

        try:
            # Print logo lines first (creates the buffer for animation)
            for line in lines:
                sys.stdout.write(f"{line}\n")
            sys.stdout.flush()

            # Now animate with color cycling
            for frame in range(12):
                sys.stdout.write(f"\033[{len(lines)}A")  # Move up
                for i, line in enumerate(lines):
                    colored = _animate_logo_line(line, frame + i)
                    sys.stdout.write(f"\r{colored}\n")
                sys.stdout.flush()
                time.sleep(0.08)
        finally:
            sys.stdout.write("\033[?25h")
            sys.stdout.flush()
    else:
        # Static logo
        for line in lines:
            console.print(f"[bright_magenta]{line}[/]")

    # Motherhaven tagline animation
    _animate_motherhaven_tagline(animated)

    console.print()

    # Server info with style
    heart = "<3" if not _supports_unicode() else "♥"
    star = "*" if not _supports_unicode() else "✧"
    dash = "-" if not _supports_unicode() else "─"

    console.print(f"[dim]{dash * 60}[/]")
    console.print(f"  [bold bright_magenta]{heart} {world_name}[/] [dim][{world_id}][/]")
    console.print(f"  [dim]Created: {created_at} | Page: {page_count}[/]")
    console.print(f"[dim]{dash * 60}[/]")
    console.print()

    # Commands with sexy formatting
    bullet = "-" if not _supports_unicode() else "─"
    console.print(f"  [bold bright_cyan]{star} COMMANDS {star}[/]  [dim](type [bold]?[/bold] for full list)[/]")
    console.print()
    console.print(f"  [bold]n[/], [bold]next[/], [bold]Enter[/]    [dim]{bullet}[/]  Advance page")
    console.print(f"  [bold]c[/], [bold]characters[/]     [dim]{bullet}[/]  List characters")
    console.print(f"  [bold]w[/], [bold]world[/]          [dim]{bullet}[/]  World state")
    console.print(f"  [bold]p[/], [bold]pause[/]          [dim]{bullet}[/]  Pause/resume")
    console.print(f"  [bold]t[/], [bold]timer[/] [dim]<sec>[/]   [dim]{bullet}[/]  Set interval (0=manual)")
    console.print(f"  [bold]q[/], [bold]quit[/]           [dim]{bullet}[/]  Save & exit")
    console.print()
    console.print(f"[dim]{dash * 60}[/]")
    console.print()


# ═══════════════════════════════════════════════════════════════════════════════
# ATTACH CHARACTER ANIMATION - Dramatic neural link establishment
# ═══════════════════════════════════════════════════════════════════════════════

# Gradient for character name reveal (magenta → pink → white)
ATTACH_GRADIENT = [129, 135, 141, 177, 183, 189, 225, 231, 255]

# Thematic connection messages
NEURAL_LINK_MESSAGES = [
    "Establishing neural link",
    "Synchronizing consciousness",
    "Binding to thought stream",
    "Merging perspectives",
    "Attuning to desires",
    "Opening mind's eye",
    "Connecting hearts",
    "Linking souls",
]


def render_attach_animation(character_name: str, animated: bool = True) -> None:
    """Render a dramatic animation when attaching to a character.

    This creates a cinematic "neural link establishing" effect with
    the character's name revealed letter by letter.
    """
    if not animated:
        # Static fallback
        heart = "<3" if not _supports_unicode() else "♥"
        console.print()
        console.print(f"  [bold bright_magenta]{heart} Attached to {character_name} {heart}[/]")
        console.print()
        return

    console.print()

    # Hide cursor during animation
    sys.stdout.write("\033[?25l")
    sys.stdout.flush()

    try:
        # Phase 1: "Establishing neural link" with pulsing dots
        link_msg = random.choice(NEURAL_LINK_MESSAGES)
        spinner = SPINNER_CHARS if _supports_unicode() else ["|", "/", "-", "\\"]

        for frame in range(24):
            dots = "." * ((frame % 4) + 1)
            spaces = " " * (3 - (frame % 4))
            spin = spinner[frame % len(spinner)]

            # Color pulse
            color_idx = frame % len(ATTACH_GRADIENT)
            color = ATTACH_GRADIENT[color_idx]

            line = f"\r  {_c256(color)}{spin}{RESET} {link_msg}{dots}{spaces}"
            sys.stdout.write(line)
            sys.stdout.flush()
            time.sleep(0.08)

        sys.stdout.write("\r\033[K")  # Clear line

        # Phase 2: Build dramatic frame
        name_len = len(character_name)
        box_width = max(name_len + 8, 30)

        if _supports_unicode():
            top_left, top_right = "╔", "╗"
            bot_left, bot_right = "╚", "╝"
            horiz, vert = "═", "║"
            heart = "♥"
            star = "✧"
        else:
            top_left, top_right = "+", "+"
            bot_left, bot_right = "+", "+"
            horiz, vert = "=", "|"
            heart = "<3"
            star = "*"

        # Animate the box appearing
        center_pad = (box_width - 4) // 2

        # Top border slides in
        for i in range(box_width + 1):
            border = horiz * min(i, box_width - 2)
            padding = " " * (box_width - 2 - len(border))
            line = f"\r  {_c256(213)}{top_left}{border}{padding}{top_right if i >= box_width - 1 else ''}{RESET}"
            sys.stdout.write(line)
            sys.stdout.flush()
            time.sleep(0.015)

        sys.stdout.write("\n")

        # Middle section with hearts
        heart_line = f"{vert}  {heart}  "
        heart_line += " " * (box_width - 10)
        heart_line += f"  {heart}  {vert}"
        sys.stdout.write(f"  {_c256(205)}{heart_line}{RESET}\n")

        # Character name reveal - letter by letter with gradient
        name_padding = (box_width - 4 - name_len) // 2
        sys.stdout.write(f"  {_c256(205)}{vert}{RESET}")
        sys.stdout.write(" " * (name_padding + 1))

        for i, char in enumerate(character_name):
            # Cycle through gradient colors
            color_idx = i % len(ATTACH_GRADIENT)
            color = ATTACH_GRADIENT[color_idx]
            sys.stdout.write(f"{_c256(color)}{BOLD}{char}{RESET}")
            sys.stdout.flush()
            time.sleep(0.06)  # Dramatic reveal timing

        remaining_pad = box_width - 4 - name_len - name_padding
        sys.stdout.write(" " * remaining_pad)
        sys.stdout.write(f"  {_c256(205)}{vert}{RESET}\n")

        # Another heart line
        sys.stdout.write(f"  {_c256(205)}{heart_line}{RESET}\n")

        # Bottom border slides in
        sys.stdout.write(f"  {_c256(213)}{bot_left}")
        for i in range(box_width - 2):
            sys.stdout.write(horiz)
            sys.stdout.flush()
            time.sleep(0.01)
        sys.stdout.write(f"{bot_right}{RESET}\n")

        # Phase 3: Final flourish - stars burst out
        time.sleep(0.1)

        flourish_line = f"  {star}  NEURAL LINK ESTABLISHED  {star}"

        # Type out the flourish with color wave
        sys.stdout.write("\r  ")
        for i, char in enumerate(flourish_line.strip()):
            if char == star:
                sys.stdout.write(f"{_c256(226)}{char}{RESET}")
            elif char.isupper():
                color = ATTACH_GRADIENT[(i * 2) % len(ATTACH_GRADIENT)]
                sys.stdout.write(f"{_c256(color)}{char}{RESET}")
            else:
                sys.stdout.write(f"{DIM}{char}{RESET}")
            sys.stdout.flush()
            time.sleep(0.02)

        sys.stdout.write("\n\n")

    finally:
        # Show cursor again
        sys.stdout.write("\033[?25h")
        sys.stdout.flush()


def render_detach_animation(character_name: str, animated: bool = True) -> None:
    """Render animation when detaching from a character."""
    if not animated:
        console.print(f"  [dim]Detached from {character_name}[/]")
        return

    console.print()
    sys.stdout.write("\033[?25l")  # Hide cursor

    try:
        # Quick fade out effect
        if _supports_unicode():
            star = "✧"
            ellipsis = "..."
        else:
            star = "*"
            ellipsis = "..."

        # Name fades character by character
        for i in range(len(character_name), -1, -1):
            visible = character_name[:i]
            faded = "·" * (len(character_name) - i) if _supports_unicode() else "." * (len(character_name) - i)
            line = f"\r  {_c256(241)}{star} {visible}{faded} {star}{RESET}   "
            sys.stdout.write(line)
            sys.stdout.flush()
            time.sleep(0.04)

        sys.stdout.write(f"\r  {DIM}Neural link severed{RESET}           \n")

    finally:
        sys.stdout.write("\033[?25h")  # Show cursor
        sys.stdout.flush()

    console.print()


# ═══════════════════════════════════════════════════════════════════════════════
# PAGE LOADING ANIMATION - The star of the show!
# ═══════════════════════════════════════════════════════════════════════════════

# Sexy loading messages
CONJURING_MESSAGES = [
    "Weaving destinies...",
    "Conjuring desires...",
    "The fates are stirring...",
    "Summoning passion...",
    "Threads of fate entwine...",
    "The scene unfolds...",
    "Characters respond...",
    "Desire takes shape...",
    "Tension builds...",
    "The story breathes...",
    "Whispers in the dark...",
    "Hearts quicken...",
    "The world shifts...",
    "Secrets emerge...",
    "Anticipation grows...",
]

# Animation frames for the loading bar
PULSE_CHARS = ["░", "▒", "▓", "█", "▓", "▒", "░", " "] if _supports_unicode() else [".", "o", "O", "@", "O", "o", ".", " "]
SPINNER_CHARS = ["◐", "◓", "◑", "◒"] if _supports_unicode() else ["|", "/", "-", "\\"]


class PageLoadingAnimation:
    """Manages the page loading animation state."""

    def __init__(self):
        self.running = False
        self.frame = 0
        self.message_idx = 0
        self.start_time = 0

    def start(self, page_num: int) -> None:
        """Start the loading animation for a page."""
        self.running = True
        self.frame = 0
        self.message_idx = random.randint(0, len(CONJURING_MESSAGES) - 1)
        self.start_time = time.time()
        self.page_num = page_num

        # Hide cursor
        sys.stdout.write("\033[?25l")
        sys.stdout.flush()

    def update(self) -> None:
        """Update one frame of the animation."""
        if not self.running:
            return

        self.frame += 1

        # Change message every ~20 frames
        if self.frame % 20 == 0:
            self.message_idx = (self.message_idx + 1) % len(CONJURING_MESSAGES)

        message = CONJURING_MESSAGES[self.message_idx]
        elapsed = time.time() - self.start_time

        # Build the animated bar
        bar_width = 24
        pulse_offset = self.frame % len(PULSE_CHARS)

        bar = ""
        for i in range(bar_width):
            char_idx = (i + self.frame) % len(PULSE_CHARS)
            # Create a wave effect
            wave = math.sin((i + self.frame * 0.3) * 0.5) * 0.5 + 0.5
            if wave > 0.7:
                bar += PULSE_CHARS[min(char_idx, 3)]
            elif wave > 0.4:
                bar += PULSE_CHARS[min(char_idx + 2, len(PULSE_CHARS) - 1)]
            else:
                bar += " "

        # Spinner
        spinner = SPINNER_CHARS[self.frame % len(SPINNER_CHARS)]

        # Color the output
        heart = "<3" if not _supports_unicode() else "♥"
        star = "*" if not _supports_unicode() else "✧"

        # Build the line
        line = f"\r  {_c256(205)}{spinner}{RESET} {_c256(213)}{star}{RESET} "
        line += f"{_c256(219)}PAGE {self.page_num}{RESET} "
        line += f"{_c256(213)}{star}{RESET} "
        line += f"{DIM}[{bar}]{RESET} "
        line += f"{_c256(183)}{message:<24}{RESET} "
        line += f"{DIM}({elapsed:.1f}s){RESET}"

        # Pad to clear previous content
        sys.stdout.write(line + " " * 10)
        sys.stdout.flush()

    def stop(self) -> None:
        """Stop the animation and show completion."""
        self.running = False

        # Show cursor
        sys.stdout.write("\033[?25h")
        sys.stdout.flush()

        # Clear the line and show completion
        elapsed = time.time() - self.start_time
        heart = "<3" if not _supports_unicode() else "♥"
        check = "+" if not _supports_unicode() else "✓"

        sys.stdout.write(f"\r  {_c256(46)}{check}{RESET} ")
        sys.stdout.write(f"{_c256(213)}{heart}{RESET} ")
        sys.stdout.write(f"Page {self.page_num} complete ")
        sys.stdout.write(f"{DIM}({elapsed:.1f}s){RESET}")
        sys.stdout.write(" " * 40 + "\n")
        sys.stdout.flush()


# Global loading animation instance
_page_animation = PageLoadingAnimation()


def start_page_loading(page_num: int) -> None:
    """Start the page loading animation."""
    _page_animation.start(page_num)


def update_page_loading() -> None:
    """Update the page loading animation (call in a loop)."""
    _page_animation.update()


def stop_page_loading() -> None:
    """Stop the page loading animation."""
    _page_animation.stop()


def render_advancing_message(page_num: int) -> None:
    """Simple one-shot advancing message (non-animated fallback)."""
    heart = "<3" if not _supports_unicode() else "♥"
    console.print(f"\n  [bright_magenta]{heart}[/] [dim]Advancing to page {page_num}...[/]")


# ═══════════════════════════════════════════════════════════════════════════════
# PORT & SERVER DETECTION
# ═══════════════════════════════════════════════════════════════════════════════

def check_port_available(port: int) -> bool:
    """Check if a port is available."""
    import socket
    try:
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
            s.settimeout(1)
            s.bind(('127.0.0.1', port))
            return True
    except OSError:
        return False


def check_raunch_server_running(tcp_port: int = 7666) -> Optional[Dict[str, Any]]:
    """Check if a raunch server is already running by testing the TCP endpoint.

    Returns server info dict if running, None otherwise.
    """
    import socket
    import json

    try:
        sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        sock.settimeout(2)
        sock.connect(('127.0.0.1', tcp_port))

        # Read the welcome message
        buf = ""
        while "\n" not in buf:
            data = sock.recv(4096)
            if not data:
                sock.close()
                return None
            buf += data.decode("utf-8")

        line = buf.split("\n", 1)[0]
        msg = json.loads(line.strip())
        sock.close()

        if msg.get("type") == "welcome":
            return {
                "world": msg.get("world", {}),
                "characters": msg.get("characters", []),
            }
        return None
    except (OSError, json.JSONDecodeError, socket.timeout):
        return None


def render_server_already_running(server_info: Dict[str, Any], requested_scenario: Optional[str] = None) -> None:
    """Render message when server is already running."""
    world = server_info.get("world", {})
    chars = server_info.get("characters", [])
    current_name = world.get('world_name', 'Unknown')

    heart = "<3" if not _supports_unicode() else "♥"
    check = "+" if not _supports_unicode() else "✓"
    warn = "!" if not _supports_unicode() else "⚠"

    console.print()

    # Different message if trying to start a different scenario
    if requested_scenario and requested_scenario.lower().replace("_", " ") != current_name.lower().replace("_", " "):
        console.print(
            Panel(
                f"[bold bright_yellow]{warn} A different server is already running![/]\n\n"
                f"[dim]Currently running:[/] [bold]{current_name}[/]\n"
                f"[dim]You requested:[/] [bold]{requested_scenario}[/]\n\n"
                f"[bold]To switch scenarios:[/]\n"
                f"  Stop the current server [dim](Ctrl+C in its terminal)[/]\n"
                f"  Then run: [bold]raunch start --scenario {requested_scenario}[/]",
                title=f"[bold bright_yellow]{warn} Server Conflict {warn}[/]",
                border_style="bright_yellow",
                padding=(1, 2),
            )
        )
    else:
        # Same scenario or no scenario specified - just show status
        console.print(
            Panel(
                f"[bold bright_green]{check} Server already running![/]\n\n"
                f"[bold]{current_name}[/] [{world.get('world_id', '?')}]\n"
                f"Page: {world.get('page_count', '?')} | Mood: {world.get('mood', '?')}\n"
                f"Characters: {', '.join(chars) if chars else 'None yet'}\n\n"
                f"[dim]To connect:[/]\n"
                f"  [bold]raunch attach[/]  {heart} Join as a character\n"
                f"  [bold]raunch status[/]  {heart} Check server status\n\n"
                f"[dim]To start fresh, stop the current server first (Ctrl+C in its terminal)[/]",
                title=f"[bold bright_green]{heart} RAUNCH {heart}[/]",
                border_style="bright_green",
                padding=(1, 2),
            )
        )

    console.print()


def render_port_conflict(port: int, service: str) -> None:
    """Render error when port is used by something OTHER than raunch."""
    console.print()
    console.print(
        Panel(
            f"[bold bright_yellow]Port {port} is blocked![/]\n\n"
            f"The {service} can't start because something else\n"
            f"(not a raunch server) is using port {port}.\n\n"
            "[bold]To fix:[/]\n"
            "  [dim]1.[/] Find what's using the port:\n"
            f"      [bold]netstat -ano | findstr {port}[/]\n"
            "  [dim]2.[/] Kill the process or wait for it to release",
            title="[bold bright_red]Port Conflict[/]",
            border_style="bright_red",
            padding=(1, 2),
        )
    )
    console.print()


def render_port_error(port: int, service: str) -> None:
    """Legacy function - redirects to render_port_conflict."""
    render_port_conflict(port, service)


# ═══════════════════════════════════════════════════════════════════════════════
# DEMO / PREVIEW
# ═══════════════════════════════════════════════════════════════════════════════

def demo() -> None:
    """Demo the premium display features."""
    sep = "===" if not _supports_unicode() else "═══"
    console.print(f"\n[bold bright_magenta]{sep} PREMIUM CLI NARRATION DEMO {sep}[/]\n")

    # Sample page data
    sample_page = {
        "page": 1,
        "mood": "passion",
        "narration": (
            "The air crackles with tension as eyes meet across the dimly lit chamber. "
            "She feels her breath quicken, desire pooling low in her belly. "
            "His gaze is hungry, predatory - and she finds herself trembling with need. "
            "\"Come here,\" he growls, and her body obeys before her mind can catch up."
        ),
        "events": ["First encounter", "Tension rises", "Chemistry ignites"],
        "characters": {
            "Lyra": {
                "emotional_state": "desperate longing mixed with anticipation",
                "inner_thoughts": (
                    "Gods, the way he looks at me... I can feel myself getting wet just from his gaze. "
                    "Every instinct screams to submit, to let him breed me right here on this altar. "
                    "I've never wanted anyone this badly."
                ),
                "action": "Steps closer, chin lifted in defiance even as her thighs press together",
                "dialogue": "Make me.",
            },
            "Kael": {
                "dialogue": "You'll regret that challenge.",
            },
        },
    }

    # Render with attached character
    render_page(sample_page, attached_to="Lyra")

    dash = "---" if not _supports_unicode() else "───"
    console.print(f"\n[dim]{dash} Scene break {dash}[/]\n")
    _scene_break(0)

    sep_end = "===" if not _supports_unicode() else "═══"
    console.print(f"[bold bright_magenta]{sep_end} END DEMO {sep_end}[/]\n")


if __name__ == "__main__":
    demo()
