"""CLI entry point for Raunch."""

import json
import os
import socket
import logging
import threading
import time
from typing import Dict, Any
import click
from rich.console import Console
from rich.panel import Panel

from .orchestrator import Orchestrator, _extract_narration_from_raw, _clean_narration
from .agents.character import Character
from .server import GameServer
from .ws_server import WebSocketServer, WS_PORT
from .display import (
    render_page, render_character_list, render_world_state, render_character_history,
    render_server_startup, render_port_error, render_port_conflict,
    render_server_already_running, check_port_available, check_raunch_server_running,
    start_page_loading, stop_page_loading, update_page_loading,
    render_attach_animation, render_detach_animation,
)
from .config import CHARACTERS_DIR, CLIENT_HOST, SERVER_PORT, SAVES_DIR
from .wizard import generate_scenario, random_scenario, save_scenario, load_scenario, list_scenarios
from .wizard import SETTINGS, KINK_POOLS, VIBES
from .client import get_client


def _extract_character_data_safe(raw: str) -> Dict[str, Any]:
    """Extract character data from raw LLM response, with fallbacks."""
    import json
    import re

    if not raw:
        return {}

    try:
        # Try direct JSON parse
        return json.loads(raw)
    except json.JSONDecodeError:
        pass

    try:
        # Strip markdown fences
        text = raw
        if "```json" in text:
            text = text.split("```json", 1)[1]
        if "```" in text:
            text = text.split("```", 1)[0]

        # Find JSON object
        first = text.find("{")
        last = text.rfind("}")
        if first != -1 and last > first:
            return json.loads(text[first:last + 1])
    except (json.JSONDecodeError, IndexError):
        pass

    # Regex fallback
    result = {}
    for field in ["inner_thoughts", "action", "dialogue", "emotional_state", "desires_update"]:
        match = re.search(rf'"{field}"\s*:\s*"((?:[^"\\]|\\.)*)"', raw, re.DOTALL)
        if match:
            result[field] = match.group(1).replace("\\n", "\n").replace('\\"', '"')
    return result

console = Console()
logging.basicConfig(level=logging.WARNING, format="%(name)s: %(message)s")
logging.getLogger("websockets").setLevel(logging.ERROR)
logging.getLogger("httpx").setLevel(logging.ERROR)
logging.getLogger("httpcore").setLevel(logging.ERROR)


def _show_attach_commands():
    """Display available commands when attached to a character."""
    console.print()
    console.print("[dim]You see their inner thoughts in real-time. Type [bold]?[/bold] for help.[/]")
    console.print()
    console.print(
        Panel(
            "[bold bright_cyan]NAVIGATION[/]\n"
            "  [bold]a[/], [bold]attach[/] [dim]<name>[/]    Switch to another character\n"
            "  [bold]d[/], [bold]detach[/]            Stop viewing inner thoughts\n"
            "  [bold]q[/], [bold]quit[/]              Disconnect from server\n"
            "\n"
            "[bold bright_cyan]INFORMATION[/]\n"
            "  [bold]c[/], [bold]characters[/]        List all characters\n"
            "  [bold]w[/], [bold]world[/]             Show current world state\n"
            "  [bold]s[/], [bold]status[/]            Server status & info\n"
            "\n"
            "[bold bright_cyan]HISTORY[/]\n"
            "  [bold]h[/], [bold]history[/]           Recent narration history\n"
            "  [bold]t[/], [bold]thoughts[/] [dim]<name>[/]  Character's thought history\n"
            "  [bold]r[/], [bold]replay[/] [dim]<page>[/]    Replay a specific page\n"
            "\n"
            "[bold bright_cyan]ACTIONS[/]\n"
            "  [dim]<anything else>[/]       Send as your character's action",
            title="[bold]Commands[/]",
            border_style="dim",
            padding=(0, 2),
        )
    )


def _show_server_commands():
    """Display available commands for the server console."""
    console.print()
    console.print(
        Panel(
            "[bold bright_cyan]PLAYBACK[/]\n"
            "  [bold]n[/], [bold]next[/], [bold]Enter[/]     Advance to next page (manual mode)\n"
            "  [bold]p[/], [bold]pause[/]            Pause/resume auto-advance\n"
            "  [bold]t[/], [bold]timer[/] [dim]<sec>[/]     Set page interval (0=manual, 10+=auto)\n"
            "\n"
            "[bold bright_cyan]CHARACTERS[/]\n"
            "  [bold]c[/], [bold]characters[/]       List all characters\n"
            "  [bold]a[/], [bold]attach[/] [dim]<name>[/]   Attach to character's POV\n"
            "  [bold]d[/], [bold]detach[/]           Detach from current character\n"
            "\n"
            "[bold bright_cyan]WORLD[/]\n"
            "  [bold]w[/], [bold]world[/]            Show current world state\n"
            "\n"
            "[bold bright_cyan]SYSTEM[/]\n"
            "  [bold]r[/], [bold]refresh[/]          Force OAuth token refresh\n"
            "  [bold]q[/], [bold]quit[/]             Save and exit",
            title="[bold]Server Commands[/]",
            border_style="bright_cyan",
            padding=(0, 2),
        )
    )
    console.print()


