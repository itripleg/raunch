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
            return

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

    # Set up streaming callback
    def stream_callback(page: int, source: str, event: str, content: str):
        import asyncio
        try:
            loop = asyncio.get_event_loop()
            if loop.is_running():
                asyncio.create_task(_broadcast_stream(book.book_id, page, source, event, content))
        except Exception as e:
            logger.error(f"Stream callback error: {e}")

    orch.set_stream_callback(stream_callback)

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
        history_data = db.get_page_history(book_id, limit=20)
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

        character = data.get("character")
        if not character:
            await client.send_error("invalid_command", "Character name required")
            return

        if orch and character not in orch.characters:
            await client.send_error("not_found", f"Character '{character}' not found")
            return

        existing = book.get_reader_by_character(character)
        if existing and existing.reader_id != client.reader.reader_id:
            await client.send_error(
                "character_taken",
                f"{character} is controlled by another reader"
            )
            return

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

        text = data.get("text", "")
        character = client.reader.attached_to
        if orch:
            orch.submit_influence(character, text)
            await client.send({
                "type": "influence_queued",
                "character": character,
                "text": text,
            })

    elif cmd == "director":
        text = data.get("text", "")
        if orch:
            orch.submit_director_guidance(text)
            await client.send({
                "type": "director_queued",
                "text": text,
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
