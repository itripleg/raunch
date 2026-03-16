"""WebSocket handler for real-time book interactions."""

import json
import logging
from typing import Dict, Optional, Any
from dataclasses import dataclass, field

from fastapi import WebSocket, WebSocketDisconnect

from .library import get_library
from .models import Reader

logger = logging.getLogger(__name__)


@dataclass
class WSClient:
    """A connected WebSocket client."""
    websocket: WebSocket
    book_id: str
    reader: Optional[Reader] = None

    async def send(self, data: Dict[str, Any]) -> None:
        """Send JSON message to client."""
        await self.websocket.send_json(data)

    async def send_error(self, code: str, message: str) -> None:
        """Send error message to client."""
        await self.send({"type": "error", "code": code, "message": message})


class WSManager:
    """Manages WebSocket connections per book."""

    def __init__(self):
        self.clients: Dict[str, Dict[str, WSClient]] = {}  # book_id -> {reader_id -> client}

    def add_client(self, book_id: str, client: WSClient) -> None:
        """Add a client to a book's connections."""
        if book_id not in self.clients:
            self.clients[book_id] = {}
        if client.reader:
            self.clients[book_id][client.reader.reader_id] = client

    def remove_client(self, book_id: str, reader_id: str) -> None:
        """Remove a client from a book's connections."""
        if book_id in self.clients:
            self.clients[book_id].pop(reader_id, None)

    async def broadcast(self, book_id: str, data: Dict[str, Any], exclude: Optional[str] = None) -> None:
        """Broadcast message to all clients in a book."""
        if book_id not in self.clients:
            return

        for reader_id, client in self.clients[book_id].items():
            if reader_id != exclude:
                try:
                    await client.send(data)
                except Exception as e:
                    logger.error(f"Failed to send to {reader_id}: {e}")


# Global manager
ws_manager = WSManager()


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

    client = WSClient(websocket=websocket, book_id=book_id)

    try:
        while True:
            data = await websocket.receive_json()
            await handle_command(client, book, data)

    except WebSocketDisconnect:
        if client.reader:
            book.remove_reader(client.reader.reader_id)
            ws_manager.remove_client(book_id, client.reader.reader_id)

            await ws_manager.broadcast(book_id, {
                "type": "reader_left",
                "reader_id": client.reader.reader_id,
            })

    except Exception as e:
        logger.error(f"WebSocket error: {e}")
        await websocket.close()


async def handle_command(client: WSClient, book, data: Dict[str, Any]) -> None:
    """Handle a WebSocket command."""
    cmd = data.get("cmd")

    if cmd == "join":
        nickname = data.get("nickname", "Anonymous")
        reader = Reader.create(nickname)
        client.reader = reader
        book.add_reader(reader)
        ws_manager.add_client(book.book_id, client)

        await client.send({
            "type": "joined",
            "reader_id": reader.reader_id,
            "nickname": reader.nickname,
        })

        await ws_manager.broadcast(book.book_id, {
            "type": "reader_joined",
            "reader_id": reader.reader_id,
            "nickname": reader.nickname,
        }, exclude=reader.reader_id)

    elif cmd == "attach":
        if not client.reader:
            await client.send_error("not_joined", "Join first")
            return

        character = data.get("character")
        if not character:
            await client.send_error("invalid_command", "Character name required")
            return

        # Check if character exists
        if book.orchestrator and character not in book.orchestrator.characters:
            await client.send_error("not_found", f"Character '{character}' not found")
            return

        # Check if already taken
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

    elif cmd == "action":
        if not client.reader or not client.reader.attached_to:
            await client.send_error("not_attached", "Attach to a character first")
            return

        text = data.get("text", "")
        # TODO: Forward to orchestrator
        await client.send({"type": "ok", "message": "Action queued"})

    elif cmd == "whisper":
        if not client.reader or not client.reader.attached_to:
            await client.send_error("not_attached", "Attach to a character first")
            return

        text = data.get("text", "")
        # TODO: Forward to orchestrator
        await client.send({"type": "ok", "message": "Whisper queued"})

    elif cmd == "director":
        text = data.get("text", "")
        # TODO: Forward to orchestrator
        await client.send({"type": "ok", "message": "Director guidance queued"})

    elif cmd == "ready":
        if client.reader:
            client.reader.ready = True
            # TODO: Check if all ready
            await client.send({"type": "ok", "message": "Ready"})

    else:
        await client.send_error("invalid_command", f"Unknown command: {cmd}")