def _kill_raunch_servers() -> int:
    """Kill any running raunch server processes. Returns count killed."""
    import subprocess
    import sys

    killed = 0

    if sys.platform == "win32":
        # Windows: find python processes with 'raunch' in command line
        try:
            # Get all python processes
            result = subprocess.run(
                ["wmic", "process", "where", "name='python.exe'", "get", "processid,commandline"],
                capture_output=True, text=True, timeout=5
            )
            for line in result.stdout.split("\n"):
                if "raunch" in line.lower() and "start" in line.lower():
                    # Extract PID (last number on the line)
                    parts = line.strip().split()
                    if parts:
                        try:
                            pid = int(parts[-1])
                            subprocess.run(["taskkill", "/F", "/PID", str(pid)], capture_output=True, timeout=5)
                            killed += 1
                        except (ValueError, subprocess.TimeoutExpired):
                            pass
        except (subprocess.TimeoutExpired, FileNotFoundError):
            pass
    else:
        # Unix: use pkill
        try:
            result = subprocess.run(["pkill", "-f", "raunch.*start"], capture_output=True, timeout=5)
            if result.returncode == 0:
                killed = 1  # pkill doesn't tell us how many
        except (subprocess.TimeoutExpired, FileNotFoundError):
            pass

    return killed


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
@click.option("--scenario", "scenario_name", default=None, help="Load a scenario (from wizard/roll)")
@click.option("--headless", is_flag=True, default=False, help="Run without interactive console (for background/daemon mode)")
@click.option("--force", "-f", is_flag=True, default=False, help="Kill any existing server and start fresh")
def start(save_name, world_name, scenario_name, headless, force):
    """Start the world simulation server."""
    orch = Orchestrator()

    if world_name:
        orch.world.world_name = world_name

    if save_name and orch.world.load(save_name):
        orch.is_loaded_session = True
        orch.save_name = save_name
        orch._initial_save_done = True  # Don't re-save immediately for loaded sessions
        console.print(f"[green]Loaded save: {save_name}[/green]")

    # Load scenario if specified
    if scenario_name and not orch.characters:
        scenario = load_scenario(scenario_name)
        if scenario:
            # Check if there's an existing save for this scenario
            derived_save_name = scenario.get("scenario_name", "").lower().replace(" ", "_").replace("'", "")[:50]
            if derived_save_name and not save_name:
                # Try to load existing save for this scenario
                if orch.world.load(derived_save_name):
                    orch.is_loaded_session = True
                    orch.save_name = derived_save_name
                    orch._initial_save_done = True
                    console.print(f"[green]Continuing scenario from save: {derived_save_name}[/green]")
                    # Recreate characters from SAVED scenario (includes dynamically added characters)
                    # Use orch.world.scenario which was loaded from save, not the original scenario file
                    _apply_scenario_characters(orch, orch.world.scenario or scenario)
                else:
                    # Fresh start
                    _apply_scenario(orch, scenario)
            else:
                _apply_scenario(orch, scenario)
        else:
            console.print(f"[red]Scenario '{scenario_name}' not found.[/red]")
            return

    # No default characters - players create their own on join
    if not orch.characters:
        console.print("[cyan]No characters yet - players will create on join[/cyan]")

    # ─── PRE-FLIGHT: Check if server already running ────────────────────────
    existing_server = check_raunch_server_running(SERVER_PORT)
    if existing_server:
        if force:
            # Kill the existing server
            console.print("[yellow]Killing existing server...[/yellow]")
            _kill_raunch_servers()
            time.sleep(1)
            console.print("[green]Done.[/green]\n")
        else:
            # Pass the requested scenario name if any
            requested = scenario_name or world_name
            render_server_already_running(existing_server, requested_scenario=requested)
            console.print("[dim]Tip: Use --force or -f to kill existing server and start fresh[/dim]\n")
            return

    # ─── PRE-FLIGHT PORT CHECKS ────────────────────────────────────────────
    ports_ok = True

    if not check_port_available(SERVER_PORT):
        render_port_conflict(SERVER_PORT, "TCP Game Server")
        ports_ok = False

    if not check_port_available(WS_PORT):
        render_port_conflict(WS_PORT, "WebSocket Server")
        ports_ok = False

    if not check_port_available(8000):
        render_port_conflict(8000, "REST API Server")
        ports_ok = False

    if not ports_ok:
        console.print("[yellow]Fix the port conflicts above and try again.[/yellow]")
        return

    # ─── START SERVERS ─────────────────────────────────────────────────────
    server = GameServer(orch)
    server.start()

    # Start the WebSocket server for web frontend
    import asyncio
    import uvicorn
    from .api import app as fastapi_app, set_orchestrator

    ws_server = WebSocketServer(orch)
    ws_error = None

    def _run_ws():
        nonlocal ws_error
        try:
            loop = asyncio.new_event_loop()
            asyncio.set_event_loop(loop)
            loop.run_until_complete(ws_server.start())
            loop.run_forever()
        except OSError as e:
            ws_error = e

    ws_thread = threading.Thread(target=_run_ws, daemon=True)
    ws_thread.start()
    time.sleep(0.3)  # Give it a moment to start or fail

    if ws_error:
        render_port_error(WS_PORT, "WebSocket Server")
        server.stop()
        return

    # Start the FastAPI REST API server (port 8000) in its own thread
    set_orchestrator(orch)
    api_error = None

    def _run_api():
        nonlocal api_error
        try:
            uvicorn.run(fastapi_app, host="127.0.0.1", port=8000, log_level="error", ws="wsproto")
        except OSError as e:
            api_error = e

    api_thread = threading.Thread(target=_run_api, daemon=True)
    api_thread.start()
    time.sleep(0.3)

    if api_error:
        render_port_error(8000, "REST API Server")
        server.stop()
        return

    # Track page loading state
    page_loading_active = False
    page_animation_thread = None

    def _run_loading_animation(page_num: int):
        """Background thread to update loading animation."""
        nonlocal page_loading_active
        start_page_loading(page_num)
        while page_loading_active:
            update_page_loading()
            time.sleep(0.08)

    # Track progressive rendering state
    progressive_results: Dict[str, Any] = {}
    progressive_rendered = {"narrator": False, "characters": set()}

    # Wire up streaming callback for real-time text + loading animation
    def on_stream(page_num: int, source: str, event_type: str, data: str):
        nonlocal page_loading_active, page_animation_thread, progressive_results, progressive_rendered

        if event_type == "start" and source == "narrator":
            # Reset progressive state for new page
            progressive_results = {"page": page_num, "characters": {}}
            progressive_rendered = {"narrator": False, "characters": set()}
            # Start loading animation when narrator begins
            page_loading_active = True
            page_animation_thread = threading.Thread(
                target=_run_loading_animation,
                args=(page_num,),
                daemon=True
            )
            page_animation_thread.start()
            # Only broadcast page_start if actually streaming (not OAuth mode)
            # This prevents frontend from showing empty StreamingPageEntry
            if orch.streaming_enabled:
                ws_server.broadcast_page_start(page_num, orch._last_page_trigger_reason)
            else:
                # Non-streaming: notify frontend that page is generating (for intermission)
                ws_server.broadcast_page_generating(page_num)

        elif event_type == "delta":
            # Only broadcast deltas if actually streaming
            if orch.streaming_enabled:
                ws_server.broadcast_stream_delta(page_num, source, data)

        elif event_type == "done":
            # Only broadcast stream_done if actually streaming
            if orch.streaming_enabled:
                ws_server.broadcast_stream_done(page_num, source)

            # Progressive CLI rendering - show content as it completes
            if source == "narrator" and not progressive_rendered["narrator"]:
                # Stop loading animation, render narrator immediately
                if page_loading_active:
                    page_loading_active = False
                    time.sleep(0.05)
                    stop_page_loading()

                # Get narrator result from orchestrator and render
                narrator_result = orch.narrator.history[-1]["content"] if orch.narrator.history else ""
                narration = _extract_narration_from_raw(narrator_result) if narrator_result else ""
                narration = _clean_narration(narration)
                progressive_results["narration"] = narration
                progressive_results["mood"] = orch.world.mood

                # Render narrator panel
                from .display import render_narrator_panel
                try:
                    render_narrator_panel(page_num, narration, orch.world.mood)
                except Exception as e:
                    console.print(f"[dim]Narrator: {narration[:100]}...[/dim]")
                progressive_rendered["narrator"] = True

                # In non-streaming mode, send narration to frontend immediately
                # so it can show with typewriter before characters are done
                if not orch.streaming_enabled:
                    ws_server.broadcast_narrator_ready(page_num, narration, orch.world.mood)

            elif source != "narrator" and source not in progressive_rendered["characters"]:
                # Render character as they complete
                char = orch.characters.get(source)
                if char and char.history:
                    raw_response = char.history[-1]["content"] if char.history else ""
                    char_data = _extract_character_data_safe(raw_response)
                    progressive_results["characters"][source] = char_data

                    from .display import render_character_panel_inline
                    try:
                        render_character_panel_inline(
                            source, char_data,
                            is_attached=(source == orch.attached_to)
                        )
                    except Exception:
                        # Fallback: just show dialogue
                        dialogue = char_data.get("dialogue")
                        if dialogue and dialogue.lower() != "null":
                            console.print(f"  [bold]{source}[/] — [italic]\"{dialogue}\"[/]")
                    progressive_rendered["characters"].add(source)

                    # In non-streaming mode, send character to frontend immediately
                    if not orch.streaming_enabled:
                        ws_server.broadcast_character_ready(page_num, source, char_data)

    orch.set_stream_callback(on_stream)

    # Disable streaming for OAuth (doesn't support real streaming)
    client = get_client()
    console.print(f"[dim]Auth method: {client.auth_method}, streaming: {client.supports_streaming}[/dim]")
    orch.streaming_enabled = client.supports_streaming
    if not client.supports_streaming:
        console.print("[dim]OAuth mode: streaming disabled, using typewriter animation[/dim]")

    # Wire up: orchestrator pages → server broadcasts + local display
    def on_page(results):
        nonlocal page_loading_active, progressive_rendered

        # Stop loading animation if still running
        if page_loading_active:
            page_loading_active = False
            time.sleep(0.1)
            stop_page_loading()

        # Only render if we haven't already rendered progressively
        already_rendered = progressive_rendered.get("narrator", False)
        if not already_rendered:
            try:
                render_page(results, attached_to=orch.attached_to)
            except Exception as e:
                console.print(f"[red]Display error: {e}[/red]")
        else:
            # Just render events at the end (characters already shown)
            events = results.get("events", [])
            if events:
                from .display import render_events_panel
                try:
                    render_events_panel(events)
                except Exception:
                    pass

        try:
            server.broadcast_page(results)
        except Exception as e:
            console.print(f"[red]TCP broadcast error: {e}[/red]")
        try:
            ws_server.broadcast_page(results)
        except Exception as e:
            console.print(f"[red]WS broadcast error: {e}[/red]")

    orch.add_page_callback(on_page)

    # ─── ANIMATED STARTUP BANNER ──────────────────────────────────────────
    world = orch.world
    render_server_startup(
        world_name=world.world_name,
        world_id=world.world_id,
        created_at=world.created_at,
        page_count=world.page_count,
        tcp_port=SERVER_PORT,
        ws_port=WS_PORT,
        animated=not headless,
    )

    orch.start()

    # Server input loop
    try:
        if headless:
            # Headless mode: just wait forever, no input processing
            console.print("[dim]Running in headless mode (Ctrl+C to stop)[/dim]")
            while True:
                time.sleep(60)
        while True:
            try:
                cmd = input().strip()
            except EOFError:
                break

            # Parse command and arguments
            parts = cmd.split(None, 1)
            cmd_name = parts[0].lower() if parts else ""
            cmd_arg = parts[1].strip() if len(parts) > 1 else ""

            # Handle empty input or 'n'/'next' = trigger next page
            if not cmd or cmd_name in ("n", "next"):
                if orch.is_manual_mode:
                    if not orch.trigger_page():
                        console.print("[yellow]Cannot page (paused or already running)[/yellow]")
                elif cmd:  # Only warn if they explicitly typed a command
                    console.print("[dim]Not in manual mode (use 't 0' or 'timer 0' to enable)[/dim]")
                continue

            # Command matching (short and long forms)
            if cmd_name in ("q", "quit", "exit"):
                break
            elif cmd_name in ("p", "pause", "resume"):
                if orch._paused:
                    orch.resume()
                    console.print("[green]Resumed[/green]")
                else:
                    orch.pause()
                    console.print("[yellow]Paused[/yellow]")
            elif cmd_name in ("c", "chars", "characters"):
                render_character_list(orch.characters, orch.attached_to)
            elif cmd_name in ("w", "world"):
                render_world_state(orch.world.snapshot())
            elif cmd_name in ("a", "attach"):
                if not cmd_arg:
                    console.print("[red]Usage: a, attach <character_name>[/red]")
                else:
                    matches = [n for n in orch.characters if n.lower().startswith(cmd_arg.lower())]
                    if matches:
                        orch.attach(matches[0])
                        render_attach_animation(matches[0])
                    else:
                        console.print(f"[red]No character matching '{cmd_arg}'[/red]")
            elif cmd_name in ("d", "detach"):
                if orch.attached_to:
                    render_detach_animation(orch.attached_to)
                orch.attach(None)
            elif cmd_name in ("t", "timer", "interval"):
                if cmd_arg:
                    try:
                        seconds = int(cmd_arg)
                        orch.set_page_interval(seconds)
                        if orch.is_manual_mode:
                            console.print("[green]Manual mode enabled (press Enter or 'n' to advance)[/green]")
                        else:
                            console.print(f"[green]Page interval set to {orch.page_interval}s[/green]")
                    except ValueError:
                        console.print("[red]Usage: t, timer <seconds> (0=manual, 10+=auto)[/red]")
                else:
                    if orch.is_manual_mode:
                        console.print("[cyan]Page mode: manual (press Enter or 'n' to advance)[/cyan]")
                    else:
                        console.print(f"[cyan]Page interval: {orch.page_interval}s[/cyan]")
            elif cmd_name in ("r", "refresh"):
                # Force token refresh
                client = get_client()
                if client.force_refresh():
                    console.print("[green]Token refreshed successfully[/green]")
                else:
                    console.print("[red]Token refresh failed - try logging in again with `claude`[/red]")
            elif cmd_name in ("?", "help", "commands"):
                _show_server_commands()
            else:
                console.print("[dim]Unknown command. Type [bold]?[/bold] for help.[/dim]")
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
                f"Created: {w.get('created_at', '?')} | Page: {w.get('page_count', '?')} | Mood: {w.get('mood', '?')}\n"
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

        # Dramatic attach animation!
        render_attach_animation(attached_name)

        # Show commands after animation
        _show_attach_commands()
    elif response and response.get("type") == "error":
        console.print(f"[red]{response['message']}[/red]")
        sock.close()
        return

    # Start background thread to receive pages
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

            # Parse command and arguments
            parts = cmd.split(None, 1)
            cmd_name = parts[0].lower() if parts else ""
            cmd_arg = parts[1].strip() if len(parts) > 1 else ""

            # Command matching (short and long forms)
            if cmd_name in ("q", "quit", "exit"):
                break
            elif cmd_name in ("c", "chars", "characters"):
                send_command({"cmd": "list"})
            elif cmd_name in ("w", "world"):
                send_command({"cmd": "world"})
            elif cmd_name in ("h", "history"):
                send_command({"cmd": "history", "count": 20})
            elif cmd_name in ("t", "thoughts"):
                if cmd_arg:
                    send_command({"cmd": "character_history", "character": cmd_arg})
                else:
                    send_command({"cmd": "character_history"})
            elif cmd_name in ("r", "replay"):
                if not cmd_arg:
                    console.print("[red]Usage: r, replay <page_number>[/red]")
                else:
                    try:
                        page_num = int(cmd_arg)
                        send_command({"cmd": "replay", "page": page_num})
                    except ValueError:
                        console.print("[red]Usage: r, replay <page_number>[/red]")
            elif cmd_name in ("s", "status"):
                send_command({"cmd": "status"})
            elif cmd_name in ("d", "detach"):
                send_command({"cmd": "detach"})
            elif cmd_name in ("a", "attach", "switch"):
                if not cmd_arg:
                    console.print("[red]Usage: a, attach <character_name>[/red]")
                else:
                    send_command({"cmd": "attach", "character": cmd_arg})
            elif cmd_name in ("?", "help", "commands"):
                _show_attach_commands()
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

    if msg_type == "page":
        attached = msg.get("attached_to")
        render_page(msg, attached_to=attached)

    elif msg_type == "attached":
        # Dramatic attach animation when switching characters
        render_attach_animation(msg['character'])

    elif msg_type == "detached":
        render_detach_animation(msg.get('character', 'character'))

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
                f"Created: {w.get('created_at', '?')} | Page: {w.get('page_count', '?')}\n"
                f"Time: {w.get('world_time', '?')} | Mood: {w.get('mood', '?')}\n"
                f"Characters: {', '.join(msg.get('characters', []))}\n"
                f"Paused: {msg.get('paused', False)} | Clients connected: {msg.get('clients', 0)}",
                title="Server Status",
                border_style="bright_cyan",
            )
        )

    elif msg_type == "history":
        pages = msg.get("pages", [])
        if not pages:
            console.print("[dim]No history yet.[/dim]")
        else:
            for p in pages:
                # Compact view: page number, time, mood, first line of narration
                narration = p.get("narration", "")
                preview = narration[:120].replace("\n", " ") + ("..." if len(narration) > 120 else "")
                events = ", ".join(p.get("events", [])[:3])
                console.print(
                    f"  [bold]Page {p['page']}[/bold] [dim]({p.get('world_time', '?')})[/dim]\n"
                    f"    {preview}\n"
                    f"    [dim]Events: {events}[/dim]"
                )
            console.print(f"\n[dim]Use 'r <page>' to replay a full page.[/dim]")

    elif msg_type == "character_history":
        char = msg.get("character", "?")
        pages = msg.get("pages", [])
        render_character_history(char, pages)

    elif msg_type == "replay":
        # Full page replay with all character details
        page_num = msg.get("page", "?")
        console.print(
            Panel(
                msg.get("narration", ""),
                title=f"REPLAY — Page {page_num} ({msg.get('world_time', '?')})",
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
                f"Page: {w.get('page_count', '?')} | Time: {w.get('world_time', '?')}\n"
                f"Mood: {w.get('mood', '?')}\n"
                f"Characters: {', '.join(chars)}",
                title=f"Server @ {host}:{port}",
                border_style="green",
            )
        )
    sock.close()


