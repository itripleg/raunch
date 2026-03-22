"""CLI entry point for Raunch."""

import json
import os
import logging
import threading
import time
from typing import Dict, Any
import click
from rich.console import Console
from rich.panel import Panel

from .client import RemoteClient, LocalClient, Page
from .orchestrator import Orchestrator, _extract_narration_from_raw, _clean_narration
from .agents.character import Character
from .display import (
    render_page, render_character_list, render_world_state, render_character_history,
    render_server_startup, render_scene_intro, _scene_break,
    start_page_loading, stop_page_loading, update_page_loading,
    render_attach_animation, render_detach_animation,
    render_books_list, render_book_info, render_book_deleted, render_book_joined,
    render_books_menu,
)
from .config import CHARACTERS_DIR, SAVES_DIR
from .wizard import generate_scenario, random_scenario, save_scenario, load_scenario, list_scenarios
from .wizard import SETTINGS, KINK_POOLS, VIBES
from .llm import get_client


console = Console()
logging.basicConfig(level=logging.WARNING, format="%(name)s: %(message)s")
logging.getLogger("httpx").setLevel(logging.ERROR)
logging.getLogger("httpcore").setLevel(logging.ERROR)




def _show_server_commands():
    """Display available commands for the server console."""
    console.print()
    console.print(
        Panel(
            "[bold bright_cyan]STORY[/]\n"
            "  [bold]n[/], [bold]next[/], [bold]Enter[/]     Advance to next page (manual mode)\n"
            "  [bold]w[/] [dim]<text>[/]             Whisper (to character if attached, narrator if not)\n"
            "\n"
            "[bold bright_cyan]CHARACTERS[/]\n"
            "  [bold]c[/], [bold]characters[/]       List all characters\n"
            "  [bold]a[/], [bold]attach[/] [dim]<name>[/]   Attach to character's POV\n"
            "  [bold]d[/], [bold]detach[/]           Detach from current character\n"
            "\n"
            "[bold bright_cyan]PLAYBACK[/]\n"
            "  [bold]p[/], [bold]pause[/]            Pause/resume auto-advance\n"
            "  [bold]t[/], [bold]timer[/] [dim]<sec>[/]     Set page interval (0=manual, 10+=auto)\n"
            "  [bold]world[/]               Show current world state\n"
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
@click.option("--serve", is_flag=True, default=False, help="Also start web server on port 8000 (enables frontend connection)")
@click.option("--port", default=8000, type=int, help="Web server port (default: 8000, only with --serve)")
def start(save_name, world_name, scenario_name, headless, serve, port):
    """Start the world simulation with CLI display. Use --serve to also run the web server."""
    orch = Orchestrator()

    if world_name:
        orch.world.world_name = world_name

    if save_name and orch.world.load(save_name):
        orch.save_name = save_name
        orch._initial_save_done = True
        console.print(f"[green]Loaded save: {save_name}[/green]")
        # Character history will be restored after characters are created

    # Load scenario if specified
    if scenario_name and not orch.characters:
        scenario = load_scenario(scenario_name)
        if scenario:
            # Check if there's an existing save for this scenario
            derived_save_name = scenario.get("scenario_name", "").lower().replace(" ", "_").replace("'", "")[:50]
            if derived_save_name and not save_name:
                # Try to load existing save for this scenario
                if orch.world.load(derived_save_name):
            
                    orch.save_name = derived_save_name
                    orch._initial_save_done = True
                    console.print(f"[green]Continuing scenario from save: {derived_save_name}[/green]")
                    # Recreate characters from SAVED scenario (includes dynamically added characters)
                    # Use orch.world.scenario which was loaded from save, not the original scenario file
                    _apply_scenario_characters(orch, orch.world.scenario or scenario)
                    # Restore character memory (history + summary)
                    if orch._load_characters(derived_save_name):
                        console.print(f"[green]Character memories restored[/green]")
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

    # Restore character memories if loaded from save (and not already restored above)
    if save_name and orch.characters and not orch._initial_save_done:
        pass  # Already handled above
    elif save_name and orch.characters:
        if orch._load_characters(save_name):
            console.print(f"[green]Character memories restored[/green]")

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

    # Track page count for scene breaks
    cli_page_count = [0]

    # Progressive rendering callbacks — CLI renders as each piece completes
    def on_page_start(page_num: int):
        nonlocal page_loading_active, page_animation_thread, progressive_rendered
        progressive_rendered = {"narrator": False, "characters": set()}

        # Scene break between pages (not before the first)
        if cli_page_count[0] > 0:
            _scene_break(cli_page_count[0])
        cli_page_count[0] += 1

        page_loading_active = True
        page_animation_thread = threading.Thread(
            target=_run_loading_animation,
            args=(page_num,),
            daemon=True
        )
        page_animation_thread.start()

    def on_narrator_ready(page_num: int, narration: str, mood: str):
        nonlocal page_loading_active, progressive_rendered
        if progressive_rendered.get("narrator"):
            return
        if page_loading_active:
            page_loading_active = False
            time.sleep(0.05)
            stop_page_loading()
        from .display import render_narrator_panel
        try:
            render_narrator_panel(page_num, narration, mood)
        except Exception:
            console.print(f"[dim]Narrator: {narration[:100]}...[/dim]")
        progressive_rendered["narrator"] = True

    def on_character_ready(page_num: int, name: str, data: dict):
        nonlocal progressive_rendered
        if name in progressive_rendered.get("characters", set()):
            return
        is_attached = (name == orch.attached_to)
        # Debug: show data keys so we can diagnose missing inner_thoughts
        console.print(f"[dim]  [{name}] attached={is_attached} keys={list(data.keys()) if data else 'None'}[/dim]")
        from .display import render_character_panel_inline
        try:
            render_character_panel_inline(
                name, data,
                is_attached=is_attached
            )
        except Exception as e:
            console.print(f"[dim red]Character render error for {name}: {e}[/dim red]")
            dialogue = data.get("dialogue")
            if dialogue and dialogue.lower() != "null":
                console.print(f"  [bold]{name}[/] — [italic]\"{dialogue}\"[/]")
        progressive_rendered["characters"].add(name)

    orch.set_page_start_callback(on_page_start)
    orch.set_narrator_callback(on_narrator_ready)
    orch.set_character_callback(on_character_ready)

    # Final page callback — renders anything not already shown progressively
    def on_page(results):
        nonlocal page_loading_active, progressive_rendered

        if page_loading_active:
            page_loading_active = False
            time.sleep(0.1)
            stop_page_loading()

        if not progressive_rendered.get("narrator", False):
            try:
                render_page(results, attached_to=orch.attached_to)
            except Exception as e:
                console.print(f"[red]Display error: {e}[/red]")
        else:
            events = results.get("events", [])
            if events:
                from .display import render_events_panel
                try:
                    render_events_panel(events)
                except Exception:
                    pass

    orch.add_page_callback(on_page)

    # ─── OPTIONAL WEB SERVER ──────────────────────────────────────────────
    if serve:
        import asyncio
        import uvicorn
        from .server.app import create_app
        from .server.ws import ws_manager, _broadcast_narrator_ready, _broadcast_character_ready, _broadcast_page
        from . import db

        # Find or create a book for this scenario
        book_id = None
        scenario_display = scenario_name or world_name or "cli-session"
        try:
            # Use same librarian as frontend demo mode so books are shared
            librarian = db.create_librarian("CLI Host", kinde_user_id="local-demo-user")
            # Reuse existing book for this scenario if one exists
            existing_books = db.list_books_for_librarian(librarian["id"])
            # Normalize for comparison: strip .json, lowercase
            norm = scenario_display.lower().replace(".json", "").replace(" ", "_")
            for b in existing_books:
                b_norm = (b.get("scenario_name") or "").lower().replace(".json", "").replace(" ", "_")
                if b_norm == norm:
                    book_id = b["id"]
                    book_data = b
                    console.print(f"[dim]Reusing book: {book_id} (bookmark: {b.get('bookmark')})[/dim]")
                    break
            if not book_id:
                book_data = db.create_book(scenario_display, librarian["id"])
                book_id = book_data["id"]
                console.print(f"[dim]Book created: {book_id} (bookmark: {book_data.get('bookmark')})[/dim]")
            # Set as the active book so frontend auto-loads it
            db.set_librarian_last_active_book(librarian["id"], book_id)
        except Exception as e:
            console.print(f"[yellow]Could not create book for web sync: {e}[/yellow]")

        # Start FastAPI server in background thread, capturing its event loop
        fastapi_app = create_app()
        _server_loop = [None]

        def _run_server():
            loop = asyncio.new_event_loop()
            asyncio.set_event_loop(loop)
            _server_loop[0] = loop
            config = uvicorn.Config(fastapi_app, host="0.0.0.0", port=port, log_level="warning", loop="none")
            srv = uvicorn.Server(config)
            loop.run_until_complete(srv.serve())

        server_thread = threading.Thread(target=_run_server, daemon=True)
        server_thread.start()
        time.sleep(1)  # Let server start

        # Register CLI's orchestrator with the server's Library so WebSocket
        # clients share it instead of creating a new one
        if book_id:
            from .server.library import get_library
            from .server.book import Book
            library = get_library()
            book_obj = library.get_book(book_id)
            if book_obj is None:
                # Create in-memory Book and register
                book_obj = Book(
                    book_id=book_id,
                    bookmark=book_data.get("bookmark", ""),
                    scenario_name=scenario_display,
                    owner_id=librarian["id"],
                )
                library.books[book_id] = book_obj
                library._bookmarks[book_data.get("bookmark", "").upper()] = book_id
            # Attach the CLI's orchestrator to this book
            book_obj.set_orchestrator(orch)

        # Wire orchestrator callbacks to also broadcast via WebSocket
        if book_id:
            def _broadcast(coro):
                """Schedule an async broadcast on the server's event loop."""
                loop = _server_loop[0]
                if loop is None:
                    return
                try:
                    asyncio.run_coroutine_threadsafe(coro, loop)
                except Exception:
                    pass

            _orig_page_start = on_page_start
            _orig_narrator_ready = on_narrator_ready
            _orig_character_ready = on_character_ready
            _orig_on_page = on_page

            def on_page_start_with_serve(page_num: int):
                _orig_page_start(page_num)
                _broadcast(ws_manager.broadcast(book_id, {
                    "type": "page_generating",
                    "page": page_num,
                }))

            def on_narrator_ready_with_serve(page_num: int, narration: str, mood: str):
                _orig_narrator_ready(page_num, narration, mood)
                _broadcast(_broadcast_narrator_ready(book_id, page_num, narration, mood))

            def on_character_ready_with_serve(page_num: int, name: str, data: dict):
                _orig_character_ready(page_num, name, data)
                _broadcast(_broadcast_character_ready(book_id, page_num, name, data))

            def on_page_with_serve(results):
                _orig_on_page(results)
                _broadcast(_broadcast_page(book_id, results))
                # Also save to database
                try:
                    db.save_page(
                        book_id,
                        results.get("page", 0),
                        results.get("narration", ""),
                        results.get("events", []),
                        orch.world.world_time,
                        orch.world.mood or "default",
                    )
                except Exception:
                    pass

            # Replace callbacks
            orch.set_page_start_callback(on_page_start_with_serve)
            orch.set_narrator_callback(on_narrator_ready_with_serve)
            orch.set_character_callback(on_character_ready_with_serve)
            orch._page_callbacks = [on_page_with_serve]

        console.print(f"[green]Web server running on http://localhost:{port}[/green]")
        if book_id:
            bm = book_data.get("bookmark", "")
            console.print(f"[bold]Book ID: [bright_cyan]{book_id}[/bright_cyan] | Bookmark: [bright_cyan]{bm}[/bright_cyan][/bold]")
            console.print(f"[dim]Select this book in the frontend dashboard to sync[/dim]")

    # ─── ANIMATED STARTUP BANNER ──────────────────────────────────────────
    world = orch.world
    render_server_startup(
        world_name=world.world_name,
        world_id=world.world_id,
        created_at=world.created_at,
        page_count=world.page_count,
        animated=not headless,
    )

    # Scene intro with scenario info
    if not headless and orch.world.scenario:
        scenario = orch.world.scenario
        render_scene_intro(
            scenario.get("scenario_name", world.world_name),
            scenario.get("setting", ""),
            world.mood or "anticipation",
        )
        # Show opening situation with dramatic reveal
        opening = scenario.get("opening_situation", "")
        if opening:
            from .display import _dramatic_reveal
            _dramatic_reveal(opening)
            console.print()

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
            elif cmd_name in ("w", "whisper"):
                if not cmd_arg:
                    console.print("[red]Usage: w <message to whisper>[/red]")
                    if orch.attached_to:
                        console.print(f"[dim]Whispers to {orch.attached_to} (attached character)[/dim]")
                    else:
                        console.print("[dim]Not attached — whisper will go to the narrator as director guidance[/dim]")
                elif orch.attached_to:
                    if orch.submit_influence(orch.attached_to, cmd_arg):
                        console.print(f"  [dim italic]♥ whispered to {orch.attached_to}: \"{cmd_arg}\"[/dim italic]")
                    else:
                        console.print(f"[red]Could not whisper to {orch.attached_to}[/red]")
                else:
                    # Not attached — whisper to narrator (director mode)
                    orch.submit_director_guidance(cmd_arg)
                    console.print(f"  [dim italic]✧ whispered to the narrator: \"{cmd_arg}\"[/dim italic]")
            elif cmd_name in ("world",):
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
        orch.stop()
        console.print("[dim]World saved. Goodbye.[/dim]")


# ---------------------------------------------------------------------------
# ATTACH — connect to a running server and view a character's inner thoughts
# ---------------------------------------------------------------------------

@cli.command()
@click.argument("character", required=False, default=None)
@click.option("--host", default="localhost", help="Server host (default: localhost)")
@click.option("--port", default=8000, type=int, help="Server port (default: 8000)")
@click.option("--book", "book_id", default=None, help="Book ID to attach to")
def attach(character, host, port, book_id):
    """Attach to a character on a running server. See their inner thoughts in real-time.

    Examples:
        raunch attach Maven
        raunch attach --host my-server.com
        raunch attach Maven --book abc123
    """
    import websockets.sync.client as ws_sync
    import httpx

    base_url = f"http://{host}:{port}"

    # Find a book to attach to
    if not book_id:
        try:
            resp = httpx.get(f"{base_url}/health", timeout=3)
            resp.raise_for_status()
        except Exception:
            console.print(f"[red]Cannot connect to server at {base_url}[/red]")
            console.print("[dim]Start the server first: python -m raunch.server[/dim]")
            console.print("[dim]Or with CLI: raunch start --serve[/dim]")
            return

        # Find books — query the local database directly for active books
        books = []
        try:
            from . import db as _db
            # Get all librarians and their books
            conn = None
            try:
                from .db_sqlite import _get_conn
                conn = _get_conn()
                rows = conn.execute("SELECT id, scenario_name, bookmark, owner_id FROM books ORDER BY created_at DESC LIMIT 10").fetchall()
                books = [{"id": r["id"], "scenario_name": r["scenario_name"], "bookmark": r["bookmark"]} for r in rows]
            except Exception:
                pass

            # Fallback: try API with common librarian IDs
            if not books:
                for lib_id in ["CLI Host", "local-demo-user"]:
                    try:
                        resp = httpx.get(f"{base_url}/api/v1/books", headers={"X-Librarian-Id": lib_id}, timeout=5)
                        if resp.status_code == 200:
                            found = resp.json()
                            if found:
                                books = found
                                break
                    except Exception:
                        continue
        except Exception:
            pass

        if not books:
            console.print("[yellow]No active books found on the server.[/yellow]")
            console.print("[dim]Start with: raunch start --scenario <name> --serve[/dim]")
            return

        if len(books) == 1:
            book_id = books[0]["id"]
            console.print(f"[dim]Joining: {books[0].get('scenario_name', book_id)}[/dim]")
        else:
            console.print("\n[bold]Available books:[/bold]")
            for i, b in enumerate(books, 1):
                console.print(f"  [bold]{i}[/bold]. {b.get('scenario_name', b['id'])} [dim]({b.get('bookmark', '')})[/dim]")
            try:
                choice = input("\n> ").strip()
            except (EOFError, KeyboardInterrupt):
                return
            if choice.isdigit() and 1 <= int(choice) <= len(books):
                book_id = books[int(choice) - 1]["id"]
            else:
                console.print("[red]Invalid choice.[/red]")
                return

    # Connect via WebSocket
    ws_url = f"ws://{host}:{port}/ws/{book_id}"
    try:
        ws = ws_sync.connect(ws_url)
    except Exception as e:
        console.print(f"[red]WebSocket connection failed: {e}[/red]")
        return

    # Read welcome
    import json
    try:
        welcome = json.loads(ws.recv(timeout=5))
    except Exception:
        console.print("[red]No welcome message from server.[/red]")
        ws.close()
        return

    if welcome.get("type") == "error":
        console.print(f"[red]{welcome.get('message', 'Connection error')}[/red]")
        ws.close()
        return

    w = welcome.get("world", {})
    chars = welcome.get("characters", [])
    console.print(
        Panel(
            f"[bold]{w.get('world_name', '?')}[/bold]\n"
            f"Page: {w.get('page_count', '?')} | Mood: {w.get('mood', '?')}\n"
            f"Characters: {', '.join(chars)}",
            title="[green]Connected[/green]",
            border_style="green",
        )
    )

    # Join as reader
    ws.send(json.dumps({"cmd": "join", "nickname": "CLI Attach"}))
    try:
        join_resp = json.loads(ws.recv(timeout=5))
    except Exception:
        pass

    # Pick character
    if not character:
        console.print("\n[bold]Who do you want to attach to?[/bold]")
        for i, c in enumerate(chars, 1):
            console.print(f"  [bold]{i}[/bold]. {c}")
        try:
            choice = input("\n> ").strip()
        except (EOFError, KeyboardInterrupt):
            ws.close()
            return
        if choice.isdigit() and 1 <= int(choice) <= len(chars):
            character = chars[int(choice) - 1]
        else:
            # Try as name
            character = choice

    # Attach
    ws.send(json.dumps({"cmd": "attach", "character": character}))
    try:
        attach_resp = json.loads(ws.recv(timeout=5))
        if attach_resp.get("type") == "attached":
            attached_name = attach_resp["character"]
            render_attach_animation(attached_name)
        elif attach_resp.get("type") == "error":
            console.print(f"[red]{attach_resp.get('message')}[/red]")
            ws.close()
            return
    except Exception:
        pass

    # Background receive loop
    running = True
    attached_to = character

    def _receive_loop():
        nonlocal running, attached_to
        while running:
            try:
                raw = ws.recv(timeout=1)
                msg = json.loads(raw)
                msg_type = msg.get("type", "")

                if msg_type == "page":
                    # Skip — character_ready already rendered progressively
                    pass

                elif msg_type == "narrator_ready":
                    # Skip narration in attach mode — the start terminal shows it
                    pass

                elif msg_type == "character_ready":
                    # Only show the attached character
                    name = msg.get("character", "")
                    if name == attached_to:
                        from .display import render_character_panel_inline
                        data = msg.get("data", {})
                        render_character_panel_inline(name, data, is_attached=True)

                elif msg_type == "page_generating":
                    console.print(f"\n  [dim]✧ Page {msg.get('page', '')} generating...[/dim]")

                elif msg_type == "attached":
                    attached_to = msg["character"]
                    render_attach_animation(attached_to)

                elif msg_type == "detached":
                    render_detach_animation(attached_to or "character")
                    attached_to = None

                elif msg_type == "influence_queued":
                    console.print(f"  [dim italic]♥ whispered to {msg.get('character')}: \"{msg.get('text')}\"[/dim italic]")

                elif msg_type == "director_queued":
                    console.print(f"  [dim italic]✧ whispered to narrator: \"{msg.get('text')}\"[/dim italic]")

                elif msg_type == "error":
                    console.print(f"[red]{msg.get('message', 'Error')}[/red]")

            except TimeoutError:
                continue
            except Exception:
                if running:
                    console.print("\n[red]Connection lost.[/red]")
                running = False
                break

    recv_thread = threading.Thread(target=_receive_loop, daemon=True)
    recv_thread.start()

    # Input loop
    console.print("\n[dim]Type [bold]?[/bold] for commands. Type anything else to whisper.[/dim]")
    try:
        while running:
            try:
                cmd = input().strip()
            except EOFError:
                break

            if not cmd or not running:
                continue

            parts = cmd.split(None, 1)
            cmd_name = parts[0].lower() if parts else ""
            cmd_arg = parts[1].strip() if len(parts) > 1 else ""

            if cmd_name in ("q", "quit", "exit"):
                break
            elif cmd_name in ("w", "whisper"):
                if not cmd_arg:
                    console.print("[red]Usage: w <message>[/red]")
                elif attached_to:
                    ws.send(json.dumps({"cmd": "whisper", "text": cmd_arg}))
                else:
                    ws.send(json.dumps({"cmd": "director", "text": cmd_arg}))
            elif cmd_name in ("a", "attach", "switch"):
                if not cmd_arg:
                    console.print("[red]Usage: a <character_name>[/red]")
                else:
                    ws.send(json.dumps({"cmd": "attach", "character": cmd_arg}))
            elif cmd_name in ("d", "detach"):
                ws.send(json.dumps({"cmd": "detach"}))
            elif cmd_name in ("c", "chars", "characters"):
                ws.send(json.dumps({"cmd": "list"}))
            elif cmd_name in ("n", "next"):
                ws.send(json.dumps({"cmd": "page"}))
            elif cmd_name in ("p", "pause"):
                ws.send(json.dumps({"cmd": "toggle_pause"}))
            elif cmd_name in ("world",):
                ws.send(json.dumps({"cmd": "world"}))
            elif cmd_name in ("?", "help"):
                console.print(
                    Panel(
                        "[bold bright_cyan]STORY[/]\n"
                        "  [bold]w[/] [dim]<text>[/]             Whisper (to character if attached, narrator if not)\n"
                        "  [bold]n[/], [bold]next[/]             Trigger next page\n"
                        "\n"
                        "[bold bright_cyan]CHARACTERS[/]\n"
                        "  [bold]a[/] [dim]<name>[/]             Attach to character\n"
                        "  [bold]d[/]                  Detach\n"
                        "  [bold]c[/]                  List characters\n"
                        "\n"
                        "[bold bright_cyan]SYSTEM[/]\n"
                        "  [bold]p[/]                  Pause/resume\n"
                        "  [bold]world[/]              World state\n"
                        "  [bold]q[/]                  Disconnect",
                        title="[bold]Attach Commands[/]",
                        border_style="bright_cyan",
                        padding=(0, 2),
                    )
                )
            else:
                console.print("[dim]Unknown command. Type [bold]?[/bold] for help.[/dim]")
    except KeyboardInterrupt:
        pass
    finally:
        running = False
        ws.close()
        console.print("[dim]Disconnected.[/dim]")


# ---------------------------------------------------------------------------
# CONNECT — connect to a remote Living Library server
# ---------------------------------------------------------------------------

@cli.command()
@click.argument("host")
@click.option("--port", default=8000, type=int, help="Server port (default: 8000)")
@click.option("--bookmark", default=None, help="Book bookmark to join")
@click.option("--nickname", default=None, help="Your display name")
@click.option("--librarian", default=None, help="Use existing librarian ID (from web session)")
def connect(host, port, bookmark, nickname, librarian):
    """Connect to a remote Living Library server.

    Examples:
        raunch connect localhost
        raunch connect raunch.example.com --port 8000
        raunch connect my-server.com --bookmark MILK-1234
    """
    import httpx

    # Build server URL
    if not host.startswith("http"):
        host = f"http://{host}"
    # Don't append port if host already has one or if using default HTTPS (443)
    if ":///" in host or host.count(":") >= 2:
        # URL already has a port
        server_url = host
    elif host.startswith("https://") and port == 8000:
        # HTTPS with default port — don't append (cloud services use 443)
        server_url = host
    elif port != 80 and port != 443:
        server_url = f"{host}:{port}"
    else:
        server_url = host

    # Get nickname
    if not nickname:
        nickname = os.environ.get("USER", os.environ.get("USERNAME", "Anonymous"))

    console.print(f"[cyan]Connecting to {server_url}...[/cyan]")

    # Check server health and type
    try:
        response = httpx.get(f"{server_url}/health", timeout=5.0)
        response.raise_for_status()
        health = response.json()

        server_type = health.get("server")
        server_version = health.get("version", "unknown")

        if server_type != "raunch":
            console.print(f"[red]Not a Raunch server (got: {server_type or 'unknown'})[/red]")
            console.print("[dim]Make sure you're connecting to a Raunch Living Library server.[/dim]")
            return

        console.print(f"[green]Found Raunch server v{server_version}[/green]")

    except httpx.ConnectError:
        console.print(f"[red]Cannot connect to {server_url}[/red]")
        console.print("[dim]Check the server is running and the address is correct.[/dim]")
        return
    except httpx.HTTPStatusError as e:
        console.print(f"[red]Server error: {e.response.status_code}[/red]")
        return
    except Exception as e:
        console.print(f"[red]Connection error: {e}[/red]")
        return

    try:
        client = RemoteClient(server_url, nickname=nickname, librarian_id=librarian)
        console.print(f"[green]Connected as {nickname}[/green]")
        console.print(f"[dim]Librarian ID: {client.librarian_id}[/dim]")
    except Exception as e:
        console.print(f"[red]Failed to connect: {e}[/red]")
        return

    # If bookmark provided, join that book
    if bookmark:
        try:
            book_id = client.join_book(bookmark)
            console.print(f"[green]Joined book: {book_id}[/green]")
        except Exception as e:
            console.print(f"[red]Failed to join book: {e}[/red]")
            return
    else:
        # List available books or create new one
        books = client.list_books()
        if books:
            console.print("\n[bold]Your Books:[/bold]")
            for i, book in enumerate(books, 1):
                console.print(f"  {i}. {book.scenario_name} [{book.bookmark}] - {book.page_count} pages")

            console.print("\n[dim]Enter number to join, 'new' to create, or 'q' to quit[/dim]")
            try:
                choice = input("> ").strip().lower()
            except (EOFError, KeyboardInterrupt):
                return

            if choice == 'q':
                return
            elif choice == 'new':
                _connect_create_book(client)
            elif choice.isdigit() and 1 <= int(choice) <= len(books):
                book = books[int(choice) - 1]
                client.join_book(book.bookmark)
                console.print(f"[green]Joined: {book.scenario_name}[/green]")
            else:
                console.print("[red]Invalid choice[/red]")
                return
        else:
            console.print("[dim]No books yet. Creating a new one...[/dim]")
            _connect_create_book(client)

    # Now we're connected to a book - start interactive session
    if not client.book_id:
        console.print("[red]No book selected[/red]")
        return

    _connect_interactive_loop(client)


def _connect_create_book(client: RemoteClient) -> None:
    """Create a new book on remote server."""
    from .wizard import list_scenarios

    scenarios = list_scenarios()
    if not scenarios:
        console.print("[yellow]No scenarios available on this server[/yellow]")
        return

    console.print("\n[bold]Available Scenarios:[/bold]")
    for i, s in enumerate(scenarios, 1):
        console.print(f"  {i}. {s['name']}")

    try:
        choice = input("\nChoose scenario > ").strip()
    except (EOFError, KeyboardInterrupt):
        return

    if choice.isdigit() and 1 <= int(choice) <= len(scenarios):
        scenario = scenarios[int(choice) - 1]
        book_id, bookmark = client.open_book(scenario['file'].replace('.json', ''))
        console.print(f"[green]Created book: {bookmark}[/green]")
        console.print(f"[dim]Share this code with friends to let them join![/dim]")


def _connect_interactive_loop(client: RemoteClient) -> None:
    """Interactive session for remote connection."""
    # Connect WebSocket
    try:
        client.connect_ws()
        reader = client.join_as_reader(client.nickname)
        console.print(f"[green]Joined as reader: {reader.nickname}[/green]")
    except Exception as e:
        console.print(f"[red]WebSocket error: {e}[/red]")
        return

    # Register page callback
    def on_page(page: Page):
        console.print(f"\n[bold cyan]── Page {page.page_num} ──[/bold cyan]")
        console.print(page.narration)
        for name, char in page.characters.items():
            if char.dialogue:
                console.print(f"  [bold]{name}:[/bold] \"{char.dialogue}\"")

    client.on_page(on_page)

    # Show help
    console.print(
        Panel(
            "[bold bright_cyan]STORY[/]\n"
            "  [bold]n[/], [bold]next[/], Enter  [dim]─[/]  Trigger next page\n"
            "  [bold]p[/], [bold]pause[/]        [dim]─[/]  Pause/resume\n"
            "  [bold]t[/] <sec>          [dim]─[/]  Set page interval (0=manual)\n"
            "\n"
            "[bold bright_cyan]CHARACTERS[/]\n"
            "  [bold]c[/], [bold]characters[/]   [dim]─[/]  List characters\n"
            "  [bold]a[/] <name>         [dim]─[/]  Attach to character\n"
            "  [bold]d[/]                [dim]─[/]  Detach\n"
            "  [bold]w[/] <text>         [dim]─[/]  Whisper to attached character\n"
            "  [bold]>[/] <text>         [dim]─[/]  Submit action\n"
            "\n"
            "[bold bright_cyan]BOOKS[/]\n"
            "  [bold]books[/]             [dim]─[/]  List your books\n"
            "  [bold]delete[/] <id>       [dim]─[/]  Delete a book\n"
            "  [bold]switch[/] <bookmark> [dim]─[/]  Switch to another book\n"
            "\n"
            "[bold bright_cyan]SYSTEM[/]\n"
            "  [bold]?[/], [bold]help[/]          [dim]─[/]  Show commands\n"
            "  [bold]q[/]                [dim]─[/]  Quit",
            title="[bold]Remote Session[/]",
            border_style="bright_cyan",
            padding=(0, 2),
        )
    )

    # Input loop
    try:
        while True:
            try:
                cmd = input("> ").strip()
            except EOFError:
                break

            if not cmd:
                # Empty = next page
                try:
                    client.trigger_page()
                    console.print("[dim]Page triggered...[/dim]")
                except Exception as e:
                    console.print(f"[red]{e}[/red]")
                continue

            parts = cmd.split(None, 1)
            cmd_name = parts[0].lower()
            cmd_arg = parts[1] if len(parts) > 1 else ""

            if cmd_name in ('n', 'next'):
                # Trigger next page
                try:
                    client.trigger_page()
                    console.print("[dim]Page triggered...[/dim]")
                except Exception as e:
                    console.print(f"[red]{e}[/red]")
                continue
            elif cmd_name in ('q', 'quit', 'exit'):
                break
            elif cmd_name in ('p', 'pause'):
                # Toggle pause
                try:
                    book = client.get_book()
                    if book and book.paused:
                        client.resume()
                        console.print("[green]Resumed[/green]")
                    else:
                        client.pause()
                        console.print("[yellow]Paused[/yellow]")
                except Exception as e:
                    console.print(f"[red]{e}[/red]")
            elif cmd_name in ('t', 'timer'):
                # Set page interval
                try:
                    seconds = int(cmd_arg) if cmd_arg else 0
                    client.set_page_interval(seconds)
                    if seconds == 0:
                        console.print("[dim]Manual mode[/dim]")
                    else:
                        console.print(f"[dim]Page every {seconds}s[/dim]")
                except ValueError:
                    console.print("[red]Usage: t <seconds>[/red]")
                except Exception as e:
                    console.print(f"[red]{e}[/red]")
            elif cmd_name in ('c', 'chars', 'characters'):
                chars = client.list_characters()
                for c in chars:
                    attached = " [attached]" if c.name == client._attached_to else ""
                    console.print(f"  {c.name}{attached}")
            elif cmd_name in ('a', 'attach'):
                if not cmd_arg:
                    console.print("[red]Usage: a <character_name>[/red]")
                else:
                    try:
                        client.attach(cmd_arg)
                        console.print(f"[green]Attached to {cmd_arg}[/green]")
                    except Exception as e:
                        console.print(f"[red]{e}[/red]")
            elif cmd_name in ('d', 'detach'):
                client.detach()
                console.print("[dim]Detached[/dim]")
            elif cmd_name in ('w', 'whisper'):
                if not cmd_arg:
                    console.print("[red]Usage: w <whisper text>[/red]")
                else:
                    try:
                        client.whisper(cmd_arg)
                        console.print("[dim]Whispered[/dim]")
                    except Exception as e:
                        console.print(f"[red]{e}[/red]")
            elif cmd_name.startswith('>'):
                # Action - include the > in the text if needed
                action_text = cmd[1:].strip() if cmd.startswith('>') else cmd_arg
                if action_text:
                    try:
                        client.action(action_text)
                        console.print("[dim]Action submitted[/dim]")
                    except Exception as e:
                        console.print(f"[red]{e}[/red]")
            elif cmd_name in ('books', 'library'):
                # List books
                try:
                    books_list = client.list_books()
                    books_data = [
                        {
                            "id": b.book_id,
                            "scenario_name": b.scenario_name,
                            "bookmark": b.bookmark,
                            "page_count": b.page_count,
                            "paused": b.paused,
                            "is_owner": True,
                        }
                        for b in books_list
                    ]
                    render_books_list(books_data, animated=False)
                except Exception as e:
                    console.print(f"[red]Could not list books: {e}[/red]")
            elif cmd_name == 'delete':
                # Delete a book
                if not cmd_arg:
                    console.print("[red]Usage: delete <book_id or bookmark>[/red]")
                else:
                    try:
                        # Find the book first
                        books_list = client.list_books()
                        target = None
                        for b in books_list:
                            if b.book_id.startswith(cmd_arg) or b.bookmark.upper() == cmd_arg.upper():
                                target = b
                                break

                        if not target:
                            console.print(f"[red]Book not found: {cmd_arg}[/red]")
                        else:
                            console.print(f"[yellow]Delete:[/yellow] {target.scenario_name}")
                            confirm = input("Type 'delete' to confirm: ").strip().lower()
                            if confirm == 'delete':
                                client.delete_book(target.book_id)
                                render_book_deleted(target.scenario_name, animated=True)
                            else:
                                console.print("[dim]Cancelled[/dim]")
                    except Exception as e:
                        console.print(f"[red]{e}[/red]")
            elif cmd_name == 'switch':
                # Switch to another book
                if not cmd_arg:
                    console.print("[red]Usage: switch <bookmark>[/red]")
                else:
                    try:
                        client.disconnect()
                        book_id = client.join_book(cmd_arg)
                        book = client.get_book_info(book_id)
                        render_book_joined(book.scenario_name if book else "Unknown", cmd_arg, animated=True)
                        client.connect_ws()
                        client.join_as_reader(client.nickname)
                    except Exception as e:
                        console.print(f"[red]Could not switch: {e}[/red]")
            elif cmd_name in ('?', 'help'):
                # Redisplay help
                console.print(
                    Panel(
                        "[bold bright_cyan]STORY[/]\n"
                        "  [bold]n[/], [bold]next[/], Enter  [dim]─[/]  Trigger next page\n"
                        "  [bold]p[/], [bold]pause[/]        [dim]─[/]  Pause/resume\n"
                        "  [bold]t[/] <sec>          [dim]─[/]  Set page interval\n"
                        "\n"
                        "[bold bright_cyan]CHARACTERS[/]\n"
                        "  [bold]c[/]                [dim]─[/]  List characters\n"
                        "  [bold]a[/] <name>         [dim]─[/]  Attach\n"
                        "  [bold]d[/]                [dim]─[/]  Detach\n"
                        "  [bold]w[/] <text>         [dim]─[/]  Whisper\n"
                        "\n"
                        "[bold bright_cyan]BOOKS[/]\n"
                        "  [bold]books[/]             [dim]─[/]  List books\n"
                        "  [bold]delete[/] <id>       [dim]─[/]  Delete book\n"
                        "  [bold]switch[/] <bookmark> [dim]─[/]  Switch books\n"
                        "\n"
                        "[bold]q[/]  Quit",
                        title="[bold]Commands[/]",
                        border_style="bright_cyan",
                        padding=(0, 2),
                    )
                )
            else:
                # Treat as action
                try:
                    client.action(cmd)
                    console.print("[dim]Action submitted[/dim]")
                except Exception as e:
                    console.print(f"[red]{e}[/red]")

    except KeyboardInterrupt:
        pass
    finally:
        client.disconnect()
        console.print("[dim]Disconnected[/dim]")


# ---------------------------------------------------------------------------
# PLAY — local single-player mode using LocalClient
# ---------------------------------------------------------------------------

@cli.command()
@click.argument("scenario")
@click.option("--name", "nickname", default=None, help="Your display name")
def play(scenario, nickname):
    """Play a scenario locally (single-player mode).

    This runs the game entirely on your machine without a server.

    Examples:
        raunch play milk_money
        raunch play my_scenario --name "Boss"
    """
    if not nickname:
        nickname = os.environ.get("USER", os.environ.get("USERNAME", "Player"))

    console.print(f"[cyan]Loading scenario: {scenario}[/cyan]")

    try:
        client = LocalClient(nickname=nickname)
        book_id, bookmark = client.open_book(scenario)
        console.print(f"[green]Book opened: {bookmark}[/green]")
    except ValueError as e:
        console.print(f"[red]Error: {e}[/red]")
        return
    except Exception as e:
        console.print(f"[red]Failed to start: {e}[/red]")
        return

    # Show characters
    chars = client.list_characters()
    console.print(f"\n[bold]Characters:[/bold]")
    for c in chars:
        console.print(f"  * {c.name} ({c.species})")

    # Register page callback
    def on_page(page: Page):
        console.print(f"\n[bold bright_magenta]--- Page {page.page_num} ---[/bold bright_magenta]")
        console.print(f"[dim]{page.mood} | {page.world_time}[/dim]\n")
        console.print(page.narration)
        console.print()
        for name, char in page.characters.items():
            if char.action or char.dialogue:
                action_text = char.action or ""
                dialogue_text = f'"{char.dialogue}"' if char.dialogue else ""
                console.print(f"  [bold]{name}[/bold] {action_text} {dialogue_text}")

    client.on_page(on_page)

    # Show help
    console.print(
        Panel(
            "[bold]Commands:[/bold]\n"
            "  [bold]n[/bold], Enter       Next page (manual mode)\n"
            "  [bold]p[/bold]              Pause/resume\n"
            "  [bold]t[/bold] <seconds>    Set page interval (0=manual)\n"
            "  [bold]c[/bold]              List characters\n"
            "  [bold]a[/bold] <name>       Attach to character\n"
            "  [bold]d[/bold]              Detach\n"
            "  [bold]w[/bold] <text>       Whisper to character\n"
            "  [bold]>[/bold] <text>       Submit action\n"
            "  [bold]q[/bold]              Quit",
            title="Local Play",
            border_style="bright_magenta",
        )
    )

    # Start orchestrator
    client.start()
    console.print("[green]Game started! Press Enter to advance pages.[/green]")

    # Input loop
    try:
        while True:
            try:
                cmd = input("> ").strip()
            except EOFError:
                break

            parts = cmd.split(None, 1)
            cmd_name = parts[0].lower() if parts else ""
            cmd_arg = parts[1] if len(parts) > 1 else ""

            if cmd_name in ('q', 'quit', 'exit'):
                break
            elif not cmd or cmd_name in ('n', 'next'):
                if client.trigger_page():
                    console.print("[dim]Generating page...[/dim]")
                else:
                    console.print("[yellow]Cannot generate page (already running or paused)[/yellow]")
            elif cmd_name in ('p', 'pause'):
                book = client.get_book()
                if book and book.paused:
                    client.resume()
                    console.print("[green]Resumed[/green]")
                else:
                    client.pause()
                    console.print("[yellow]Paused[/yellow]")
            elif cmd_name in ('t', 'timer', 'interval'):
                if cmd_arg:
                    try:
                        seconds = int(cmd_arg)
                        client.set_page_interval(seconds)
                        if seconds == 0:
                            console.print("[green]Manual mode[/green]")
                        else:
                            console.print(f"[green]Interval: {seconds}s[/green]")
                    except ValueError:
                        console.print("[red]Usage: t <seconds>[/red]")
            elif cmd_name in ('c', 'chars', 'characters'):
                chars = client.list_characters()
                for c in chars:
                    attached = " [attached]" if c.name == client._attached_to else ""
                    console.print(f"  {c.name} ({c.species}){attached}")
            elif cmd_name in ('a', 'attach'):
                if not cmd_arg:
                    console.print("[red]Usage: a <character_name>[/red]")
                else:
                    try:
                        client.attach(cmd_arg)
                        console.print(f"[green]Attached to {cmd_arg}[/green]")
                    except Exception as e:
                        console.print(f"[red]{e}[/red]")
            elif cmd_name in ('d', 'detach'):
                client.detach()
                console.print("[dim]Detached[/dim]")
            elif cmd_name in ('w', 'whisper'):
                if not cmd_arg:
                    console.print("[red]Usage: w <whisper text>[/red]")
                else:
                    try:
                        client.whisper(cmd_arg)
                        console.print("[dim]Whispered[/dim]")
                    except Exception as e:
                        console.print(f"[red]{e}[/red]")
            elif cmd_name.startswith('>') or cmd_arg:
                # Action
                action_text = cmd[1:].strip() if cmd.startswith('>') else cmd
                if action_text:
                    try:
                        client.action(action_text)
                        console.print("[dim]Action submitted[/dim]")
                    except Exception as e:
                        console.print(f"[red]{e}[/red]")
            else:
                console.print("[dim]Unknown command. Type 'q' to quit.[/dim]")

    except KeyboardInterrupt:
        pass
    finally:
        client.stop()
        console.print("[dim]Game ended.[/dim]")


# ---------------------------------------------------------------------------
# KILL — stop any running servers
# ---------------------------------------------------------------------------

@cli.command()
def kill():
    """Kill any running raunch server processes."""
    console.print("[yellow]Looking for raunch processes...[/yellow]")
    killed = _kill_raunch_servers()

    if killed > 0:
        console.print(f"[green]Killed {killed} process(es)[/green]")
    else:
        console.print("[dim]No raunch processes found.[/dim]")


@cli.command("purge")
@click.option("--yes", "-y", is_flag=True, help="Skip confirmation")
def purge(yes):
    """Hard reset — wipe all books, saves, and user scenarios. Keeps built-in scenarios."""
    import shutil
    from .config import SAVES_DIR

    if not yes:
        console.print("[bold red]This will delete:[/bold red]")
        console.print("  - All books in the database")
        console.print("  - All save files (character memories, world state)")
        console.print("  - All user-created scenarios")
        console.print()
        console.print("[dim]Built-in scenarios (scenarios/ folder) will be kept.[/dim]")
        console.print()
        try:
            confirm = input("Type 'purge' to confirm: ").strip()
        except (EOFError, KeyboardInterrupt):
            return
        if confirm.lower() != "purge":
            console.print("[dim]Cancelled.[/dim]")
            return

    deleted = {"books": 0, "saves": 0, "scenarios": 0}

    # 1. Wipe books from database
    try:
        from .db_sqlite import _get_conn
        conn = _get_conn()
        # Count before delete
        count = conn.execute("SELECT COUNT(*) FROM books").fetchone()[0]
        conn.execute("DELETE FROM books")
        conn.execute("DELETE FROM pages")
        conn.execute("DELETE FROM character_pages")
        conn.execute("DELETE FROM librarians")
        conn.commit()
        deleted["books"] = count
        console.print(f"[green]Deleted {count} books from database[/green]")
    except Exception as e:
        console.print(f"[yellow]Could not clear database: {e}[/yellow]")

    # 2. Wipe save files
    try:
        save_files = [f for f in os.listdir(SAVES_DIR) if f.endswith(".json")]
        for f in save_files:
            os.remove(os.path.join(SAVES_DIR, f))
        deleted["saves"] = len(save_files)
        console.print(f"[green]Deleted {len(save_files)} save files[/green]")
    except Exception as e:
        console.print(f"[yellow]Could not clear saves: {e}[/yellow]")

    # 3. Wipe user scenarios from database (not file-based ones)
    try:
        from .db_sqlite import _get_conn
        conn = _get_conn()
        count = conn.execute("SELECT COUNT(*) FROM scenarios").fetchone()[0]
        conn.execute("DELETE FROM scenarios")
        conn.commit()
        deleted["scenarios"] = count
        console.print(f"[green]Deleted {count} user scenarios from database[/green]")
    except Exception as e:
        # Table might not exist
        pass

    total = sum(deleted.values())
    if total > 0:
        console.print(f"\n[bold green]Purge complete.[/bold green]")
    else:
        console.print("[dim]Nothing to purge.[/dim]")


# ---------------------------------------------------------------------------
# BOOK MANAGEMENT — Premium library experience
# ---------------------------------------------------------------------------

@cli.group(invoke_without_command=True)
@click.option("--server", "-s", default=None, help="Server URL (default: localhost:8000)")
@click.option("--quick", "-q", is_flag=True, help="Skip animations")
@click.pass_context
def books(ctx, server, quick):
    """Manage your book library — list, join, delete, and resume books.

    Examples:
        raunch books              # List your books
        raunch books list         # Same as above
        raunch books info abc123  # View book details
        raunch books join MILK-1A # Join via bookmark
        raunch books delete abc1  # Delete a book
    """
    ctx.ensure_object(dict)
    ctx.obj["server"] = server or os.environ.get("RAUNCH_SERVER", "http://localhost:8000")
    ctx.obj["quick"] = quick

    # If no subcommand, show books list
    if ctx.invoked_subcommand is None:
        ctx.invoke(books_list)


@books.command("list")
@click.pass_context
def books_list(ctx):
    """List all your books."""
    server_url = ctx.obj.get("server", "http://localhost:8000")
    quick = ctx.obj.get("quick", False)

    # Try local database first
    books_data = []
    try:
        from .db_sqlite import _get_conn
        conn = _get_conn()
        rows = conn.execute("""
            SELECT id, scenario_name, bookmark, page_count, paused, owner_id, created_at
            FROM books
            ORDER BY created_at DESC
            LIMIT 50
        """).fetchall()
        books_data = [dict(r) for r in rows]
    except Exception:
        pass

    # Fall back to remote API
    if not books_data:
        try:
            client = RemoteClient(server_url)
            books_list_result = client.list_books()
            books_data = [
                {
                    "id": b.book_id,
                    "scenario_name": b.scenario_name,
                    "bookmark": b.bookmark,
                    "page_count": b.page_count,
                    "paused": b.paused,
                    "is_owner": True,
                }
                for b in books_list_result
            ]
        except Exception as e:
            console.print(f"[red]Could not fetch books: {e}[/red]")
            console.print(f"[dim]Server: {server_url}[/dim]")
            return

    render_books_list(books_data, animated=not quick)


@books.command("info")
@click.argument("book_id")
@click.pass_context
def books_info(ctx, book_id):
    """View detailed book information."""
    server_url = ctx.obj.get("server", "http://localhost:8000")
    quick = ctx.obj.get("quick", False)

    # Try local database first
    book_data = None
    try:
        from .db_sqlite import _get_conn
        conn = _get_conn()

        # Match by ID prefix or bookmark
        row = conn.execute("""
            SELECT id, scenario_name, bookmark, page_count, paused, owner_id, created_at
            FROM books
            WHERE id LIKE ? OR UPPER(bookmark) = UPPER(?)
            LIMIT 1
        """, (f"{book_id}%", book_id)).fetchone()

        if row:
            book_data = dict(row)
            # Get characters for this book
            # TODO: fetch from book state if available
    except Exception:
        pass

    # Fall back to remote API
    if not book_data:
        try:
            client = RemoteClient(server_url)
            book = client.get_book_info(book_id)
            if book:
                book_data = {
                    "id": book.book_id,
                    "scenario_name": book.scenario_name,
                    "bookmark": book.bookmark,
                    "page_count": book.page_count,
                    "paused": book.paused,
                    "characters": book.characters,
                }
        except Exception as e:
            console.print(f"[red]Could not fetch book: {e}[/red]")
            return

    if not book_data:
        console.print(f"[red]Book not found: {book_id}[/red]")
        return

    render_book_info(book_data, animated=not quick)


@books.command("delete")
@click.argument("book_id")
@click.option("--yes", "-y", is_flag=True, help="Skip confirmation")
@click.pass_context
def books_delete(ctx, book_id, yes):
    """Delete a book you own."""
    server_url = ctx.obj.get("server", "http://localhost:8000")
    quick = ctx.obj.get("quick", False)

    # Find the book first
    book_data = None
    try:
        from .db_sqlite import _get_conn
        conn = _get_conn()

        row = conn.execute("""
            SELECT id, scenario_name, bookmark, page_count
            FROM books
            WHERE id LIKE ? OR UPPER(bookmark) = UPPER(?)
            LIMIT 1
        """, (f"{book_id}%", book_id)).fetchone()

        if row:
            book_data = dict(row)
    except Exception:
        pass

    if not book_data:
        console.print(f"[red]Book not found: {book_id}[/red]")
        console.print("[dim]Use 'raunch books' to see your books.[/dim]")
        return

    scenario_name = book_data.get("scenario_name", "Unknown")
    full_id = book_data.get("id")

    # Confirmation
    if not yes:
        console.print(f"\n[yellow]Delete book:[/yellow] [bold]{scenario_name}[/]")
        console.print(f"[dim]ID: {full_id}[/dim]")
        console.print(f"[dim]Pages: {book_data.get('page_count', 0)}[/dim]")
        console.print()
        try:
            confirm = input("Type 'delete' to confirm: ").strip().lower()
        except (EOFError, KeyboardInterrupt):
            console.print("\n[dim]Cancelled.[/dim]")
            return
        if confirm != "delete":
            console.print("[dim]Cancelled.[/dim]")
            return

    # Delete from database
    try:
        from .db_sqlite import _get_conn
        conn = _get_conn()

        # Delete related data
        conn.execute("DELETE FROM pages WHERE world_id = ?", (full_id,))
        conn.execute("DELETE FROM character_pages WHERE world_id = ?", (full_id,))
        conn.execute("DELETE FROM potential_characters WHERE world_id = ?", (full_id,))
        conn.execute("DELETE FROM books WHERE id = ?", (full_id,))
        conn.commit()

        render_book_deleted(scenario_name, animated=not quick)
    except Exception as e:
        console.print(f"[red]Delete failed: {e}[/red]")

        # Try remote delete
        try:
            client = RemoteClient(server_url)
            client.delete_book(full_id)
            render_book_deleted(scenario_name, animated=not quick)
        except Exception as e2:
            console.print(f"[red]Remote delete also failed: {e2}[/red]")


@books.command("join")
@click.argument("bookmark")
@click.pass_context
def books_join(ctx, bookmark):
    """Join a book via bookmark code."""
    server_url = ctx.obj.get("server", "http://localhost:8000")
    quick = ctx.obj.get("quick", False)

    try:
        client = RemoteClient(server_url)
        book_id = client.join_book(bookmark)

        # Get book info
        book = client.get_book_info(book_id)
        scenario_name = book.scenario_name if book else "Unknown"

        render_book_joined(scenario_name, bookmark, animated=not quick)

        console.print(f"[dim]Book ID: {book_id}[/dim]")
        console.print(f"\n[bold]Start playing:[/bold]")
        console.print(f"  raunch attach --book {book_id}")

    except Exception as e:
        console.print(f"[red]Could not join: {e}[/red]")
        console.print(f"[dim]Bookmark: {bookmark} | Server: {server_url}[/dim]")


@books.command("resume")
@click.argument("book_id")
@click.pass_context
def books_resume(ctx, book_id):
    """Resume a previous book session."""
    server_url = ctx.obj.get("server", "http://localhost:8000")

    # Find the book
    book_data = None
    try:
        from .db_sqlite import _get_conn
        conn = _get_conn()

        row = conn.execute("""
            SELECT id, scenario_name, bookmark
            FROM books
            WHERE id LIKE ? OR UPPER(bookmark) = UPPER(?)
            LIMIT 1
        """, (f"{book_id}%", book_id)).fetchone()

        if row:
            book_data = dict(row)
    except Exception:
        pass

    if not book_data:
        console.print(f"[red]Book not found: {book_id}[/red]")
        return

    full_id = book_data.get("id")
    scenario_name = book_data.get("scenario_name")

    console.print(f"\n[cyan]Resuming: {scenario_name}[/cyan]")
    console.print(f"[dim]Book ID: {full_id}[/dim]")
    console.print()

    # Hand off to attach command
    ctx.invoke(attach, character=None, host="localhost", port=8000, book_id=full_id)


@books.command("help")
def books_help():
    """Show book management commands."""
    render_books_menu()


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
            num_chars = rand.choice([1, 2, 2, 2, 3, 3, 4])  # Weighted toward 2
        elif choice.isdigit():
            num_chars = max(1, min(6, int(choice)))
        else:
            num_chars = 2  # Default fallback

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

    # ─── LANGUAGE ─────────────────────────────────────────────────────────
    LANGUAGES = [
        "English (default)",
        "Japanese (日本語)",
        "Spanish (Español)",
        "French (Français)",
        "German (Deutsch)",
        "Korean (한국어)",
        "Pirate Speak",
        "Elvish/Fantasy",
        "Formal Victorian",
    ]

    if not quick:
        sexy_prompt("In what tongue shall the tale be told?", "LANGUAGE")
    else:
        console.print("\n[bold bright_magenta]Output language?[/]")

    option_display(LANGUAGES) if not quick else [console.print(f"  [dim]{i:2}.[/] {v}") for i, v in enumerate(LANGUAGES, 1)]

    console.print()
    console.print("  [dim italic]Pick a number, type any language/style, or Enter for English[/]")

    try:
        lang_choice = input("\n  > ").strip()
    except (EOFError, KeyboardInterrupt):
        return

    if lang_choice.isdigit() and 1 <= int(lang_choice) <= len(LANGUAGES):
        language = LANGUAGES[int(lang_choice) - 1]
        if language.startswith("English"):
            language = None  # Default, don't need to specify
    elif lang_choice:
        language = lang_choice
    else:
        language = None  # Default English

    if language and not quick:
        selection_confirm(language, "Language")
    elif language:
        console.print(f"  [green]Language: {language}[/]")

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

    # Add multiplayer and language flags to scenario
    scenario["multiplayer"] = multiplayer
    if language:
        scenario["language"] = language

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
        roll_dice_with_generation, scenario_reveal, wizard_farewell
    )

    # Random character count if not specified (weighted toward 2)
    if num_chars is None:
        num_chars = rand.choice([1, 2, 2, 2, 3, 3, 4])

    def do_generate():
        return random_scenario(num_characters=num_chars, debug=debug)

    if not quick:
        # Start LLM generation immediately, dice animation runs in parallel
        try:
            scenario = roll_dice_with_generation(do_generate)
        except Exception as e:
            console.print(f"[red]The fates rejected your roll: {e}[/red]")
            return

        # Show what we rolled
        char_desc = {1: "solo", 2: "duo", 3: "trio", 4: "quartet"}.get(num_chars, f"{num_chars}-way")
        console.print(f"  [dim]The dice decreed:[/] [bold bright_magenta]{char_desc} encounter[/]\n")
    else:
        console.print(f"[bright_magenta]Rolling the dice... ({num_chars} characters)[/bright_magenta]")
        try:
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
