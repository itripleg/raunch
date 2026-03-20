"""WebSocket handler for real-time book interactions."""

import logging
from typing import Dict, Optional, Any

from fastapi import WebSocket, WebSocketDisconnect

from .library import get_library
from .models import Reader
from ..wizard import load_scenario
from ..agents import Character
from .. import db

logger = logging.getLogger(__name__)


class WSClient:
    """A connected WebSocket client."""

    def __init__(self, websocket: WebSocket, book_id: str):
        self.websocket = websocket
        self.book_id = book_id
        self.reader: Optional[Reader] = None

    async def send(self, data: Dict[str, Any]) -> None:
        """Send JSON message to client."""
        await self.websocket.send_json(data)

    async def send_error(self, code: str, message: str) -> None:
        """Send error message to client."""
        await self.send({"type": "error", "code": code, "message": message})


class WSManager:
    """Manages WebSocket connections per book."""

    def __init__(self):
        self.clients: Dict[str, Dict[str, WSClient]] = {}  # book_id -> {client_id -> client}
        self._client_counter = 0

    def add_client(self, book_id: str, client: WSClient) -> str:
        """Add a client to a book's connections. Returns client_id."""
        if book_id not in self.clients:
            self.clients[book_id] = {}
        self._client_counter += 1
        client_id = f"client_{self._client_counter}"
        self.clients[book_id][client_id] = client
        return client_id

    def remove_client(self, book_id: str, client_id: str) -> None:
        """Remove a client from a book's connections."""
        if book_id in self.clients:
            self.clients[book_id].pop(client_id, None)

    async def broadcast(self, book_id: str, data: Dict[str, Any], exclude: Optional[str] = None) -> None:
        """Broadcast message to all clients in a book."""
        if book_id not in self.clients:
            logger.warning(f"[BROADCAST] No clients registered for book {book_id}")
            return

        client_count = len(self.clients[book_id])
        logger.info(f"[BROADCAST] Sending to {client_count} client(s) for book {book_id}: type={data.get('type')}")
        for client_id, client in list(self.clients[book_id].items()):
            if client_id != exclude:
                try:
                    await client.send(data)
                except Exception as e:
                    logger.error(f"Failed to send to {client_id}: {e}")


# Global manager
ws_manager = WSManager()