# ---------------------------------------------------------------------------
# KILL — stop any running servers
# ---------------------------------------------------------------------------

@cli.command()
def kill():
    """Kill any running raunch server processes."""
    from .display import check_raunch_server_running

    # First check if anything is running
    server = check_raunch_server_running(SERVER_PORT)
    if not server:
        console.print("[dim]No raunch server detected on port {SERVER_PORT}[/dim]")
        return

    world = server.get("world", {})
    console.print(f"[yellow]Killing server:[/yellow] {world.get('world_name', 'Unknown')}")

    killed = _kill_raunch_servers()

    if killed > 0:
        console.print(f"[green]Killed {killed} process(es)[/green]")
    else:
        console.print("[yellow]Could not find processes to kill. Try manually:[/yellow]")
        console.print("  [bold]tasklist | findstr python[/bold]")
        console.print("  [bold]taskkill /F /PID <pid>[/bold]")


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
# SMUT WIZARD
# ---------------------------------------------------------------------------

@cli.command()
@click.option("--characters", "num_chars", default=None, type=int, help="Number of characters (1-6)")
@click.option("--quick", "-q", is_flag=True, help="Skip animations for faster experience")
@click.option("--debug", "-d", is_flag=True, help="Show outgoing prompts for debugging content blocks")
def wizard(num_chars, quick, debug):
    """Interactive smut wizard — craft a custom scenario."""
    import random as rand
    from .wizard_display import (
        wizard_entrance, sexy_prompt, option_display, selection_confirm,
        conjuring_sequence, scenario_reveal, wizard_farewell
    )

    if not quick:
        wizard_entrance()
    else:
        console.print(Panel(
            "[bold bright_magenta]THE SMUT WIZARD[/bold bright_magenta]\n\n"
            "[italic]Answer my questions... and I shall conjure your deepest fantasies.[/]",
            border_style="bright_magenta",
        ))

    # ─── MULTIPLAYER MODE ─────────────────────────────────────────────────
    if not quick:
        sexy_prompt("Shall others join in this fantasy?", "MODE")
    else:
        console.print("\n[bold bright_magenta]Solo or multiplayer?[/]:")

    mode_options = ["Solo — A private experience", "Multiplayer — Share with friends"]
    option_display(mode_options) if not quick else [console.print(f"  [dim]{i}.[/] {m}") for i, m in enumerate(mode_options, 1)]

    console.print()
    console.print("  [dim italic]Pick 1 for solo, 2 for multiplayer, or Enter for solo[/]")

    try:
        choice = input("\n  > ").strip()
    except (EOFError, KeyboardInterrupt):
        return

    if choice == "2" or choice.lower() in ("m", "multi", "multiplayer"):
        multiplayer = True
        mode_desc = "Multiplayer"
    else:
        multiplayer = False
        mode_desc = "Solo"

    selection_confirm(mode_desc, "Mode") if not quick else console.print(f"  [green]Mode: {mode_desc}[/]")

    # ─── CHARACTER COUNT ───────────────────────────────────────────────────
    if num_chars is None:
        if not quick:
            sexy_prompt("How many souls shall dance in this tale?", "CHARACTERS")
        else:
            console.print("\n[bold bright_magenta]How many characters?[/]:")

        char_options = ["1 — Solo exploration", "2 — Intimate encounter", "3 — Love triangle", "4+ — Group dynamics"]
        option_display(char_options) if not quick else [console.print(f"  [dim]{i}.[/] {c}") for i, c in enumerate(char_options, 1)]

        console.print()
        console.print("  [dim italic]Pick 1-4, type a number (1-6), or Enter for random[/]")

        try:
            choice = input("\n  > ").strip()
        except (EOFError, KeyboardInterrupt):
            return

        if not choice:
            num_chars = rand.choice([1, 2, 2, 3, 3, 3, 4])  # Weighted toward 2-3
        elif choice.isdigit():
            num_chars = max(1, min(6, int(choice)))
        else:
            num_chars = 3  # Default fallback

        char_desc = {1: "Solo journey", 2: "Duo", 3: "Trio", 4: "Quartet", 5: "Quintet", 6: "Ensemble"}.get(num_chars, f"{num_chars} characters")
        selection_confirm(char_desc, "Cast") if not quick else console.print(f"  [green]Characters: {num_chars}[/]")

    # Setting
    if not quick:
        sexy_prompt("What realm shall we explore?", "SETTING")
    else:
        console.print("\n[bold bright_magenta]Setting vibes[/]:")

    option_display(SETTINGS) if not quick else [console.print(f"  [dim]{i:2}.[/] {s}") for i, s in enumerate(SETTINGS, 1)]

    # Hint for custom input
    console.print()
    console.print("  [dim italic]Pick a number, type your own idea, or Enter for random[/]")

    try:
        choice = input("\n  > ").strip()
    except (EOFError, KeyboardInterrupt):
        return
    if choice.isdigit() and 1 <= int(choice) <= len(SETTINGS):
        setting = SETTINGS[int(choice) - 1]
    elif choice:
        setting = choice
    else:
        setting = rand.choice(SETTINGS)

    selection_confirm(setting, "Setting") if not quick else console.print(f"  [green]Setting: {setting}[/]")

    # Kinks
    if not quick:
        sexy_prompt("What dark desires shall we weave in?", "KINKS & THEMES")
    else:
        console.print("\n[bold bright_magenta]Kinks/themes[/]:")

    option_display(KINK_POOLS) if not quick else [console.print(f"  [dim]{i:2}.[/] {k}") for i, k in enumerate(KINK_POOLS, 1)]

    # Hint for custom input
    console.print()
    console.print("  [dim italic]Pick numbers (e.g. 1,3,5), type your own kinks, or Enter for random[/]")

    try:
        choice = input("\n  > ").strip()
    except (EOFError, KeyboardInterrupt):
        return
    if choice:
        kinks = []
        for part in choice.split(","):
            part = part.strip()
            if part.isdigit() and 1 <= int(part) <= len(KINK_POOLS):
                kinks.append(KINK_POOLS[int(part) - 1])
            elif part:
                kinks.append(part)
    else:
        kinks = rand.sample(KINK_POOLS, k=3)

    kink_str = ", ".join(kinks)
    selection_confirm(kink_str, "Themes") if not quick else console.print(f"  [green]Kinks: {kink_str}[/]")

    # Vibe
    if not quick:
        sexy_prompt("What energy shall permeate this encounter?", "VIBE")
    else:
        console.print("\n[bold bright_magenta]Tone/vibe[/]:")

    option_display(VIBES) if not quick else [console.print(f"  [dim]{i:2}.[/] {v}") for i, v in enumerate(VIBES, 1)]

    # Hint for custom input
    console.print()
    console.print("  [dim italic]Pick a number, describe your own vibe, or Enter for random[/]")

    try:
        choice = input("\n  > ").strip()
    except (EOFError, KeyboardInterrupt):
        return
    if choice.isdigit() and 1 <= int(choice) <= len(VIBES):
        vibe = VIBES[int(choice) - 1]
    elif choice:
        vibe = choice
    else:
        vibe = rand.choice(VIBES)

    selection_confirm(vibe, "Vibe") if not quick else console.print(f"  [green]Vibe: {vibe}[/]")

    # Extra preferences
    if not quick:
        sexy_prompt("Any special requests, mortal?", "EXTRAS")
    else:
        console.print("\n[bold bright_magenta]Anything else?[/]")

    console.print("  [dim italic]Describe specific scenarios, character traits, plot twists... or Enter to skip[/]")

    try:
        extras = input("  > ").strip() or None
    except (EOFError, KeyboardInterrupt):
        return

    if extras and not quick:
        selection_confirm(extras, "Special")

    # Generate with animation
    def do_generate():
        return generate_scenario(
            preferences=extras,
            num_characters=num_chars,
            kinks=kinks,
            setting_hint=setting,
            vibe=vibe,
            debug=debug,
        )

    try:
        if not quick:
            scenario = conjuring_sequence(do_generate)
        else:
            console.print("\n[bright_magenta]The Smut Wizard is conjuring your scenario...[/]")
            scenario = do_generate()
    except Exception as e:
        console.print(f"[red]The ritual failed: {e}[/red]")
        return

    # Add multiplayer flag to scenario
    scenario["multiplayer"] = multiplayer

    # Reveal
    if not quick:
        scenario_reveal(scenario)
    else:
        _display_scenario(scenario)

    # Save and farewell
    path = save_scenario(scenario)
    scenario_name = scenario.get("scenario_name", "untitled")

    if not quick:
        wizard_farewell(path, scenario_name)
    else:
        slug = os.path.basename(path).replace(".json", "")
        console.print(f"\n[green]Saved to scenarios/{os.path.basename(path)}[/]")
        console.print(f"\nStart this world:\n  [bold]raunch start --scenario {slug}[/]")


