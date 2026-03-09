"""TCP server for multi-terminal attach. Runs inside the Docker container."""

import json
import logging
import socket
import threading
from typing import Dict, Any, Optional, List

from .config import SERVER_HOST, SERVER_PORT
from . import db

logger = logging.getLogger(__name__)


class ClientConnection:
    """A connected client (attach session)."""

    def __init__(self, sock: socket.socket, addr):
        self.sock = sock
        self.addr = addr
        self.attached_to: Optional[str] = None
        self.alive = True
        self._lock = threading.Lock()

    def send(self, data: Dict[str, Any]) -> bool:
        """Send a JSON message to the client. Returns False if dead."""
        try:
            raw = json.dumps(data) + "\n"
            with self._lock:
                self.sock.sendall(raw.encode("utf-8"))
            return True
        except (BrokenPipeError, ConnectionResetError, OSError):
            self.alive = False
            return False

    def close(self):
        self.alive = False
        try:
            self.sock.close()
        except OSError:
            pass


class GameServer:
    """TCP server that broadcasts tick results to attached clients."""

    def __init__(self, orchestrator):
        self.orch = orchestrator
        self.clients: List[ClientConnection] = []
        self._lock = threading.Lock()
        self._server_sock: Optional[socket.socket] = None
        self._thread: Optional[threading.Thread] = None

    def start(self):
        """Start listening for client connections."""
        self._server_sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        self._server_sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        self._server_sock.bind((SERVER_HOST, SERVER_PORT))
        self._server_sock.listen(10)
        self._server_sock.settimeout(1.0)

        self._thread = threading.Thread(target=self._accept_loop, daemon=True)
        self._thread.start()
        logger.info(f"Game server listening on {SERVER_HOST}:{SERVER_PORT}")

    def _accept_loop(self):
        """Accept incoming client connections."""
        while self._server_sock:
            try:
                sock, addr = self._server_sock.accept()
                client = ClientConnection(sock, addr)
                with self._lock:
                    self.clients.append(client)
                logger.info(f"Client connected: {addr}")

                # Handle this client in its own thread
                t = threading.Thread(target=self._handle_client, args=(client,), daemon=True)
                t.start()
            except socket.timeout:
                continue
            except OSError:
                break

    def _handle_client(self, client: ClientConnection):
        """Handle commands from a connected client."""
        # Send welcome with world info + character list
        char_names = list(self.orch.characters.keys())
        client.send({
            "type": "welcome",
            "world": self.orch.world.info(),
            "characters": char_names,
        })

        buf = ""
        while client.alive:
            try:
                data = client.sock.recv(4096)
                if not data:
                    break
                buf += data.decode("utf-8")

                while "\n" in buf:
                    line, buf = buf.split("\n", 1)
                    line = line.strip()
                    if not line:
                        continue
                    try:
                        msg = json.loads(line)
                        self._process_command(client, msg)
                    except json.JSONDecodeError:
                        client.send({"type": "error", "message": "Invalid JSON"})
            except (ConnectionResetError, OSError):
                break

        client.close()
        with self._lock:
            if client in self.clients:
                self.clients.remove(client)
        logger.info(f"Client disconnected: {client.addr}")

    def _process_command(self, client: ClientConnection, msg: Dict[str, Any]):
        """Process a command from a client."""
        cmd = msg.get("cmd", "")

        if cmd == "attach":
            name = msg.get("character", "")
            matches = [n for n in self.orch.characters if n.lower().startswith(name.lower())]
            if matches:
                client.attached_to = matches[0]
                client.send({"type": "attached", "character": matches[0]})
            else:
                client.send({"type": "error", "message": f"No character matching '{name}'"})

        elif cmd == "detach":
            client.attached_to = None
            client.send({"type": "detached"})

        elif cmd == "list":
            chars = {}
            for cname, char in self.orch.characters.items():
                chars[cname] = {
                    "species": char.character_data.get("species", "?"),
                    "emotional_state": char.emotional_state,
                    "location": char.location,
                }
            client.send({"type": "characters", "characters": chars})

        elif cmd == "world":
            client.send({"type": "world", "snapshot": self.orch.world.snapshot()})

        elif cmd == "status":
            client.send({
                "type": "status",
                "world": self.orch.world.info(),
                "characters": list(self.orch.characters.keys()),
                "paused": self.orch._paused,
                "clients": len(self.clients),
            })

        elif cmd == "history":
            # Full narration history from DB
            limit = msg.get("count", 20)
            offset = msg.get("offset", 0)
            ticks = db.get_tick_history(self.orch.world.world_id, limit=limit, offset=offset)
            client.send({"type": "history", "ticks": ticks})

        elif cmd == "character_history":
            # Character thought history from DB
            name = msg.get("character", client.attached_to or "")
            matches = [n for n in self.orch.characters if n.lower().startswith(name.lower())]
            if not matches:
                client.send({"type": "error", "message": f"No character matching '{name}'"})
            else:
                limit = msg.get("count", 20)
                offset = msg.get("offset", 0)
                history = db.get_character_history(self.orch.world.world_id, matches[0], limit=limit, offset=offset)
                client.send({"type": "character_history", "character": matches[0], "ticks": history})

        elif cmd == "replay":
            # Full replay of a specific tick
            tick_num = msg.get("tick")
            if tick_num is None:
                client.send({"type": "error", "message": "Specify a tick number"})
            else:
                tick_data = db.get_full_tick(self.orch.world.world_id, tick_num)
                if tick_data:
                    client.send({"type": "replay", **tick_data})
                else:
                    client.send({"type": "error", "message": f"No data for tick {tick_num}"})

        elif cmd == "action":
            if self.orch.player_character:
                self.orch.submit_player_action(msg.get("text", ""))
                client.send({"type": "ok", "message": "Action submitted"})
            else:
                client.send({"type": "error", "message": "No player character set"})

        else:
            client.send({"type": "error", "message": f"Unknown command: {cmd}"})

    def broadcast_tick(self, results: Dict[str, Any]):
        """Send tick results to all connected clients, filtered by attachment."""
        with self._lock:
            dead = []
            for client in self.clients:
                # Build client-specific view
                view = {
                    "type": "tick",
                    "tick": results.get("tick"),
                    "narration": results.get("narration", ""),
                    "events": results.get("events", []),
                    "characters": {},
                }

                # Include all character actions, but only full thoughts for attached
                for cname, cdata in results.get("characters", {}).items():
                    if not isinstance(cdata, dict):
                        continue
                    if cname == client.attached_to:
                        view["characters"][cname] = cdata  # Full inner thoughts
                    else:
                        # Just action/dialogue for non-attached
                        view["characters"][cname] = {
                            "action": cdata.get("action"),
                            "dialogue": cdata.get("dialogue"),
                            "emotional_state": cdata.get("emotional_state"),
                        }

                view["attached_to"] = client.attached_to
                if not client.send(view):
                    dead.append(client)

            for c in dead:
                self.clients.remove(c)

    def stop(self):
        """Shut down the server."""
        if self._server_sock:
            try:
                self._server_sock.close()
            except OSError:
                pass
            self._server_sock = None
        with self._lock:
            for c in self.clients:
                c.close()
            self.clients.clear()
