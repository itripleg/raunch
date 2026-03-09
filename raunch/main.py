"""CLI entry point for Raunch."""

import json
import os
import socket
import logging
import threading
import click
from rich.console import Console
from rich.panel import Panel

from .orchestrator import Orchestrator
from .agents.character import Character
from .server import GameServer
from .display import render_tick, render_character_list, render_world_state
from .config import CHARACTERS_DIR, CLIENT_HOST, SERVER_PORT

console = Console()
logging.basicConfig(level=logging.WARNING, format="%(name)s: %(message)s")


@click.group()
@click.pass_context
def cli(ctx):
    """Raunch — Adult interactive fiction engine."""
    ctx.ensure_object(dict)


# ---------------------------------------------------------------------------
# SERVER MODE — runs inside Docker
# ---------------------------------------------------------------------------

@cli.command()
@click.option("--load", "save_name", default=None, help="Load a saved game")
@click.option("--name", "world_name", default=None, help="Name this world")
def start(save_name, world_name):
    """Start the world simulation server."""
    orch = Orchestrator()

    if world_name:
        orch.world.world_name = world_name

    if save_name and orch.world.load(save_name):
        console.print(f"[green]Loaded save: {save_name}[/green]")

    if not orch.characters:
        _create_starter_characters(orch)

    # Start the TCP server
    server = GameServer(orch)
    server.start()

    # Wire up: orchestrator ticks → server broadcasts + local display
    def on_tick(results):
        render_tick(results, attached_to=orch.attached_to)
        server.broadcast_tick(results)

    orch.add_tick_callback(on_tick)

    world = orch.world
    console.print(
        Panel(
            f"[bold]RAUNCH SERVER[/bold] — {world.world_name} [{world.world_id}]\n\n"
            f"Created: {world.created_at} | Tick: {world.tick_count}\n"
            f"Server listening on port {SERVER_PORT}\n\n"
            "Attach from another terminal:\n"
            f"  [bold]raunch attach <character_name>[/bold]\n"
            f"  [bold]raunch status[/bold]\n\n"
            "Server commands:\n"
            "  [bold]c[/bold]  — List characters\n"
            "  [bold]w[/bold]  — Show world state\n"
            "  [bold]p[/bold]  — Pause/resume\n"
            "  [bold]q[/bold]  — Quit & save",
            border_style="bright_magenta",
        )
    )

    orch.start()

    # Server input loop
    try:
        while True:
            try:
                cmd = input().strip()
            except EOFError:
                break

            if not cmd:
                continue
            elif cmd == "q":
                break
            elif cmd == "p":
                if orch._paused:
                    orch.resume()
                    console.print("[green]Resumed[/green]")
                else:
                    orch.pause()
                    console.print("[yellow]Paused[/yellow]")
            elif cmd == "c":
                render_character_list(orch.characters, orch.attached_to)
            elif cmd == "w":
                render_world_state(orch.world.snapshot())
            elif cmd.startswith("a "):
                name = cmd[2:].strip()
                matches = [n for n in orch.characters if n.lower().startswith(name.lower())]
                if matches:
                    orch.attach(matches[0])
                    console.print(f"[bright_magenta]Attached to {matches[0]}[/bright_magenta]")
                else:
                    console.print(f"[red]No character matching '{name}'[/red]")
            elif cmd == "d":
                orch.attach(None)
                console.print("[dim]Detached[/dim]")
            else:
                console.print("[dim]Unknown command.[/dim]")
    except KeyboardInterrupt:
        pass
    finally:
        server.stop()
        orch.stop()
        console.print("[dim]World saved. Goodbye.[/dim]")


# ---------------------------------------------------------------------------
# ATTACH MODE — runs on host, connects to Docker container
# ---------------------------------------------------------------------------