@cli.command()
@click.option("--characters", "num_chars", default=None, type=int, help="Number of characters (1-6, random if not set)")
@click.option("--quick", "-q", is_flag=True, help="Skip animations for faster experience")
@click.option("--debug", "-d", is_flag=True, help="Show outgoing prompts for debugging content blocks")
def roll(num_chars, quick, debug):
    """Roll the dice — generate a fully random scenario."""
    import random as rand
    from .wizard_display import (
        roll_dice_animation, conjuring_sequence, scenario_reveal, wizard_farewell
    )

    # Random character count if not specified (weighted toward 2-3)
    if num_chars is None:
        num_chars = rand.choice([1, 2, 2, 3, 3, 3, 4, 4])

    if not quick:
        roll_dice_animation()
        # Show what we rolled
        char_desc = {1: "solo", 2: "duo", 3: "trio", 4: "quartet"}.get(num_chars, f"{num_chars}-way")
        console.print(f"\n  [dim]The dice decree:[/] [bold bright_magenta]{char_desc} encounter[/]\n")
    else:
        console.print(f"[bright_magenta]Rolling the dice... ({num_chars} characters)[/bright_magenta]")

    def do_generate():
        return random_scenario(num_characters=num_chars, debug=debug)

    try:
        if not quick:
            scenario = conjuring_sequence(do_generate)
        else:
            scenario = do_generate()
    except Exception as e:
        console.print(f"[red]The fates rejected your roll: {e}[/red]")
        return

    if not quick:
        scenario_reveal(scenario)
    else:
        _display_scenario(scenario)

    path = save_scenario(scenario)
    scenario_name = scenario.get("scenario_name", "untitled")

    if not quick:
        wizard_farewell(path, scenario_name)
    else:
        slug = os.path.basename(path).replace(".json", "")
        console.print(f"\n[green]Saved to scenarios/{os.path.basename(path)}[/green]")
        console.print(f"\nStart this world:\n  [bold]raunch start --scenario {slug}[/bold]")