def _ensure_orchestrator(book) -> bool:
    """Ensure book has an initialized orchestrator. Returns True if ready."""
    if book.orchestrator is not None:
        return True

    # Load scenario and create orchestrator
    scenario = load_scenario(book.scenario_name)
    if scenario is None:
        logger.error(f"Scenario '{book.scenario_name}' not found for book {book.book_id}")
        return False

    # Import here to avoid circular imports
    from ..orchestrator import Orchestrator

    orch = Orchestrator()

    # Apply scenario
    orch.world.scenario = scenario
    orch.world.world_name = scenario.get("scenario_name", orch.world.world_name)
    orch.world.world_id = book.book_id  # Use book_id as world_id
    orch.world.multiplayer = scenario.get("multiplayer", False)

    # Set location from scenario
    setting = scenario.get("setting", "")
    if setting:
        loc_name = scenario.get("scenario_name", "The Scene")
        orch.world.locations = {
            loc_name: {
                "description": setting,
                "characters": [],
            }
        }
        location = loc_name
    else:
        location = list(orch.world.locations.keys())[0] if orch.world.locations else "The Scene"

    # Create characters from scenario
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
        orch.add_character(char, location=location)

    # Restore page count from database so numbering continues correctly
    existing_page_count = db.get_page_count(book.book_id)
    if existing_page_count > 0:
        orch.world.page_count = existing_page_count
        logger.info(f"Restored page_count={existing_page_count} for book {book.book_id}")

    # Set up streaming callback - capture the event loop for thread-safe calls
    import asyncio
    try:
        main_loop = asyncio.get_running_loop()
    except RuntimeError:
        main_loop = None

    def stream_callback(page: int, source: str, event: str, content: str):
        if main_loop is None:
            return
        try:
            asyncio.run_coroutine_threadsafe(
                _broadcast_stream(book.book_id, page, source, event, content),
                main_loop
            )
        except Exception as e:
            logger.debug(f"Stream callback error: {e}")

    orch.set_stream_callback(stream_callback)

    # Set up narrator callback for progressive rendering (non-streaming mode)
    def narrator_callback(page: int, narration: str, mood: str):
        if main_loop is None:
            return
        try:
            asyncio.run_coroutine_threadsafe(
                _broadcast_narrator_ready(book.book_id, page, narration, mood),
                main_loop
            )
        except Exception as e:
            logger.debug(f"Narrator callback error: {e}")

    orch.set_narrator_callback(narrator_callback)

    # Set up character callback for progressive rendering (non-streaming mode)
    def character_callback(page: int, name: str, data: dict):
        if main_loop is None:
            return
        try:
            asyncio.run_coroutine_threadsafe(
                _broadcast_character_ready(book.book_id, page, name, data),
                main_loop
            )
        except Exception as e:
            logger.debug(f"Character callback error: {e}")

    orch.set_character_callback(character_callback)

    # Set up page callback to broadcast completed pages
    def page_callback(results: dict):
        logger.info(f"[CALLBACK] page_callback fired for book {book.book_id}, page {results.get('page')}, main_loop={main_loop is not None}")
        if main_loop is None:
            logger.warning(f"[CALLBACK] main_loop is None, cannot broadcast page {results.get('page')}")
            return
        try:
            asyncio.run_coroutine_threadsafe(
                _broadcast_page(book.book_id, results),
                main_loop
            )
            logger.info(f"[CALLBACK] Scheduled broadcast for page {results.get('page')}")
        except Exception as e:
            logger.error(f"Page callback error: {e}")

    orch.add_page_callback(page_callback)

    book.set_orchestrator(orch)

    # Start the orchestrator
    orch.start()

    logger.info(f"Initialized orchestrator for book {book.book_id} with {len(orch.characters)} characters")
    return True


async def _broadcast_stream(book_id: str, page: int, source: str, event: str, content: str):
    """Broadcast streaming event to all clients."""
    if event == "start":
        await ws_manager.broadcast(book_id, {
            "type": "page_start",
            "page": page,
        })
    elif event == "delta":
        await ws_manager.broadcast(book_id, {
            "type": "stream_delta",
            "page": page,
            "source": source,
            "delta": content,
        })
    elif event == "done":
        await ws_manager.broadcast(book_id, {
            "type": "stream_done",
            "page": page,
            "source": source,
        })


async def _broadcast_narrator_ready(book_id: str, page: int, narration: str, mood: str):
    """Broadcast narrator completion for progressive rendering (non-streaming mode)."""
    from datetime import datetime
    logger.info(f"[PROGRESSIVE] narrator_ready for page {page}, narration length: {len(narration)}")
    await ws_manager.broadcast(book_id, {
        "type": "narrator_ready",
        "page": page,
        "narration": narration,
        "mood": mood,
        "created_at": datetime.utcnow().isoformat() + "Z",
    })


async def _broadcast_character_ready(book_id: str, page: int, name: str, data: dict):
    """Broadcast character completion for progressive rendering (non-streaming mode)."""
    logger.info(f"[PROGRESSIVE] character_ready for page {page}, character: {name}")
    # Use the same extraction logic as DB save to handle raw/unparsed responses
    extracted = db._extract_character_fields(data)
    await ws_manager.broadcast(book_id, {
        "type": "character_ready",
        "page": page,
        "character": name,
        "data": {
            "action": extracted.get("action"),
            "dialogue": extracted.get("dialogue"),
            "emotional_state": extracted.get("emotional_state"),
            "inner_thoughts": extracted.get("inner_thoughts"),
            "desires_update": extracted.get("desires_update"),
        },
    })


