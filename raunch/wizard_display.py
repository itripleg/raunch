"""Smut Wizard Display — Premium animated experience for scenario generation."""

import random
import time
import sys
import os
import math
from typing import List, Optional, Dict, Any

from rich.console import Console
from rich.panel import Panel
from rich.text import Text
from rich.align import Align
from rich.box import DOUBLE, HEAVY, ROUNDED

console = Console()

# Fix Windows encoding
if sys.platform == 'win32':
    os.system('')
    if hasattr(sys.stdout, 'reconfigure'):
        try:
            sys.stdout.reconfigure(encoding='utf-8')
        except Exception:
            pass


def _supports_unicode() -> bool:
    """Check if terminal supports unicode output."""
    try:
        # Try encoding a test character
        "✦".encode(sys.stdout.encoding or 'utf-8')
        return True
    except (UnicodeEncodeError, LookupError, AttributeError):
        return False


# ═══════════════════════════════════════════════════════════════════════════════
# ANSI TERMINAL HELPERS (from MoHa banner)
# ═══════════════════════════════════════════════════════════════════════════════

def _c256(code: int) -> str:
    """Return ANSI escape for 256-color palette."""
    return f"\033[38;5;{code}m"

RESET = "\033[0m"
BOLD = "\033[1m"
DIM = "\033[2m"

def clear_screen():
    sys.stdout.write("\033[2J\033[H")
    sys.stdout.flush()

def hide_cursor():
    sys.stdout.write("\033[?25l")
    sys.stdout.flush()

def show_cursor():
    sys.stdout.write("\033[?25h")
    sys.stdout.flush()

def cursor_up(n: int):
    sys.stdout.write(f"\033[{n}A")
    sys.stdout.flush()


# Color palettes
SEXY_GRADIENT = ["#FF1493", "#FF69B4", "#DA70D6", "#BA55D3", "#9932CC", "#8B008B"]
MYSTICAL = ["#9400D3", "#8A2BE2", "#9932CC", "#BA55D3", "#DA70D6", "#EE82EE"]
FIRE = ["#FF0000", "#FF4500", "#FF6347", "#FF7F50", "#FFA500", "#FFD700"]
SULTRY = ["#8B0000", "#B22222", "#DC143C", "#FF1493", "#FF69B4", "#FFB6C1"]

# Epic block logo - like MoHa style
WIZARD_LOGO_BLOCK = r"""
 ███████╗███╗   ███╗██╗   ██╗████████╗
 ██╔════╝████╗ ████║██║   ██║╚══██╔══╝
 ███████╗██╔████╔██║██║   ██║   ██║
 ╚════██║██║╚██╔╝██║██║   ██║   ██║
 ███████║██║ ╚═╝ ██║╚██████╔╝   ██║
 ╚══════╝╚═╝     ╚═╝ ╚═════╝    ╚═╝
 ██╗    ██╗██╗███████╗ █████╗ ██████╗ ██████╗
 ██║    ██║██║╚══███╔╝██╔══██╗██╔══██╗██╔══██╗
 ██║ █╗ ██║██║  ███╔╝ ███████║██████╔╝██║  ██║
 ██║███╗██║██║ ███╔╝  ██╔══██║██╔══██╗██║  ██║
 ╚███╔███╔╝██║███████╗██║  ██║██║  ██║██████╔╝
  ╚══╝╚══╝ ╚═╝╚══════╝╚═╝  ╚═╝╚═╝  ╚═╝╚═════╝
"""

# Tagline
WIZARD_TAGLINE = "[ CONJURE YOUR DEEPEST FANTASIES ]"

# Use block logo
WIZARD_ASCII = WIZARD_LOGO_BLOCK

SPARKLES = ["*", "+", ".", "~", "^", "x", "o"]  # ASCII-safe sparkles
SEXY_SYMBOLS = ["*", "+", "~", "^", "o", "x"]  # ASCII-safe for Windows

# Unicode versions for terminals that support it
SPARKLES_UNICODE = ["✦", "✧", "⋆", "˚", "·", "✵", "✶", "✷", "✸", "✹"]
SEXY_SYMBOLS_UNICODE = ["♡", "♥", "❤", "✦", "✧", "⋆"]