@cli.command()
@click.argument("scenario_name")
@click.option("--force", "-f", is_flag=True, help="Skip confirmation")
def reset(scenario_name, force):
    """Reset a scenario — delete its save and history to start fresh."""
    scenario = load_scenario(scenario_name)
    if not scenario:
        console.print(f"[red]Scenario '{scenario_name}' not found.[/red]")
        return

    derived_save_name = scenario.get("scenario_name", "").lower().replace(" ", "_").replace("'", "")[:50]
    save_path = os.path.join(SAVES_DIR, f"{derived_save_name}.json")

    # Check if save exists
    if not os.path.exists(save_path):
        console.print(f"[yellow]No save found for '{scenario_name}' — already fresh.[/yellow]")
        return

    # Load to get world_id for history deletion
    with open(save_path) as f:
        save_data = json.load(f)
    world_id = save_data.get("world_id")
    page_count = save_data.get("page_count", 0)

    if not force:
        console.print(f"[yellow]This will delete:[/yellow]")
        console.print(f"  • Save file: {derived_save_name}.json")
        console.print(f"  • {page_count} pages of history (world_id: {world_id})")
        try:
            confirm = input("\nType 'yes' to confirm: ").strip().lower()
        except (EOFError, KeyboardInterrupt):
            console.print("\n[dim]Cancelled.[/dim]")
            return
        if confirm != "yes":
            console.print("[dim]Cancelled.[/dim]")
            return

    # Delete save file
    os.remove(save_path)
    console.print(f"[green]Deleted {derived_save_name}.json[/green]")

    # Delete history from database
    if world_id:
        import sqlite3
        db_path = os.path.join(SAVES_DIR, "history.db")
        if os.path.exists(db_path):
            conn = sqlite3.connect(db_path)
            pages_deleted = conn.execute("DELETE FROM pages WHERE world_id = ?", (world_id,)).rowcount
            chars_deleted = conn.execute("DELETE FROM character_pages WHERE world_id = ?", (world_id,)).rowcount
            conn.commit()
            conn.close()
            console.print(f"[green]Deleted {pages_deleted} pages, {chars_deleted} character records[/green]")

    console.print(f"\n[green]Scenario '{scenario_name}' reset. Run with --scenario to start fresh.[/green]")


