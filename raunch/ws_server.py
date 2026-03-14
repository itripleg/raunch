"""WebSocket server for the web frontend. Mirrors TCP server protocol."""

import asyncio
import json
import logging
import uuid
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
        # Multiplayer fields
        self.player_id: Optional[str] = None
        self.nickname: Optional[str] = None
        self.ready: bool = False

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
            "manual": self.orch.is_manual_mode,
            "paused": self.orch._paused,
            "player_id": client.player_id,
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
            # Broadcast player_left and updated player list to all remaining clients
            if client.player_id is not None:
                # Remove from orchestrator's turn-based tracking
                self.orch.clear_player_ready(client.player_id)
                await self._broadcast_player_left(client)
                await self._broadcast_players()
                # Broadcast turn state - their departure may trigger tick if they were last non-ready
                await self._broadcast_turn_state()

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

        elif cmd == "join":
            nickname = msg.get("nickname", "").strip()
            # Assign unique player ID
            client.player_id = str(uuid.uuid4())
            # Generate nickname if not provided
            if not nickname:
                # Count existing players to generate "Player N" name
                player_count = sum(1 for c in self.clients if c.player_id is not None)
                nickname = f"Player {player_count}"
            client.nickname = nickname
            client.ready = False
            # Register player with orchestrator for turn-based tracking
            self.orch.set_player_ready(client.player_id, False)
            # Send confirmation to joining client
            await client.send({
                "type": "joined",
                "player_id": client.player_id,
                "nickname": client.nickname,
            })
            # Broadcast player_joined to all clients
            await self._broadcast_player_joined(client)
            # Broadcast updated player list to all clients
            await self._broadcast_players()
            # Broadcast turn state so new player sees waiting-for list
            await self._broadcast_turn_state()

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
            auto_ready = msg.get("ready", True)  # Default to auto-ready on action submit (demo behavior)
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
                    # Auto-ready player on action submission (spec: demo behavior)
                    if auto_ready and client.player_id:
                        client.ready = True
                        self.orch.set_player_ready(client.player_id, True)
                        await self._broadcast_turn_state()
                else:
                    logger.warning(f"[WS] Influence FAILED to submit")
                    await client.send({"type": "error", "message": f"Character {client.attached_to} not found"})
            elif self.orch.player_character:
                # Legacy player control mode
                self.orch.submit_player_action(text)
                await client.send({"type": "ok", "message": "Action submitted"})
                # Auto-ready in legacy mode too
                if auto_ready and client.player_id:
                    client.ready = True
                    self.orch.set_player_ready(client.player_id, True)
                    await self._broadcast_turn_state()
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
            auto_ready = msg.get("ready", True)  # Default to auto-ready on director submit
            if not text:
                await client.send({"type": "error", "message": "Empty guidance"})
            else:
                self.orch.submit_director_guidance(text)
                await client.send({
                    "type": "director_queued",
                    "text": text,
                })
                # Auto-ready player on director guidance submission
                if auto_ready and client.player_id:
                    client.ready = True
                    self.orch.set_player_ready(client.player_id, True)
                    await self._broadcast_turn_state()

        elif cmd == "ready":
            # Mark player as ready for the current turn
            if client.player_id is None:
                await client.send({"type": "error", "message": "Must join before readying"})
            else:
                client.ready = True
                # Sync with orchestrator for turn-based tick triggering
                self.orch.set_player_ready(client.player_id, True)
                await self._broadcast_turn_state()

        elif cmd == "set_tick_interval":
            seconds = msg.get("seconds", 30)
            self.orch.set_tick_interval(int(seconds))
            await self._broadcast_tick_interval()

        elif cmd == "set_turn_timeout":
            seconds = msg.get("seconds", 60)
            self.orch.turn_timeout = int(seconds)
            await self._broadcast_turn_timeout()

        elif cmd == "get_tick_interval":
            await client.send({
                "type": "tick_interval",
                "seconds": self.orch.tick_interval,
                "manual": self.orch.is_manual_mode,
            })

        elif cmd == "tick":
            # Manually trigger next tick (only works in manual mode)
            if not self.orch.is_manual_mode:
                await client.send({"type": "error", "message": "Not in manual mode"})
            elif self.orch._paused:
                await client.send({"type": "error", "message": "Simulation is paused"})
            elif self.orch.trigger_tick(host_override=False):
                await client.send({"type": "tick_triggered"})
            else:
                await client.send({"type": "error", "message": "Could not trigger tick"})

        elif cmd == "debug":
            # Return raw database data for debugging
            logger.info("[WS] Debug command received")
            limit = msg.get("limit", 20)
            offset = msg.get("offset", 0)
            include_raw = msg.get("include_raw", True)
            debug_data = db.get_debug_data(
                self.orch.world.world_id,
                limit=limit,
                offset=offset,
                include_raw=include_raw
            )
            logger.info(f"[WS] Sending debug data: {debug_data['stats']}")
            await client.send({"type": "debug", **debug_data})

        else:
            await client.send({"type": "error", "message": f"Unknown command: {cmd}"})

    async def _broadcast_tick_interval(self):
        """Notify all clients of current tick interval."""
        msg = {
            "type": "tick_interval",
            "seconds": self.orch.tick_interval,
            "manual": self.orch.is_manual_mode,
        }
        for client in list(self.clients):
            await client.send(msg)

    async def _broadcast_turn_timeout(self):
        """Notify all clients of current turn timeout."""
        turn_timeout = getattr(self.orch, 'turn_timeout', 60)
        msg = {
            "type": "turn_timeout",
            "seconds": turn_timeout,
        }
        for client in list(self.clients):
            await client.send(msg)

    async def _broadcast_pause_state(self):
        """Notify all clients of current pause state."""
        msg = {"type": "pause_state", "paused": self.orch._paused}
        for client in list(self.clients):
            await client.send(msg)

    async def _broadcast_player_joined(self, joined_client: WSClient):
        """Notify all clients that a player has joined."""
        msg = {
            "type": "player_joined",
            "player_id": joined_client.player_id,
            "nickname": joined_client.nickname,
        }
        for client in list(self.clients):
            await client.send(msg)

    async def _broadcast_player_left(self, left_client: WSClient):
        """Notify all clients that a player has left."""
        msg = {
            "type": "player_left",
            "player_id": left_client.player_id,
            "nickname": left_client.nickname,
        }
        for client in list(self.clients):
            await client.send(msg)

    async def _broadcast_players(self):
        """Notify all clients of current player list."""
        players = [
            {
                "player_id": c.player_id,
                "nickname": c.nickname,
                "attached_to": c.attached_to,
                "ready": c.ready
            }
            for c in self.clients
            if c.player_id is not None  # Only include joined players
        ]
        msg = {"type": "players", "players": players}
        for client in list(self.clients):
            await client.send(msg)

    async def _broadcast_turn_state(self):
        """Notify all clients of current turn state (ready states, waiting for, countdown)."""
        # Get all joined players
        players = [c for c in self.clients if c.player_id is not None]

        # Build ready states dict
        ready_states = {
            c.player_id: c.ready
            for c in players
        }

        # Build waiting_for list (nicknames of players not ready)
        waiting_for = [
            c.nickname
            for c in players
            if not c.ready
        ]

        # Get timeout and remaining time from orchestrator
        turn_timeout = getattr(self.orch, 'turn_timeout', 60)
        turn_remaining = self.orch.get_turn_remaining() if hasattr(self.orch, 'get_turn_remaining') else turn_timeout

        msg = {
            "type": "turn_state",
            "ready_states": ready_states,
            "waiting_for": waiting_for,
            "all_ready": len(waiting_for) == 0 and len(players) > 0,
            "player_count": len(players),
            "timeout": turn_timeout,
            "countdown": int(turn_remaining) if turn_remaining != float('inf') else turn_timeout,
        }
        for client in list(self.clients):
            await client.send(msg)

    def broadcast_tick_start(self, tick_num: int, triggered_by: str = 'auto'):
        """Notify clients that a new tick is starting (for streaming).

        Args:
            tick_num: The tick number starting
            triggered_by: Reason for tick trigger ('all_ready', 'timeout', 'host', 'auto')
        """
        if not self._loop or not self.clients:
            return
        from datetime import datetime
        msg = {
            "type": "tick_start",
            "tick": tick_num,
            "timestamp": datetime.utcnow().isoformat(),
            "triggered_by": triggered_by,
        }
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

        # Handle error ticks - send as error message, not tick
        if "error" in results:
            error_msg = {"type": "error", "message": results["error"]}
            for client in list(self.clients):
                try:
                    asyncio.run_coroutine_threadsafe(client.send(error_msg), self._loop)
                except Exception:
                    pass
            return

        from datetime import datetime

        # Reset all client ready states after tick completes (turn-based multiplayer)
        for client in list(self.clients):
            if client.player_id is not None:
                client.ready = False

        # Schedule turn state broadcast (async from sync context)
        try:
            asyncio.run_coroutine_threadsafe(self._broadcast_turn_state(), self._loop)
        except Exception:
            pass

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
