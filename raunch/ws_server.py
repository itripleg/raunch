"""WebSocket server for the web frontend. Mirrors TCP server protocol."""

import asyncio
import json
import logging
from typing import Dict, Any, Optional, Set

import websockets

from .config import SERVER_HOST
from . import db

logger = logging.getLogger(__name__)

WS_PORT = 7667


class WSClient:
    """A connected WebSocket client."""

    def __init__(self, ws):
        self.ws = ws
        self.attached_to: Optional[str] = None

    async def send(self, data: Dict[str, Any]) -> bool:
        try:
            await self.ws.send(json.dumps(data))
            return True
        except Exception:
            return False


class WebSocketServer:
    """WebSocket server for web frontend clients."""

    def __init__(self, orchestrator):
        self.orch = orchestrator
        self.clients: Set[WSClient] = set()
        self._server = None
        self._loop: Optional[asyncio.AbstractEventLoop] = None

    async def start(self):
        self._loop = asyncio.get_running_loop()
        self._server = await websockets.serve(
            self._handler,
            SERVER_HOST,
            WS_PORT,
        )
        logger.info(f"WebSocket server listening on {SERVER_HOST}:{WS_PORT}")

    async def _handler(self, ws):
        client = WSClient(ws)
        self.clients.add(client)
        logger.info("WS client connected")

        # Send welcome with initial history
        char_names = list(self.orch.characters.keys())
        initial_history = db.get_tick_history(self.orch.world.world_id, limit=50)
        await client.send({
            "type": "welcome",
            "world": self.orch.world.info(),
            "characters": char_names,
            "history": initial_history,
            "tick_interval": self.orch.tick_interval,
            "paused": self.orch._paused,
        })

        try:
            async for raw in ws:
                try:
                    msg = json.loads(raw)
                    await self._process_command(client, msg)
                except json.JSONDecodeError:
                    await client.send({"type": "error", "message": "Invalid JSON"})
        except websockets.exceptions.ConnectionClosed:
            pass
        except Exception as e:
            logger.debug(f"WS client error: {e}")
        finally:
            self.clients.discard(client)
            logger.info("WS client disconnected")

    async def _process_command(self, client: WSClient, msg: Dict[str, Any]):
        cmd = msg.get("cmd", "")

        if cmd == "attach":
            name = msg.get("character", "")
            matches = [n for n in self.orch.characters if n.lower().startswith(name.lower())]
            if matches:
                client.attached_to = matches[0]
                await client.send({"type": "attached", "character": matches[0]})
            else:
                await client.send({"type": "error", "message": f"No character matching '{name}'"})

        elif cmd == "detach":
            client.attached_to = None
            await client.send({"type": "detached"})

        elif cmd == "list":
            chars = {}
            for cname, char in self.orch.characters.items():
                chars[cname] = {
                    "species": char.character_data.get("species", "?"),
                    "emotional_state": char.emotional_state,
                    "location": char.location,
                }
            await client.send({"type": "characters", "characters": chars})

        elif cmd == "world":
            await client.send({"type": "world", "snapshot": self.orch.world.snapshot()})

        elif cmd == "status":
            await client.send({
                "type": "status",
                "world": self.orch.world.info(),
                "characters": list(self.orch.characters.keys()),
                "paused": self.orch._paused,
                "clients": len(self.clients),
                "tick_interval": self.orch.tick_interval,
            })

        elif cmd == "history":
            limit = msg.get("count", 20)
            offset = msg.get("offset", 0)
            ticks = db.get_tick_history(self.orch.world.world_id, limit=limit, offset=offset)
            await client.send({"type": "history", "ticks": ticks})

        elif cmd == "character_history":
            name = msg.get("character", client.attached_to or "")
            matches = [n for n in self.orch.characters if n.lower().startswith(name.lower())]
            if not matches:
                await client.send({"type": "error", "message": f"No character matching '{name}'"})
            else:
                limit = msg.get("count", 20)
                offset = msg.get("offset", 0)
                history = db.get_character_history(self.orch.world.world_id, matches[0], limit=limit, offset=offset)
                await client.send({"type": "character_history", "character": matches[0], "ticks": history})

        elif cmd == "replay":
            tick_num = msg.get("tick")
            if tick_num is None:
                await client.send({"type": "error", "message": "Specify a tick number"})
            else:
                tick_data = db.get_full_tick(self.orch.world.world_id, tick_num)
                if tick_data:
                    await client.send({"type": "replay", **tick_data})
                else:
                    await client.send({"type": "error", "message": f"No data for tick {tick_num}"})

        elif cmd == "action":
            text = msg.get("text", "").strip()
            if not text:
                await client.send({"type": "error", "message": "Empty message"})
            elif client.attached_to:
                # Influence mode: whisper to attached character
                logger.warning(f"[WS] Received influence for '{client.attached_to}': {text[:50]}...")
                if self.orch.submit_influence(client.attached_to, text):
                    logger.warning(f"[WS] Influence submitted successfully")
                    await client.send({
                        "type": "influence_queued",
                        "character": client.attached_to,
                        "text": text,
                    })
                else:
                    logger.warning(f"[WS] Influence FAILED to submit")
                    await client.send({"type": "error", "message": f"Character {client.attached_to} not found"})
            elif self.orch.player_character:
                # Legacy player control mode
                self.orch.submit_player_action(text)
                await client.send({"type": "ok", "message": "Action submitted"})
            else:
                await client.send({"type": "error", "message": "Attach to a character first"})

        elif cmd == "pause":
            self.orch.pause()
            await self._broadcast_pause_state()

        elif cmd == "resume":
            self.orch.resume()
            await self._broadcast_pause_state()

        elif cmd == "toggle_pause":
            if self.orch._paused:
                self.orch.resume()
            else:
                self.orch.pause()
            await self._broadcast_pause_state()

        elif cmd == "director":
            text = msg.get("text", "").strip()
            if not text:
                await client.send({"type": "error", "message": "Empty guidance"})
            else:
                self.orch.submit_director_guidance(text)
                await client.send({
                    "type": "director_queued",
                    "text": text,
                })

        elif cmd == "set_tick_interval":
            seconds = msg.get("seconds", 30)
            self.orch.set_tick_interval(int(seconds))
            await self._broadcast_tick_interval()

        elif cmd == "get_tick_interval":
            await client.send({
                "type": "tick_interval",
                "seconds": self.orch.tick_interval,
            })

        else:
            await client.send({"type": "error", "message": f"Unknown command: {cmd}"})

    async def _broadcast_tick_interval(self):
        """Notify all clients of current tick interval."""
        msg = {"type": "tick_interval", "seconds": self.orch.tick_interval}
        for client in list(self.clients):
            await client.send(msg)

    async def _broadcast_pause_state(self):
        """Notify all clients of current pause state."""
        msg = {"type": "pause_state", "paused": self.orch._paused}
        for client in list(self.clients):
            await client.send(msg)

    def broadcast_tick_start(self, tick_num: int):
        """Notify clients that a new tick is starting (for streaming)."""
        if not self._loop or not self.clients:
            return
        from datetime import datetime
        msg = {"type": "tick_start", "tick": tick_num, "timestamp": datetime.utcnow().isoformat()}
        for client in list(self.clients):
            try:
                asyncio.run_coroutine_threadsafe(client.send(msg), self._loop)
            except Exception:
                pass

    def broadcast_stream_delta(self, tick_num: int, source: str, delta: str):
        """Broadcast a streaming text delta to clients."""
        if not self._loop:
            logger.warning(f"[STREAM] No loop yet, skipping delta")
            return
        if not self.clients:
            return  # Normal if no clients connected
        msg = {
            "type": "stream_delta",
            "tick": tick_num,
            "source": source,
            "delta": delta,
        }
        for client in list(self.clients):
            # Send narrator to everyone, character streams only to attached client
            if source != "narrator" and source != client.attached_to:
                continue
            try:
                asyncio.run_coroutine_threadsafe(client.send(msg), self._loop)
            except Exception:
                pass

    def broadcast_stream_done(self, tick_num: int, source: str):
        """Notify clients that a source has finished streaming."""
        if not self._loop or not self.clients:
            return
        msg = {"type": "stream_done", "tick": tick_num, "source": source}
        for client in list(self.clients):
            if source != "narrator" and source != client.attached_to:
                continue
            try:
                asyncio.run_coroutine_threadsafe(client.send(msg), self._loop)
            except Exception:
                pass

    def broadcast_tick(self, results: Dict[str, Any]):
        """Send tick results to all WS clients. Called from sync context."""
        if not self._loop or not self.clients:
            return

        from datetime import datetime

        for client in list(self.clients):
            view = {
                "type": "tick",
                "tick": results.get("tick"),
                "narration": results.get("narration", ""),
                "events": results.get("events", []),
                "characters": {},
                "created_at": datetime.utcnow().isoformat(),
            }

            for cname, cdata in results.get("characters", {}).items():
                if not isinstance(cdata, dict):
                    continue
                if cname == client.attached_to:
                    view["characters"][cname] = cdata
                else:
                    view["characters"][cname] = {
                        "action": cdata.get("action"),
                        "dialogue": cdata.get("dialogue"),
                        "emotional_state": cdata.get("emotional_state"),
                    }

            view["attached_to"] = client.attached_to

            try:
                asyncio.run_coroutine_threadsafe(client.send(view), self._loop)
            except Exception:
                pass

    def stop(self):
        if self._server:
            self._server.close()
            self._server = None