async def _broadcast_page(book_id: str, results: dict):
    """Broadcast completed page to all clients."""
    from datetime import datetime

    logger.info(f"[BROADCAST] _broadcast_page called for book {book_id}, page {results.get('page')}")

    # Handle error results
    if "error" in results:
        await ws_manager.broadcast(book_id, {
            "type": "error",
            "message": results["error"],
        })
        return

    # Handle waiting for player
    if results.get("waiting_for_player"):
        return

    # Build page message
    page_msg = {
        "type": "page",
        "page": results.get("page"),
        "narration": results.get("narration", ""),
        "events": results.get("events", []),
        "characters": {},
        "created_at": datetime.utcnow().isoformat() + "Z",
    }

    # Add character data (use extraction logic to handle raw/unparsed responses)
    for cname, cdata in results.get("characters", {}).items():
        if isinstance(cdata, dict):
            extracted = db._extract_character_fields(cdata)
            page_msg["characters"][cname] = {
                "action": extracted.get("action"),
                "dialogue": extracted.get("dialogue"),
                "emotional_state": extracted.get("emotional_state"),
                "inner_thoughts": extracted.get("inner_thoughts"),
            }

    logger.info(f"[BROADCAST] Broadcasting page {page_msg.get('page')} to book {book_id}")
    await ws_manager.broadcast(book_id, page_msg)
    logger.info(f"[BROADCAST] Broadcast complete for page {page_msg.get('page')}")


async def handle_websocket(websocket: WebSocket, book_id: str):
    """Handle a WebSocket connection for a book."""
    await websocket.accept()

    library = get_library()
    book = library.get_book(book_id)

    if book is None:
        await websocket.send_json({
            "type": "error",
            "code": "not_found",
            "message": "Book not found"
        })
        await websocket.close()
        return

    # Ensure orchestrator is initialized
    if not _ensure_orchestrator(book):
        await websocket.send_json({
            "type": "error",
            "code": "init_failed",
            "message": f"Failed to initialize scenario '{book.scenario_name}'"
        })
        await websocket.close()
        return

    client = WSClient(websocket=websocket, book_id=book_id)
    client_id = ws_manager.add_client(book_id, client)

    # Send welcome message
    orch = book.orchestrator
    world = orch.world

    # Get recent history from database
    history = []
    try:
        logger.info(f"[History] Looking up pages for book_id={book_id}, world.world_id={world.world_id}")
        history_data = db.get_page_history(book_id, limit=20)
        logger.info(f"[History] Loaded {len(history_data)} pages for book {book_id}")
        for h in history_data:
            history.append({
                "page": h["page"],
                "narration": h["narration"],
                "events": h.get("events", []),
                "world_time": h.get("world_time"),
                "mood": h.get("mood"),
                "created_at": h.get("created_at"),
                "characters": h.get("characters", {}),
            })
    except Exception as e:
        logger.warning(f"Failed to load history for book {book_id}: {e}")

    await client.send({
        "type": "welcome",
        "world": {
            "world_id": world.world_id,
            "world_name": world.world_name,
            "page_count": world.page_count,
            "world_time": world.world_time,
            "mood": world.mood,
            "multiplayer": world.multiplayer,
        },
        "characters": list(orch.characters.keys()),
        "history": history,
        "paused": orch._paused,
        "page_interval": orch.page_interval,
        "manual": orch.page_interval == 0,
    })

    try:
        while True:
            data = await websocket.receive_json()
            await handle_command(client, book, data)

    except WebSocketDisconnect:
        if client.reader:
            book.remove_reader(client.reader.reader_id)
            await ws_manager.broadcast(book_id, {
                "type": "reader_left",
                "reader_id": client.reader.reader_id,
            }, exclude=client_id)
        ws_manager.remove_client(book_id, client_id)

    except Exception as e:
        logger.error(f"WebSocket error: {e}")
        ws_manager.remove_client(book_id, client_id)
        await websocket.close()