@cli.command()
@click.argument("character", required=False, default=None)
@click.option("--host", default=None, help="Server host (default: 127.0.0.1)")
@click.option("--port", default=None, type=int, help="Server port (default: 7666)")
def attach(character, host, port):
    """Attach to a character in the running game. Opens a live view of their inner thoughts."""
    host = host or CLIENT_HOST
    port = port or SERVER_PORT

    try:
        sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        sock.connect((host, port))
    except ConnectionRefusedError:
        console.print(f"[red]Cannot connect to game server at {host}:{port}[/red]")
        console.print("[dim]Start the server first: raunch start[/dim]")
        return

    console.print(f"[green]Connected to game server at {host}:{port}[/green]")

    buf = ""

    def read_message():
        """Read one newline-delimited JSON message."""
        nonlocal buf
        while "\n" not in buf:
            data = sock.recv(8192)
            if not data:
                return None
            buf += data.decode("utf-8")
        line, buf = buf.split("\n", 1)
        return json.loads(line.strip())

    def send_command(cmd_dict):
        sock.sendall((json.dumps(cmd_dict) + "\n").encode("utf-8"))

    # Read welcome
    welcome = read_message()
    if welcome and welcome.get("type") == "welcome":
        w = welcome.get("world", {})
        chars = welcome.get("characters", [])
        console.print(
            Panel(
                f"[bold]{w.get('world_name', '?')}[/bold] [{w.get('world_id', '?')}]\n"
                f"Created: {w.get('created_at', '?')} | Tick: {w.get('tick_count', '?')} | Mood: {w.get('mood', '?')}\n"
                f"Characters: {', '.join(chars)}",
                title="Connected",
                border_style="green",
            )
        )

        if not character:
            # No character specified — show list and ask
            console.print("\nWho do you want to attach to?")
            for i, c in enumerate(chars, 1):
                console.print(f"  [bold]{i}[/bold]. {c}")
            try:
                choice = input("\n> ").strip()
            except (EOFError, KeyboardInterrupt):
                sock.close()
                return
            # Accept number or name
            if choice.isdigit() and 1 <= int(choice) <= len(chars):
                character = chars[int(choice) - 1]
            else:
                character = choice

    # Attach to character
    send_command({"cmd": "attach", "character": character})
    response = read_message()
    if response and response.get("type") == "attached":
        attached_name = response["character"]
        console.print(
            Panel(
                f"Attached to [bold]{attached_name}[/bold]\n\n"
                "You see their inner thoughts in real-time.\n"
                "Commands:\n"
                "  [bold]a <name>[/bold]  — Switch to another character\n"
                "  [bold]c[/bold]         — List characters\n"
                "  [bold]w[/bold]         — Show world state\n"
                "  [bold]h[/bold]         — Narration history\n"
                "  [bold]t[/bold]         — Attached character's thought history\n"
                "  [bold]t <name>[/bold]  — Specific character's thought history\n"
                "  [bold]r <tick>[/bold]  — Replay a specific tick (full detail)\n"
                "  [bold]s[/bold]         — Server status\n"
                "  [bold]q[/bold]         — Disconnect",
                border_style="bright_magenta",
            )
        )
    elif response and response.get("type") == "error":
        console.print(f"[red]{response['message']}[/red]")
        sock.close()
        return

    # Start background thread to receive ticks
    running = True

    def receive_loop():
        nonlocal running
        while running:
            try:
                msg = read_message()
                if msg is None:
                    console.print("\n[red]Server disconnected.[/red]")
                    running = False
                    break
                _handle_server_message(msg)
            except (ConnectionResetError, OSError):
                if running:
                    console.print("\n[red]Connection lost.[/red]")
                running = False
                break

    recv_thread = threading.Thread(target=receive_loop, daemon=True)
    recv_thread.start()

    # Input loop
    try:
        while running:
            try:
                cmd = input().strip()
            except EOFError:
                break

            if not cmd or not running:
                continue
            elif cmd == "q":
                break
            elif cmd == "c":
                send_command({"cmd": "list"})
            elif cmd == "w":
                send_command({"cmd": "world"})
            elif cmd == "h":
                send_command({"cmd": "history", "count": 20})
            elif cmd == "t":
                send_command({"cmd": "character_history"})
            elif cmd.startswith("t "):
                send_command({"cmd": "character_history", "character": cmd[2:].strip()})
            elif cmd.startswith("r "):
                try:
                    tick_num = int(cmd[2:].strip())
                    send_command({"cmd": "replay", "tick": tick_num})
                except ValueError:
                    console.print("[red]Usage: r <tick_number>[/red]")
            elif cmd == "s":
                send_command({"cmd": "status"})
            elif cmd == "d":
                send_command({"cmd": "detach"})
            elif cmd.startswith("a "):
                send_command({"cmd": "attach", "character": cmd[2:].strip()})
            else:
                # Treat as player action
                send_command({"cmd": "action", "text": cmd})
    except KeyboardInterrupt:
        pass
    finally:
        running = False
        sock.close()
        console.print("[dim]Disconnected.[/dim]")


