"""Display utilities for the CLI — rendering narration and character thoughts."""

from rich.console import Console
from rich.panel import Panel
from typing import Dict, Any, Optional

console = Console()


def render_tick(results: Dict[str, Any], attached_to: Optional[str] = None) -> None:
    """Render a full tick's output to the terminal."""
    tick_num = results.get("tick", "?")

    # Check if waiting for player
    if results.get("waiting_for_player"):
        console.print(
            Panel(
                f"Waiting for [bold]{results['character']}[/bold] to act...\nType your action and press Enter.",
                title="YOUR TURN",
                border_style="bright_yellow",
            )
        )
        return

    # Narration
    narration = results.get("narration", "")
    if narration:
        console.print()
        console.print(
            Panel(
                narration,
                title=f"TICK {tick_num}",
                subtitle="Narrator",
                border_style="bright_blue",
                padding=(1, 2),
            )
        )

    # Events
    events = results.get("events", [])
    if events:
        event_text = "\n".join(f"  * {e}" for e in events)
        console.print(
            Panel(event_text, title="Events", border_style="dim")
        )

    # Characters
    characters = results.get("characters", {})
    for name, data in characters.items():
        if not isinstance(data, dict):
            continue

        if data.get("waiting_for_player"):
            continue

        action = data.get("action", data.get("dialogue", ""))
        is_attached = (name == attached_to)

        if is_attached:
            # Show full inner thoughts when attached
            inner = data.get("inner_thoughts", "")
            emotion = data.get("emotional_state", "")
            console.print()
            console.print(
                Panel(
                    f"[italic dim]{emotion}[/italic dim]\n\n"
                    f"[italic]{inner}[/italic]\n\n"
                    f"[bold]Action:[/bold] {action}",
                    title=f"ATTACHED: {name}",
                    border_style="bright_magenta",
                    padding=(1, 2),
                )
            )
        else:
            # Non-attached: only show spoken dialogue, not actions
            dialogue = data.get("dialogue")
            if dialogue and dialogue.lower() != "null":
                console.print(f"  [bold]{name}[/bold]: [green]\"{dialogue}\"[/green]")


def render_character_list(characters: Dict[str, Any], attached_to: Optional[str] = None) -> None:
    """Show a summary of all characters."""
    if not characters:
        console.print("[dim]No characters in the world yet.[/dim]")
        return

    for name, char in characters.items():
        marker = " [bright_magenta](attached)[/bright_magenta]" if name == attached_to else ""
        species = char.character_data.get("species", "?")
        emotion = char.emotional_state
        location = char.location
        console.print(f"  [bold]{name}[/bold]{marker} — {species}, feeling {emotion}, at {location}")


def render_world_state(world_snapshot: str) -> None:
    """Display the current world state."""
    console.print(Panel(world_snapshot, title="World State", border_style="bright_cyan"))