async def handle_command(client: WSClient, book, data: Dict[str, Any]) -> None:
    """Handle a WebSocket command."""
    cmd = data.get("cmd")
    orch = book.orchestrator

    if cmd == "join":
        nickname = data.get("nickname", "Anonymous")
        reader = Reader.create(nickname)
        client.reader = reader
        book.add_reader(reader)

        await client.send({
            "type": "joined",
            "reader_id": reader.reader_id,
            "nickname": reader.nickname,
        })

        await ws_manager.broadcast(book.book_id, {
            "type": "reader_joined",
            "reader_id": reader.reader_id,
            "nickname": reader.nickname,
        })

    elif cmd == "attach":
        if not client.reader:
            await client.send_error("not_joined", "Join first")
            return

        character = data.get("character", "").strip()
        if not character:
            await client.send_error("invalid_command", "Character name required")
            return

        # Fuzzy match: case-insensitive prefix matching
        matched_name = None
        if orch:
            for name in orch.characters:
                if name.lower().startswith(character.lower()):
                    matched_name = name
                    break

        if not matched_name:
            await client.send_error("not_found", f"Character '{character}' not found")
            return

        character = matched_name  # Use the actual name

        existing = book.get_reader_by_character(character)
        if existing and existing.reader_id != client.reader.reader_id:
            # Only block in multiplayer with an active connection
            is_multiplayer = book.orchestrator and getattr(book.orchestrator, 'multiplayer', False)
            # Check if the other reader still has an active WebSocket
            other_still_connected = any(
                c.reader and c.reader.reader_id == existing.reader_id
                for clients in ws_manager.clients.get(book.book_id, {}).values()
                for c in [clients]
            )
            if is_multiplayer and other_still_connected:
                await client.send_error(
                    "character_taken",
                    f"{character} is controlled by another reader"
                )
                return
            # Stale reader or solo mode — detach them silently
            existing.attached_to = None

        client.reader.attached_to = character
        await client.send({"type": "attached", "character": character})

    elif cmd == "detach":
        if client.reader:
            client.reader.attached_to = None
            await client.send({"type": "detached"})

    elif cmd == "world":
        if orch:
            world = orch.world
            await client.send({
                "type": "world",
                "snapshot": {
                    "world_id": world.world_id,
                    "world_name": world.world_name,
                    "page_count": world.page_count,
                    "world_time": world.world_time,
                    "mood": world.mood,
                }
            })

    elif cmd == "list":
        if orch:
            chars = {}
            for name, char in orch.characters.items():
                chars[name] = {
                    "species": char.character_data.get("species"),
                    "emotional_state": char.emotional_state,
                    "location": char.location,
                }
            await client.send({"type": "characters", "characters": chars})

    elif cmd == "status":
        if orch:
            await client.send({
                "type": "status",
                "paused": orch._paused,
                "page_interval": orch.page_interval,
                "page_count": orch.world.page_count if orch.world else 0,
            })

    elif cmd == "history":
        count = data.get("count", 20)
        offset = data.get("offset", 0)
        try:
            history_data = db.get_page_history(book.book_id, limit=count, offset=offset)
            pages = []
            for h in history_data:
                pages.append({
                    "page": h["page"],
                    "narration": h["narration"],
                    "events": h.get("events", []),
                    "world_time": h.get("world_time"),
                    "mood": h.get("mood"),
                    "created_at": h.get("created_at"),
                    "characters": h.get("characters", {}),
                })
            await client.send({"type": "history", "pages": pages})
        except Exception as e:
            logger.error(f"Failed to get history: {e}")
            await client.send({"type": "history", "pages": []})

    elif cmd == "page":
        # Trigger manual page generation
        if orch:
            orch.trigger_page()
            await client.send({"type": "ok", "message": "Page triggered"})

    elif cmd == "toggle_pause":
        if orch:
            if orch._paused:
                orch.resume()
            else:
                orch.pause()
            await client.send({"type": "pause_state", "paused": orch._paused})

    elif cmd == "pause":
        if orch:
            orch.pause()
            await client.send({"type": "pause_state", "paused": True})

    elif cmd == "resume":
        if orch:
            orch.resume()
            await client.send({"type": "pause_state", "paused": False})

    elif cmd == "set_page_interval":
        seconds = data.get("seconds", 0)
        if orch:
            orch.set_page_interval(seconds)
            await client.send({
                "type": "page_interval",
                "seconds": seconds,
                "manual": seconds == 0,
            })

    elif cmd == "get_page_interval":
        if orch:
            await client.send({
                "type": "page_interval",
                "seconds": orch.page_interval,
                "manual": orch.page_interval == 0,
            })

    elif cmd == "action":
        if not client.reader or not client.reader.attached_to:
            await client.send_error("not_attached", "Attach to a character first")
            return

        text = data.get("text", "")
        if orch:
            orch.submit_player_action(text)
            await client.send({"type": "ok", "message": "Action submitted"})

    elif cmd == "whisper":
        if not client.reader or not client.reader.attached_to:
            await client.send_error("not_attached", "Attach to a character first")
            return

        text = data.get("text", "").strip()
        character = client.reader.attached_to
        if orch:
            if text:
                orch.submit_influence(character, text)
                await client.send({
                    "type": "influence_queued",
                    "character": character,
                    "text": text,
                })
            else:
                # Clear pending influence
                orch._influences.pop(character, None)
                await client.send({
                    "type": "influence_cleared",
                    "character": character,
                })

    elif cmd == "director":
        text = data.get("text", "").strip()
        if orch:
            if text:
                orch.submit_director_guidance(text)
                await client.send({
                    "type": "director_queued",
                    "text": text,
                })
            else:
                # Clear pending guidance
                orch._director_guidance = None
                await client.send({
                    "type": "director_cleared",
                })

    elif cmd == "ready":
        if client.reader:
            client.reader.ready = True
            await client.send({"type": "ok", "message": "Ready"})

    elif cmd == "debug":
        # Return debug data for the DebugPanel
        limit = data.get("limit", 50)
        offset = data.get("offset", 0)
        include_raw = data.get("include_raw", True)
        try:
            debug_data = db.get_debug_data(
                book.book_id,
                limit=limit,
                offset=offset,
                include_raw=include_raw
            )
            await client.send({"type": "debug", **debug_data})
        except Exception as e:
            logger.error(f"Failed to get debug data: {e}")
            await client.send_error("debug_error", str(e))

    elif cmd == "character_history":
        character = data.get("character", "")
        if client.reader and client.reader.attached_to:
            character = character or client.reader.attached_to
        count = data.get("count", 20)
        offset = data.get("offset", 0)
        if not character:
            await client.send_error("invalid_command", "Character name required")
            return
        try:
            history = db.get_character_history(book.book_id, character, limit=count, offset=offset)
            await client.send({
                "type": "character_history",
                "character": character,
                "pages": history
            })
        except Exception as e:
            logger.error(f"Failed to get character history: {e}")
            await client.send({"type": "character_history", "character": character, "pages": []})

    elif cmd == "replay":
        page_num = data.get("page")
        if page_num is None:
            await client.send_error("invalid_command", "Page number required")
            return
        try:
            page_data = db.get_full_page(book.book_id, page_num)
            if page_data:
                await client.send({"type": "replay", **page_data})
            else:
                await client.send_error("not_found", f"No data for page {page_num}")
        except Exception as e:
            logger.error(f"Failed to replay page: {e}")
            await client.send_error("replay_error", str(e))

    else:
        await client.send_error("invalid_command", f"Unknown command: {cmd}")