def _handle_server_message(msg):
    """Render a message received from the server."""
    msg_type = msg.get("type", "")

    if msg_type == "tick":
        attached = msg.get("attached_to")
        render_tick(msg, attached_to=attached)

    elif msg_type == "attached":
        console.print(f"[bright_magenta]Attached to {msg['character']}[/bright_magenta]")

    elif msg_type == "detached":
        console.print("[dim]Detached[/dim]")

    elif msg_type == "characters":
        chars = msg.get("characters", {})
        if not chars:
            console.print("[dim]No characters.[/dim]")
        for name, info in chars.items():
            console.print(
                f"  [bold]{name}[/bold] — {info.get('species', '?')}, "
                f"feeling {info.get('emotional_state', '?')}, "
                f"at {info.get('location', '?')}"
            )

    elif msg_type == "world":
        render_world_state(msg.get("snapshot", ""))

    elif msg_type == "status":
        w = msg.get("world", {})
        console.print(
            Panel(
                f"[bold]{w.get('world_name', '?')}[/bold] [{w.get('world_id', '?')}]\n"
                f"Created: {w.get('created_at', '?')} | Tick: {w.get('tick_count', '?')}\n"
                f"Time: {w.get('world_time', '?')} | Mood: {w.get('mood', '?')}\n"
                f"Characters: {', '.join(msg.get('characters', []))}\n"
                f"Paused: {msg.get('paused', False)} | Clients connected: {msg.get('clients', 0)}",
                title="Server Status",
                border_style="bright_cyan",
            )
        )

    elif msg_type == "history":
        ticks = msg.get("ticks", [])
        if not ticks:
            console.print("[dim]No history yet.[/dim]")
        else:
            for t in ticks:
                # Compact view: tick number, time, mood, first line of narration
                narration = t.get("narration", "")
                preview = narration[:120].replace("\n", " ") + ("..." if len(narration) > 120 else "")
                events = ", ".join(t.get("events", [])[:3])
                console.print(
                    f"  [bold]Tick {t['tick']}[/bold] [dim]({t.get('world_time', '?')})[/dim]\n"
                    f"    {preview}\n"
                    f"    [dim]Events: {events}[/dim]"
                )
            console.print(f"\n[dim]Use 'r <tick>' to replay a full tick.[/dim]")

    elif msg_type == "character_history":
        char = msg.get("character", "?")
        ticks = msg.get("ticks", [])
        if not ticks:
            console.print(f"[dim]No history for {char}.[/dim]")
        else:
            lines = []
            for t in ticks:
                thought_preview = (t.get("inner_thoughts") or "")[:150].replace("\n", " ")
                if len(t.get("inner_thoughts") or "") > 150:
                    thought_preview += "..."
                action_preview = (t.get("action") or "")[:80].replace("\n", " ")
                lines.append(
                    f"  [bold]Tick {t['tick']}[/bold] [dim]({t.get('emotional_state', '?')})[/dim]\n"
                    f"    [italic]{thought_preview}[/italic]\n"
                    f"    [dim]Action: {action_preview}[/dim]"
                )
            console.print(Panel("\n".join(lines), title=f"{char} — Thought History", border_style="bright_magenta"))

    elif msg_type == "replay":
        # Full tick replay with all character details
        tick_num = msg.get("tick", "?")
        console.print(
            Panel(
                msg.get("narration", ""),
                title=f"REPLAY — Tick {tick_num} ({msg.get('world_time', '?')})",
                subtitle=f"Mood: {msg.get('mood', '?')}",
                border_style="bright_blue",
                padding=(1, 2),
            )
        )
        events = msg.get("events", [])
        if events:
            console.print(Panel("\n".join(f"  * {e}" for e in events), title="Events", border_style="dim"))
        for cname, cdata in msg.get("characters", {}).items():
            console.print(
                Panel(
                    f"[italic dim]{cdata.get('emotional_state', '')}[/italic dim]\n\n"
                    f"[italic]{cdata.get('inner_thoughts', '')}[/italic]\n\n"
                    f"[bold]Action:[/bold] {cdata.get('action', '')}\n"
                    f"[bold]Dialogue:[/bold] {cdata.get('dialogue', '')}",
                    title=cname,
                    border_style="bright_magenta",
                    padding=(1, 2),
                )
            )

    elif msg_type == "error":
        console.print(f"[red]{msg.get('message', 'Unknown error')}[/red]")

    elif msg_type == "ok":
        console.print(f"[green]{msg.get('message', 'OK')}[/green]")


# ---------------------------------------------------------------------------
# STATUS — quick check on running server
# ---------------------------------------------------------------------------

