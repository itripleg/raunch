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

        # Send welcome
        char_names = list(self.orch.characters.keys())
        await client.send({
            "type": "welcome",
            "world": self.orch.world.info(),
            "characters": char_names,
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
            if self.orch.player_character:
                self.orch.submit_player_action(msg.get("text", ""))
                await client.send({"type": "ok", "message": "Action submitted"})
            else:
                await client.send({"type": "error", "message": "No player character set"})

        else:
            await client.send({"type": "error", "message": f"Unknown command: {cmd}"})

    def broadcast_tick(self, results: Dict[str, Any]):
        """Send tick results to all WS clients. Called from sync context."""
        if not self._loop or not self.clients:
            return

        for client in list(self.clients):
            view = {
                "type": "tick",
                "tick": results.get("tick"),
                "narration": results.get("narration", ""),
                "events": results.get("events", []),
                "characters": {},
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