@cli.command("scenarios")
def list_scenarios_cmd():
    """List saved scenarios."""
    scenarios = list_scenarios()
    if not scenarios:
        console.print("[dim]No scenarios yet. Create one with `raunch wizard` or `raunch roll`.[/dim]")
        return
    for s in scenarios:
        themes = ", ".join(s.get("themes", [])[:4])
        console.print(
            f"  [bold]{s['name']}[/bold] [dim]({s['file']})[/dim]\n"
            f"    {s['setting']}\n"
            f"    [dim]{s['characters']} characters | {themes}[/dim]"
        )


def _display_scenario(scenario: Dict):
    """Pretty-print a generated scenario."""
    console.print()
    console.print(
        Panel(
            f"[bold]{scenario.get('scenario_name', 'Untitled')}[/bold]\n\n"
            f"{scenario.get('setting', '')}\n\n"
            f"[italic]{scenario.get('premise', '')}[/italic]\n\n"
            f"Themes: {', '.join(scenario.get('themes', []))}\n\n"
            f"[bold]Opening:[/bold] {scenario.get('opening_situation', '')}",
            title="SCENARIO",
            border_style="bright_magenta",
            padding=(1, 2),
        )
    )
    for char in scenario.get("characters", []):
        kinks = char.get("kinks", "")
        console.print(
            Panel(
                f"[bold]{char['name']}[/bold] — {char.get('species', '?')}\n\n"
                f"{char.get('personality', '')}\n\n"
                f"[bold]Appearance:[/bold] {char.get('appearance', '')}\n"
                f"[bold]Desires:[/bold] {char.get('desires', '')}\n"
                f"[bold]Backstory:[/bold] {char.get('backstory', '')}\n"
                f"[bold]Kinks:[/bold] {kinks}",
                border_style="dim",
                padding=(1, 2),
            )
        )