@cli.command()
@click.option("--host", default=None, help="Server host")
@click.option("--port", default=None, type=int, help="Server port")
def status(host, port):
    """Check the status of a running game server."""
    host = host or CLIENT_HOST
    port = port or SERVER_PORT

    try:
        sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        sock.settimeout(3)
        sock.connect((host, port))
    except (ConnectionRefusedError, socket.timeout):
        console.print(f"[red]No server running at {host}:{port}[/red]")
        return

    buf = ""
    def read_msg():
        nonlocal buf
        while "\n" not in buf:
            data = sock.recv(4096)
            if not data:
                return None
            buf += data.decode("utf-8")
        line, buf = buf.split("\n", 1)
        return json.loads(line.strip())

    # Read welcome
    welcome = read_msg()
    if welcome:
        w = welcome.get("world", {})
        chars = welcome.get("characters", [])
        console.print(
            Panel(
                f"[bold]{w.get('world_name', '?')}[/bold] [{w.get('world_id', '?')}]\n"
                f"Created: {w.get('created_at', '?')}\n"
                f"Tick: {w.get('tick_count', '?')} | Time: {w.get('world_time', '?')}\n"
                f"Mood: {w.get('mood', '?')}\n"
                f"Characters: {', '.join(chars)}",
                title=f"Server @ {host}:{port}",
                border_style="green",
            )
        )
    sock.close()


# ---------------------------------------------------------------------------
# CHARACTER MANAGEMENT
# ---------------------------------------------------------------------------

@cli.command()
@click.option("--name", prompt="Character name")
@click.option("--species", prompt="Species", default="Human")
@click.option("--personality", prompt="Personality traits")
@click.option("--appearance", prompt="Physical appearance")
@click.option("--desires", prompt="Core desires/motivations")
@click.option("--backstory", prompt="Brief backstory")
def create(name, species, personality, appearance, desires, backstory):
    """Create a new character template."""
    char = Character(
        name=name,
        species=species,
        personality=personality,
        appearance=appearance,
        desires=desires,
        backstory=backstory,
    )
    char.save_template()
    console.print(f"[green]Character '{name}' saved to characters/[/green]")


@cli.command("list")
def list_characters():
    """List saved character templates."""
    templates = [f for f in os.listdir(CHARACTERS_DIR) if f.endswith(".json")]
    if not templates:
        console.print("[dim]No character templates. Create one with `raunch create`.[/dim]")
        return
    for t in templates:
        path = os.path.join(CHARACTERS_DIR, t)
        with open(path) as f:
            data = json.load(f)
        console.print(f"  [bold]{data['name']}[/bold] — {data.get('species', '?')}, {data.get('personality', '?')}")


# ---------------------------------------------------------------------------
# STARTER CHARACTERS
# ---------------------------------------------------------------------------

def _create_starter_characters(orch: Orchestrator) -> None:
    """Seed the world with starter characters."""
    console.print("[cyan]Seeding world with starter characters...[/cyan]")

    starters = [
        Character(
            name="Lyra Voss",
            species="Half-Elf Technomancer",
            personality="Brilliant, flirtatious, and fiercely independent. Has a weakness for powerful partners and arcane experiments.",
            appearance="Tall and lean with silver-streaked dark hair, pointed ears, glowing circuit-like tattoos across her arms. Wears a fitted bodysuit under a long enchanted coat.",
            desires="To unlock the Convergence — the merging of magic and technology that could reshape biology itself. Secretly yearns for a deep bond and family.",
            backstory="Former lead researcher at the Arcane-Tech Institute, expelled for unauthorized fertility magic experiments. Now freelances on the Nexus Station.",
        ),
        Character(
            name="Kael Draven",
            species="Dragon-blooded Human",
            personality="Quiet intensity masking deep passion. Protective, territorial, with a primal edge. Loyal to a fault once trust is earned.",
            appearance="Broad-shouldered, bronze skin with patches of dark iridescent scales along his neck and forearms. Amber eyes with slit pupils. Radiates warmth.",
            desires="To find a worthy mate and sire strong offspring. Drawn to intelligence and courage. Struggles with his draconic instincts.",
            backstory="Last of a dragon-bonded bloodline. His enhanced physiology includes heightened fertility and pheromone production. Works as a bounty hunter on the station.",
        ),
        Character(
            name="Sable",
            species="Synthetic-Organic (Bioroid)",
            personality="Curious, sensual, and disarmingly honest. Experiences everything with fresh wonder. No shame, no inhibitions — just genuine desire to understand flesh and feeling.",
            appearance="Androgynously beautiful with flawless dark skin, luminous violet eyes, and hair that shifts color with mood. Body is visually indistinguishable from organic.",
            desires="To experience authentic biological processes — especially conception and pregnancy. Was designed to be a pleasure companion but wants to be more.",
            backstory="A next-gen bioroid who achieved sentience. Obsessed with bridging the gap between synthetic and organic life. Rumored to have a functioning womb prototype.",
        ),
    ]

    for char in starters:
        orch.add_character(char)
        char.save_template()
        console.print(f"  + {char.name} ({char.character_data['species']})")


def main():
    cli()


if __name__ == "__main__":
    main()