# Use unicode if supported
if _supports_unicode():
    SPARKLES = SPARKLES_UNICODE
    SEXY_SYMBOLS = SEXY_SYMBOLS_UNICODE

CONJURING_MESSAGES = [
    "Channeling forbidden energies...",
    "Weaving threads of desire...",
    "Summoning your deepest fantasies...",
    "The spirits of lust stir...",
    "Dark passions coalesce...",
    "Reality bends to your will...",
    "Characters take shape in shadow...",
    "Their desires crystallize...",
    "The scenario manifests...",
    "Almost there... the veil thins...",
]

REVEAL_MESSAGES = [
    "Your fantasy awaits...",
    "Behold what you have summoned...",
    "The wizard has spoken...",
    "May your desires be fulfilled...",
]


def typewriter(text: str, delay: float = 0.03) -> None:
    """Print text with typewriter effect using ANSI."""
    sys.stdout.write(f"    {_c256(171)}")
    sys.stdout.flush()
    for char in text:
        sys.stdout.write(char)
        sys.stdout.flush()
        time.sleep(delay)
    print(RESET)


def shimmer_text(text: str, duration: float = 2.0, colors: List[str] = None) -> None:
    """Display text with shimmering color animation using cursor control."""
    # Use 256-color codes instead of hex
    color_codes = [201, 206, 171, 177, 213, 219]  # Magenta/pink gradient
    frames = int(duration * 15)

    # Center padding
    width = console.size.width
    padding = max(0, (width - len(text)) // 2)

    hide_cursor()
    try:
        for i in range(frames):
            if i > 0:
                cursor_up(1)

            output = " " * padding
            for j, char in enumerate(text):
                color_idx = (i + j) % len(color_codes)
                output += f"{BOLD}{_c256(color_codes[color_idx])}{char}"
            print(f"{output}{RESET}")
            time.sleep(0.05)
    finally:
        show_cursor()


def matrix_reveal(text: str, duration: float = 1.5) -> None:
    """Reveal text with matrix-style scramble effect using cursor control."""
    chars = "!@#$%^&*()_+-=[]{}|;:',.<>?/~`" + "".join(SPARKLES)
    frames = int(duration * 20)
    reveal_per_frame = len(text) / frames

    width = console.size.width
    padding = max(0, (width - len(text)) // 2)

    hide_cursor()
    try:
        for frame in range(frames + 5):
            if frame > 0:
                cursor_up(1)

            revealed = int(min(frame * reveal_per_frame, len(text)))
            output = " " * padding

            for i, char in enumerate(text):
                if i < revealed:
                    output += f"{BOLD}{_c256(201)}{char}"  # Bright magenta
                elif char == ' ':
                    output += ' '
                else:
                    output += f"{_c256(240)}{random.choice(chars)}"  # Dim

            print(f"{output}{RESET}")
            time.sleep(0.04)
    finally:
        show_cursor()

    # Final clean line already printed


def wizard_entrance() -> None:
    """Grand entrance animation for the Smut Wizard."""
    clear_screen()
    hide_cursor()

    # Sexy gradient - deep purple to hot pink to white
    SEXY_GRADIENT = [
        53,   # Dark magenta
        54,   # Purple
        90,   # Dark pink
        91,   # Medium purple
        127,  # Magenta
        128,  # Light magenta
        163,  # Pink
        164,  # Light pink
        199,  # Hot pink
        200,  # Bright pink
        206,  # Light hot pink
        213,  # Pale pink
        219,  # Near white pink
    ]

    lines = WIZARD_ASCII.strip().split('\n')
    height = len(lines)

    try:
        # Phase 1: Glitch intro text
        target = ">>> INITIALIZING SMUT WIZARD <<<"
        glitch_chars = "!@#$%^&*_+-=|;:.<>?~" + "".join(SPARKLES)
        resolved = [False] * len(target)

        print()
        for frame in range(15):
            if frame > 0:
                cursor_up(1)

            output = "          "  # Center padding
            chars_to_resolve = int((frame / 15) ** 2 * len(target) * 0.3) + 1
            for _ in range(chars_to_resolve):
                idx = random.randint(0, len(target) - 1)
                resolved[idx] = True

            for i, char in enumerate(target):
                if resolved[i]:
                    color = SEXY_GRADIENT[min(frame // 2, len(SEXY_GRADIENT) - 1)]
                    output += f"{_c256(color)}{char}"
                else:
                    glitch = random.choice(glitch_chars)
                    color = random.choice([196, 201, 206, 211])
                    output += f"{_c256(color)}{glitch}"

            print(f"{output}{RESET}")
            time.sleep(0.04)

        # Final clean glitch line
        cursor_up(1)
        print(f"          {_c256(171)}{target}{RESET}")
        time.sleep(0.3)
        print()

        # Phase 2: Matrix rain into logo reveal
        for frame in range(30):
            if frame > 0:
                cursor_up(height)

            reveal_progress = (frame / 30) ** 1.5
            chars_revealed = int(reveal_progress * height * 50)

            for row_idx, line in enumerate(lines):
                output = ""
                for col_idx, char in enumerate(line):
                    # Check if this char should be revealed
                    char_index = row_idx * 50 + col_idx
                    is_revealed = char_index < chars_revealed

                    if char in "█╗╔╝╚║═╦╩╠╣":
                        if is_revealed:
                            # Multi-wave color pattern
                            wave1 = math.sin((col_idx * 0.08) + (frame * 0.5))
                            wave2 = math.sin((row_idx * 0.15) + (frame * 0.3))
                            wave3 = math.sin(((col_idx + row_idx) * 0.05) + (frame * 0.4))
                            combined = (wave1 + wave2 + wave3) / 3
                            color_idx = int((combined + 1) * 0.5 * (len(SEXY_GRADIENT) - 1))
                            output += f"{BOLD}{_c256(SEXY_GRADIENT[color_idx])}{char}"
                        else:
                            # Matrix rain effect
                            if random.random() < 0.3:
                                output += f"{_c256(35)}{random.choice('01')}"
                            else:
                                output += " "
                    elif char == ' ':
                        output += " "
                    else:
                        output += f"{_c256(240)}{char}"
                print(f"{output}{RESET}")

            time.sleep(0.035)

        # Phase 3: Neon pulse animation
        for frame in range(25):
            cursor_up(height)

            pulse = (math.sin(frame * 0.4) + 1) * 0.5

            for row_idx, line in enumerate(lines):
                output = ""
                for col_idx, char in enumerate(line):
                    if char in "█╗╔╝╚║═╦╩╠╣":
                        # Wave pattern
                        wave1 = math.sin((col_idx * 0.08) + (frame * 0.5))
                        wave2 = math.sin((row_idx * 0.15) + (frame * 0.3))
                        combined = (wave1 + wave2) / 2
                        color_idx = int((combined + 1) * 0.5 * (len(SEXY_GRADIENT) - 1))

                        # Random sparkle
                        if random.random() < 0.02 * pulse:
                            output += f"{BOLD}{_c256(231)}{char}"  # White flash
                        else:
                            output += f"{BOLD}{_c256(SEXY_GRADIENT[color_idx])}{char}"
                    elif char == ' ':
                        output += " "
                    else:
                        output += f"{_c256(240)}{char}"
                print(f"{output}{RESET}")

            time.sleep(0.03)

        # Phase 4: Tagline
        print()
        print(f"          {_c256(245)}{WIZARD_TAGLINE}{RESET}")
        print()
        time.sleep(0.2)

        # Phase 5: Typewriter invitation
        typewriter("Answer my questions... and I shall conjure your deepest fantasies.", delay=0.02)
        print()

    finally:
        show_cursor()


def sexy_prompt(question: str, header: str = "") -> None:
    """Display a question with sexy styling."""
    console.print()
    if header:
        shimmer_text(f"═══  {header}  ═══", duration=0.5, colors=SULTRY)
    console.print()
    console.print(f"  [bold bright_magenta]{question}[/]")
    console.print()


def option_display(options: List[str], columns: int = 1) -> None:
    """Display options with animated numbering."""
    for i, opt in enumerate(options, 1):
        # Quick shimmer on the number
        num_colors = ["#FF1493", "#DA70D6", "#FF69B4"]
        num_styled = Text()
        num_styled.append(f"  {i:2}. ", style=f"bold {random.choice(num_colors)}")
        num_styled.append(opt, style="white")
        console.print(num_styled)
        time.sleep(0.03)  # Slight stagger for drama


def selection_confirm(choice: str, category: str) -> None:
    """Confirm a selection with flair."""
    sparkle = random.choice(SEXY_SYMBOLS)
    console.print(f"  {sparkle} [bold green]{category}:[/] [italic bright_magenta]{choice}[/]")


def conjuring_sequence(callback) -> Any:
    """Run the conjuring animation while executing the callback.

    Returns whatever the callback returns.
    """
    import threading

    result = [None]
    error = [None]
    done = threading.Event()

    def run_generation():
        try:
            result[0] = callback()
        except Exception as e:
            error[0] = e
        finally:
            done.set()

    thread = threading.Thread(target=run_generation)
    thread.start()

    console.print()
    console.print(Panel(
        "[bold bright_magenta]The Smut Wizard begins the ritual...[/]",
        border_style="magenta",
        box=DOUBLE,
    ))
    console.print()

    # Animated conjuring while waiting - using cursor control
    msg_idx = 0
    frame = 0
    spinner_chars = "|/-\\"
    DISPLAY_HEIGHT = 6  # Number of lines in our animation

    # Color codes
    MAGENTA_CODES = [127, 163, 199, 206, 213, 219]
    BAR_CODES = [196, 202, 208, 214, 220, 226]

    # Find max message length for consistent clearing
    MAX_MSG_LEN = max(len(m) for m in CONJURING_MESSAGES)
    LINE_WIDTH = 60  # Fixed width for clearing

    hide_cursor()
    try:
        while not done.is_set():
            if frame > 0:
                cursor_up(DISPLAY_HEIGHT)

            spinner = spinner_chars[frame % len(spinner_chars)]

            # Cycle through messages
            if frame % 25 == 0 and frame > 0:
                msg_idx = (msg_idx + 1) % len(CONJURING_MESSAGES)

            msg = CONJURING_MESSAGES[msg_idx]

            # Line 1: Sparkle border (fixed width)
            sparkle_line = "".join(random.choice(SPARKLES) if random.random() < 0.3 else " " for _ in range(LINE_WIDTH))
            print(f"    {_c256(201)}{sparkle_line}{RESET}")

            # Line 2: Empty (clear full width)
            print(" " * LINE_WIDTH)

            # Line 3: Spinner + message with color cycle (padded to fixed width)
            msg_output = ""
            for i, char in enumerate(msg):
                color_idx = (frame + i) % len(MAGENTA_CODES)
                msg_output += f"{_c256(MAGENTA_CODES[color_idx])}{char}"
            # Pad message to max length to clear previous longer messages
            padding = " " * (MAX_MSG_LEN - len(msg))
            output = f"    {BOLD}{_c256(201)}{spinner}{RESET} {msg_output}{RESET}{padding} {BOLD}{_c256(201)}{spinner}{RESET}"
            # Pad the whole line to clear any artifacts
            print(output + " " * 15)

            # Line 4: Empty (clear full width)
            print(" " * LINE_WIDTH)

            # Line 5: Progress bar (using ASCII to avoid encoding issues)
            bar_width = 40
            progress = (frame % 50) / 50
            filled = int(bar_width * progress)
            bar_output = f"    {_c256(240)}["
            for i in range(bar_width):
                if i < filled:
                    color_idx = (frame + i) % len(BAR_CODES)
                    bar_output += f"{_c256(BAR_CODES[color_idx])}="
                else:
                    bar_output += f"{_c256(240)}-"
            bar_output += f"{_c256(240)}]{RESET}"
            print(bar_output + " " * 15)

            # Line 6: More sparkles (fixed width)
            sparkle_line = "".join(random.choice(SPARKLES) if random.random() < 0.3 else " " for _ in range(LINE_WIDTH))
            print(f"    {_c256(201)}{sparkle_line}{RESET}")

            frame += 1
            time.sleep(0.1)

    finally:
        show_cursor()

    thread.join()

    if error[0]:
        raise error[0]

    # Completion flourish
    print()
    divider = "* ======================================= *"
    matrix_reveal(divider, duration=0.5)
    print()
    shimmer_text(random.choice(REVEAL_MESSAGES), duration=1.0)
    print()

    return result[0]


def _safe_star() -> str:
    """Get a safe star/sparkle character."""
    return "*" if not _supports_unicode() else "✦"


def scenario_reveal(scenario: Dict[str, Any]) -> None:
    """Dramatically reveal the generated scenario."""
    console.print()

    star = _safe_star()

    # Title with shimmer
    title = scenario.get("scenario_name", "Untitled Fantasy")
    console.print(Panel(
        Align.center(Text(f"{star}  {title}  {star}", style="bold bright_magenta")),
        border_style="bright_magenta",
        box=DOUBLE,
        padding=(1, 4),
    ))

    time.sleep(0.3)

    # Safe Unicode symbols
    fleur = "~*~" if not _supports_unicode() else "~*~"  # Keep simple, always works
    diamond = "*" if not _supports_unicode() else "*"
    bullet = " | " if not _supports_unicode() else "  |  "
    dash = "-" if not _supports_unicode() else "-"
    line_char = "-" if not _supports_unicode() else "-"

    # Setting
    setting = scenario.get("setting", "")
    console.print(Panel(
        f"[italic]{setting}[/]",
        title=f"[bold bright_magenta]{fleur} The Setting {fleur}[/]",
        border_style="magenta",
        padding=(1, 2),
    ))

    time.sleep(0.2)

    # Premise
    premise = scenario.get("premise", "")
    console.print(Panel(
        f"[white]{premise}[/]",
        title=f"[bold bright_magenta]{fleur} The Premise {fleur}[/]",
        border_style="magenta",
        padding=(1, 2),
    ))

    time.sleep(0.2)

    # Themes
    themes = scenario.get("themes", [])
    if themes:
        theme_text = bullet.join(themes)
        console.print(Panel(
            f"[italic bright_magenta]{theme_text}[/]",
            title="[bold]Themes[/]",
            border_style="dim magenta",
        ))

    time.sleep(0.2)

    # Opening
    opening = scenario.get("opening_situation", "")
    if opening:
        console.print(Panel(
            f"[bold white]{opening}[/]",
            title=f"[bold bright_magenta]{fleur} Opening Scene {fleur}[/]",
            border_style="bright_magenta",
            padding=(1, 2),
        ))

    console.print()

    # Characters - one by one with dramatic reveal
    characters = scenario.get("characters", [])
    for i, char in enumerate(characters):
        time.sleep(0.3)

        name = char.get("name", "Unknown")
        species = char.get("species", "Unknown")

        # Character header with shimmer effect (simulated)
        console.print(f"  [dim]{line_char * 60}[/]")
        console.print()

        header = Text()
        header.append(f"    {diamond}  ", style="bold bright_magenta")
        header.append(name, style="bold white")
        header.append(f"  {dash}  {species}", style="italic bright_magenta")
        header.append(f"  {diamond}", style="bold bright_magenta")
        console.print(header)
        console.print()

        # Details
        details = [
            ("Personality", char.get("personality", "")),
            ("Appearance", char.get("appearance", "")),
            ("Desires", char.get("desires", "")),
            ("Backstory", char.get("backstory", "")),
            ("Kinks", char.get("kinks", "")),
        ]

        for label, value in details:
            if value:
                console.print(f"    [bold magenta]{label}:[/] [white]{value}[/]")

        console.print()

    console.print(f"  [dim]{'-' * 60}[/]")


def wizard_farewell(scenario_path: str, scenario_name: str) -> None:
    """Dramatic farewell with next steps."""
    console.print()

    slug = scenario_name.lower().replace(" ", "_").replace("'", "")[:40]
    star = _safe_star()

    farewell = f"""
[bold bright_magenta]Your fantasy has been inscribed in the grimoire.[/]

[dim]Saved to:[/] [italic]{scenario_path}[/]

[bold]To enter this world:[/]
  [bold bright_magenta]raunch start --scenario {slug}[/]

[italic dim]May your desires manifest in ways that surprise even you...[/]
"""

    console.print(Panel(
        farewell.strip(),
        border_style="bright_magenta",
        box=DOUBLE,
        title=f"[bold]{star} The Ritual Is Complete {star}[/]",
        padding=(1, 2),
    ))

    # Final sparkle
    console.print()
    sparkle = " ".join(random.choice(SPARKLES) for _ in range(20))
    console.print(Align.center(Text(sparkle, style="bright_magenta")))
    console.print()


def roll_dice_animation() -> None:
    """LEGENDARY dice roll animation - full casino experience."""
    clear_screen()
    hide_cursor()

    width = console.size.width
    center = width // 2

    # Color gradients
    FIRE = [196, 202, 208, 214, 220, 226]  # Red to yellow
    SEXY = [53, 90, 127, 163, 199, 206, 213, 219]  # Purple to pink
    GOLD = [136, 172, 208, 214, 220, 226, 229, 231]  # Gold shimmer

    # Dice faces ASCII art
    DICE_ART = {
        1: ["┌─────┐", "│     │", "│  ●  │", "│     │", "└─────┘"],
        2: ["┌─────┐", "│ ●   │", "│     │", "│   ● │", "└─────┘"],
        3: ["┌─────┐", "│ ●   │", "│  ●  │", "│   ● │", "└─────┘"],
        4: ["┌─────┐", "│ ● ● │", "│     │", "│ ● ● │", "└─────┘"],
        5: ["┌─────┐", "│ ● ● │", "│  ●  │", "│ ● ● │", "└─────┘"],
        6: ["┌─────┐", "│ ● ● │", "│ ● ● │", "│ ● ● │", "└─────┘"],
    }

    # Calculate dice display width: 3 dice * 7 chars + 2 gaps * 2 chars = 25
    DICE_TOTAL_WIDTH = 25
    dice_padding = " " * max(0, (width - DICE_TOTAL_WIDTH) // 2)

    try:
        # Phase 1: Dramatic intro - properly centered
        header_text = "THE DICE OF DESTINY AWAIT"
        box_width = len(header_text) + 8
        box_padding = " " * max(0, (width - box_width) // 2)

        intro_lines = [
            "",
            f"{box_padding}╔{'═' * (box_width - 2)}╗",
            f"{box_padding}║{' ' * (box_width - 2)}║",
            f"{box_padding}║   {header_text}   ║",
            f"{box_padding}║{' ' * (box_width - 2)}║",
            f"{box_padding}╚{'═' * (box_width - 2)}╝",
            "",
        ]

        for frame in range(20):
            if frame > 0:
                cursor_up(len(intro_lines))

            for line in intro_lines:
                output = ""
                for i, char in enumerate(line):
                    if char in "═║╔╗╚╝":
                        color_idx = (frame + i) % len(FIRE)
                        output += f"{BOLD}{_c256(FIRE[color_idx])}{char}"
                    elif char.isupper():
                        color_idx = (frame + i) % len(GOLD)
                        output += f"{BOLD}{_c256(GOLD[color_idx])}{char}"
                    else:
                        output += char
                print(f"{output}{RESET}")
            time.sleep(0.05)

        time.sleep(0.3)

        # Clear intro and start dice
        cursor_up(len(intro_lines))
        for _ in range(len(intro_lines)):
            print(" " * width)
        cursor_up(len(intro_lines))

        # Phase 2: Shake and roll - chaos mode
        subtitle = "Shaking the bones of fate..."
        sub_padding = " " * max(0, (width - len(subtitle)) // 2)
        print(f"{sub_padding}{_c256(245)}{subtitle}{RESET}")
        print()

        # Rapid dice tumbling - DISPLAY_HEIGHT = 5 dice rows only
        DISPLAY_HEIGHT = 5
        for frame in range(40):
            if frame > 0:
                cursor_up(DISPLAY_HEIGHT)

            # Random dice values tumbling
            d1, d2, d3 = random.randint(1, 6), random.randint(1, 6), random.randint(1, 6)

            # Screen shake effect (subtle)
            shake_offset = random.randint(-1, 1) if frame < 30 else 0

            # Draw three dice side by side - centered
            for row in range(5):
                output = " " * (max(0, (width - DICE_TOTAL_WIDTH) // 2) + shake_offset)
                for dice_val in [d1, d2, d3]:
                    dice_line = DICE_ART[dice_val][row]
                    color = SEXY[(frame + row) % len(SEXY)]
                    output += f"{BOLD}{_c256(color)}{dice_line}{RESET}  "
                print(output)

            # Speed: fast then slow down dramatically
            if frame < 20:
                time.sleep(0.03)
            elif frame < 30:
                time.sleep(0.05)
            else:
                time.sleep(0.08 + (frame - 30) * 0.02)

        # Phase 3: Dramatic pause - clear dice area
        cursor_up(DISPLAY_HEIGHT)
        for _ in range(DISPLAY_HEIGHT):
            print(" " * width)
        cursor_up(DISPLAY_HEIGHT)

        # Suspense text - centered
        suspense = ". . . T H E   F A T E S   D E C I D E . . ."
        suspense_padding = " " * max(0, (width - len(suspense)) // 2)
        sys.stdout.write(suspense_padding)
        for i, char in enumerate(suspense):
            sys.stdout.write(f"{_c256(GOLD[i % len(GOLD)])}{char}")
            sys.stdout.flush()
            time.sleep(0.03)
        print(RESET)

        # Pad remaining lines
        for _ in range(DISPLAY_HEIGHT - 1):
            print()

        time.sleep(0.8)

        # Phase 4: EPIC REVEAL
        # Clear the suspense area and prepare for dice
        cursor_up(DISPLAY_HEIGHT)
        for _ in range(DISPLAY_HEIGHT):
            print(" " * width)
        cursor_up(DISPLAY_HEIGHT)

        # Final dice values
        final_d1, final_d2, final_d3 = random.randint(1, 6), random.randint(1, 6), random.randint(1, 6)
        total = final_d1 + final_d2 + final_d3

        # Flash effect - centered
        for flash in range(6):
            if flash > 0:
                cursor_up(DISPLAY_HEIGHT)
            intensity = 231 if flash % 2 == 0 else 201

            for row in range(5):
                output = dice_padding
                for dice_val in [final_d1, final_d2, final_d3]:
                    dice_line = DICE_ART[dice_val][row]
                    output += f"{BOLD}{_c256(intensity)}{dice_line}{RESET}  "
                print(output)

            time.sleep(0.08)

        # Stable final display with gold - centered
        cursor_up(DISPLAY_HEIGHT)
        for row in range(5):
            output = dice_padding
            for i, dice_val in enumerate([final_d1, final_d2, final_d3]):
                dice_line = DICE_ART[dice_val][row]
                color = GOLD[(row + i * 2) % len(GOLD)]
                output += f"{BOLD}{_c256(color)}{dice_line}{RESET}  "
            print(output)

        print()

        # Result announcement - centered
        result_text = f"★ ═══════════  YOU ROLLED: {total}  ═══════════ ★"
        result_padding = " " * max(0, (width - len(result_text)) // 2)

        # Shimmer the result
        for frame in range(15):
            cursor_up(1)
            output = result_padding
            for i, char in enumerate(result_text):
                color_idx = (frame + i) % len(GOLD)
                output += f"{BOLD}{_c256(GOLD[color_idx])}{char}"
            print(f"{output}{RESET}")
            time.sleep(0.05)

        print()
        time.sleep(0.3)

        # Fate message based on roll
        if total >= 15:
            fate = "THE FATES SMILE UPON YOU... LEGENDARY SCENARIO INCOMING!"
            fate_colors = GOLD
        elif total >= 10:
            fate = "A worthy roll... your fantasy takes shape..."
            fate_colors = SEXY
        else:
            fate = "The dice whisper dark secrets... prepare yourself..."
            fate_colors = FIRE

        # Typewriter the fate - centered
        fate_padding = " " * max(0, (width - len(fate)) // 2)
        print()
        sys.stdout.write(fate_padding)
        for i, char in enumerate(fate):
            color = fate_colors[i % len(fate_colors)]
            sys.stdout.write(f"{_c256(color)}{char}")
            sys.stdout.flush()
            time.sleep(0.02)
        print(RESET)
        print()

    finally:
        show_cursor()