def _apply_scenario_characters(orch: Orchestrator, scenario: Dict) -> None:
    """Recreate characters from scenario (for loading existing saves)."""
    # Get location from existing world state or derive from scenario
    if orch.world.locations:
        loc_name = list(orch.world.locations.keys())[0]
    else:
        loc_name = scenario.get("scenario_name", "The Scene")

    for char_data in scenario.get("characters", []):
        char = Character(
            name=char_data["name"],
            species=char_data.get("species", "Human"),
            personality=char_data.get("personality", ""),
            appearance=char_data.get("appearance", ""),
            desires=char_data.get("desires", ""),
            backstory=char_data.get("backstory", ""),
            kinks=char_data.get("kinks", ""),
        )
        orch.add_character(char, location=loc_name)
        console.print(f"  + {char.name} ({char_data.get('species', '?')})")


def _apply_scenario(orch: Orchestrator, scenario: Dict) -> None:
    """Apply a scenario to the orchestrator — set world context and create characters."""
    # Set world metadata
    orch.world.scenario = scenario
    orch.world.world_name = scenario.get("scenario_name", orch.world.world_name)
    orch.world.multiplayer = scenario.get("multiplayer", False)

    # Update starting location from scenario setting
    setting = scenario.get("setting", "")
    if setting:
        loc_name = scenario.get("scenario_name", "The Scene")
        orch.world.locations = {
            loc_name: {
                "description": setting,
                "characters": [],
            }
        }
    else:
        loc_name = list(orch.world.locations.keys())[0]

    # Create characters from scenario
    console.print(f"[cyan]Loading scenario: {scenario.get('scenario_name', '?')}[/cyan]")
    for char_data in scenario.get("characters", []):
        char = Character(
            name=char_data["name"],
            species=char_data.get("species", "Human"),
            personality=char_data.get("personality", ""),
            appearance=char_data.get("appearance", ""),
            desires=char_data.get("desires", ""),
            backstory=char_data.get("backstory", ""),
            kinks=char_data.get("kinks", ""),
        )
        orch.add_character(char, location=loc_name)
        console.print(f"  + {char.name} ({char_data.get('species', '?')})")


# ---------------------------------------------------------------------------
# STARTER CHARACTERS (fallback when no scenario)
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
