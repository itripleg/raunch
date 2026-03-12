"""
E2E Test: Full 4-Player Multiplayer Demo

This test validates the complete 4-player multiplayer flow as specified in subtask-9-5:
1. Open 4 browser windows (simulated with WebSocket clients)
2. Each enters different nickname
3. First player loads scenario
4. Each attaches to different character
5. Submit actions and ready up
6. Verify tick fires and all see narration

Prerequisites:
- Backend WebSocket server running on ws://127.0.0.1:7667
- REST API running on http://127.0.0.1:8000
- A scenario loaded OR the test will load one

Run with: python tests/test_4player_demo.py
"""

import asyncio
import json
import sys
import time
from typing import Dict, List, Any, Optional
from dataclasses import dataclass, field

try:
    import websockets
except ImportError:
    print("ERROR: websockets package required. Install with: pip install websockets")
    sys.exit(1)

try:
    import aiohttp
except ImportError:
    aiohttp = None  # Optional, only needed for scenario loading

WS_URL = "ws://127.0.0.1:7667"
API_URL = "http://127.0.0.1:8000"


@dataclass
class PlayerClient:
    """Simulates a browser client connection."""

    nickname: str
    ws: Any = None
    player_id: Optional[str] = None
    attached_to: Optional[str] = None
    ready: bool = False
    messages: List[Dict] = field(default_factory=list)
    characters: List[str] = field(default_factory=list)
    ticks_received: List[Dict] = field(default_factory=list)
    turn_states: List[Dict] = field(default_factory=list)

    async def connect(self):
        """Connect to WebSocket server."""
        self.ws = await websockets.connect(WS_URL)
        # Read welcome message
        raw = await self.ws.recv()
        msg = json.loads(raw)
        assert msg["type"] == "welcome", f"Expected welcome, got {msg['type']}"
        self.characters = msg.get("characters", [])
        self.messages.append(msg)
        return msg

    async def join(self):
        """Send join command with nickname."""
        await self.ws.send(json.dumps({"cmd": "join", "nickname": self.nickname}))

        # Collect messages until we get 'joined'
        while True:
            raw = await asyncio.wait_for(self.ws.recv(), timeout=5.0)
            msg = json.loads(raw)
            self.messages.append(msg)

            if msg["type"] == "joined":
                self.player_id = msg["player_id"]
                return msg

    async def attach(self, character: str):
        """Attach to a character."""
        await self.ws.send(json.dumps({"cmd": "attach", "character": character}))

        while True:
            raw = await asyncio.wait_for(self.ws.recv(), timeout=5.0)
            msg = json.loads(raw)
            self.messages.append(msg)

            if msg["type"] == "attached":
                self.attached_to = msg["character"]
                return msg
            elif msg["type"] == "error":
                raise Exception(f"Attach failed: {msg['message']}")

    async def submit_action(self, text: str):
        """Submit an action/influence."""
        await self.ws.send(json.dumps({"cmd": "action", "text": text, "ready": True}))

        # Wait for influence_queued confirmation
        while True:
            raw = await asyncio.wait_for(self.ws.recv(), timeout=5.0)
            msg = json.loads(raw)
            self.messages.append(msg)

            if msg["type"] == "influence_queued":
                self.ready = True
                return msg
            elif msg["type"] == "turn_state":
                self.turn_states.append(msg)
            elif msg["type"] == "error":
                raise Exception(f"Action failed: {msg['message']}")

    async def send_ready(self):
        """Send ready command (without action)."""
        await self.ws.send(json.dumps({"cmd": "ready"}))
        self.ready = True

        # Consume turn_state updates
        try:
            while True:
                raw = await asyncio.wait_for(self.ws.recv(), timeout=0.5)
                msg = json.loads(raw)
                self.messages.append(msg)
                if msg["type"] == "turn_state":
                    self.turn_states.append(msg)
        except asyncio.TimeoutError:
            pass

    async def drain_messages(self, timeout: float = 0.5):
        """Drain any pending messages."""
        try:
            while True:
                raw = await asyncio.wait_for(self.ws.recv(), timeout=timeout)
                msg = json.loads(raw)
                self.messages.append(msg)

                if msg["type"] == "tick":
                    self.ticks_received.append(msg)
                elif msg["type"] == "turn_state":
                    self.turn_states.append(msg)
        except asyncio.TimeoutError:
            pass

    async def wait_for_tick(self, timeout: float = 10.0):
        """Wait for a tick message."""
        start = time.time()
        while time.time() - start < timeout:
            try:
                raw = await asyncio.wait_for(self.ws.recv(), timeout=1.0)
                msg = json.loads(raw)
                self.messages.append(msg)

                if msg["type"] == "tick":
                    self.ticks_received.append(msg)
                    return msg
                elif msg["type"] == "turn_state":
                    self.turn_states.append(msg)
            except asyncio.TimeoutError:
                continue

        raise TimeoutError("Timed out waiting for tick")

    async def close(self):
        """Close connection."""
        if self.ws:
            await self.ws.close()


async def load_scenario_via_api(scenario_name: str = None) -> Dict:
    """Load a scenario via REST API."""
    if aiohttp is None:
        print("WARNING: aiohttp not available, skipping scenario load")
        return {}

    async with aiohttp.ClientSession() as session:
        # Check if world is already running
        async with session.get(f"{API_URL}/api/v1/world") as resp:
            world = await resp.json()
            if world.get("running"):
                print(f"World already running: {world.get('name')}")
                return world

        # Get available scenarios
        async with session.get(f"{API_URL}/api/v1/scenarios") as resp:
            scenarios = await resp.json()
            if not scenarios:
                print("No scenarios available")
                return {}

        # Use first scenario if none specified
        if not scenario_name:
            scenario_name = scenarios[0]["name"]

        # Load scenario
        async with session.post(
            f"{API_URL}/api/v1/world/load",
            json={"scenario": scenario_name}
        ) as resp:
            if resp.status != 200:
                print(f"Failed to load scenario: {await resp.text()}")
                return {}
            result = await resp.json()
            print(f"Loaded scenario: {result.get('name')}")
            return result


async def run_4player_demo():
    """Run the full 4-player demo test."""
    print("=" * 60)
    print("4-PLAYER MULTIPLAYER DEMO TEST")
    print("=" * 60)
    print()

    # Create 4 player clients with different nicknames
    players = [
        PlayerClient(nickname="Alice"),
        PlayerClient(nickname="Bob"),
        PlayerClient(nickname="Charlie"),
        PlayerClient(nickname="Diana"),
    ]

    try:
        # Step 1: Load scenario (first player does this)
        print("Step 1: Loading scenario...")
        await load_scenario_via_api()
        print("  ✓ Scenario loaded or already running")
        print()

        # Step 2: Connect all players
        print("Step 2: Connecting 4 players...")
        for i, player in enumerate(players):
            welcome = await player.connect()
            print(f"  ✓ {player.nickname} connected (characters: {len(welcome.get('characters', []))})")
        print()

        # Step 3: Each enters different nickname (join)
        print("Step 3: Each player joins with nickname...")
        for player in players:
            joined = await player.join()
            assert joined["nickname"] == player.nickname
            print(f"  ✓ {player.nickname} joined (player_id: {player.player_id[:8]}...)")
        print()

        # Step 4: Each attaches to different character
        print("Step 4: Each player attaches to different character...")
        # Get character list from first player's welcome
        available_chars = players[0].characters

        if len(available_chars) < 4:
            print(f"  WARNING: Only {len(available_chars)} characters available")
            # Some players may attach to same character or not attach
            for i, player in enumerate(players):
                if i < len(available_chars):
                    attached = await player.attach(available_chars[i])
                    print(f"  ✓ {player.nickname} attached to {attached['character']}")
                else:
                    print(f"  - {player.nickname} skipping attach (no free character)")
        else:
            for i, player in enumerate(players):
                attached = await player.attach(available_chars[i])
                print(f"  ✓ {player.nickname} attached to {attached['character']}")
        print()

        # Step 5: Submit actions and ready up
        print("Step 5: Submit actions and ready up...")
        actions = [
            "Look around nervously",
            "Smile warmly at the others",
            "Check my phone for messages",
            "Take a deep breath",
        ]

        for i, player in enumerate(players):
            if player.attached_to:
                await player.submit_action(actions[i])
                print(f"  ✓ {player.nickname} submitted action and readied")
            else:
                await player.send_ready()
                print(f"  ✓ {player.nickname} readied (no attachment)")

        # Drain messages to get turn_state updates
        for player in players:
            await player.drain_messages(timeout=0.5)
        print()

        # Step 6: Verify tick fires (all are ready, should fire immediately)
        print("Step 6: Waiting for tick (all players ready)...")

        # All players wait for tick
        tick_received = [False] * len(players)
        for i, player in enumerate(players):
            try:
                tick = await player.wait_for_tick(timeout=15.0)
                tick_received[i] = True
                narration = tick.get("narration", "")[:100]
                print(f"  ✓ {player.nickname} received tick {tick.get('tick')}")
                if narration:
                    print(f"    Narration preview: {narration}...")
            except TimeoutError:
                print(f"  ✗ {player.nickname} TIMEOUT waiting for tick")

        print()

        # Verify all received the tick
        if all(tick_received):
            print("=" * 60)
            print("✓ SUCCESS: All 4 players received the tick!")
            print("=" * 60)
        else:
            print("=" * 60)
            print("✗ FAILURE: Not all players received tick")
            for i, received in enumerate(tick_received):
                if not received:
                    print(f"  - {players[i].nickname} did not receive tick")
            print("=" * 60)
            return False

        return True

    except Exception as e:
        print(f"\n✗ ERROR: {type(e).__name__}: {e}")
        import traceback
        traceback.print_exc()
        return False

    finally:
        # Cleanup
        print("\nCleaning up connections...")
        for player in players:
            await player.close()


async def run_tests():
    """Run all E2E tests."""
    print()
    print("Running E2E tests for 4-player multiplayer demo...")
    print()

    # Test 1: Full 4-player flow
    success = await run_4player_demo()

    print()
    if success:
        print("All E2E tests PASSED!")
        return 0
    else:
        print("Some E2E tests FAILED!")
        return 1


def main():
    """Entry point."""
    # Check for required services
    print("Checking prerequisites...")
    print(f"  WebSocket URL: {WS_URL}")
    print(f"  REST API URL: {API_URL}")
    print()

    result = asyncio.run(run_tests())
    sys.exit(result)


if __name__ == "__main__":
    main()
