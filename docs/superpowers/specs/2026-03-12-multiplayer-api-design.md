# Multiplayer API Design

**Date:** 2026-03-12
**Status:** Approved
**Target:** 4-person demo (tomorrow) + foundation for future auth

## Overview

Add REST API and turn-based multiplayer support to raunch. Players connect with nicknames, submit influences, and the game progresses when all players are ready or a timeout expires.

## Goals

1. **Demo-ready**: 4 players can connect, pick nicknames, select scenario, play together
2. **Foundation**: REST API structure that can later support auth, BYOK, rooms
3. **Turn-based**: Tick waits for players, prevents chaos, enables collaborative pacing

## Non-Goals (For Now)

- User authentication (OAuth, passwords)
- Persistent player accounts
- Multiple simultaneous worlds/rooms
- Smut wizard in web UI (CLI `roll` is sufficient for demo)

---

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                        Frontend                              │
│  (React app - existing + new scenario/player UI)            │
└─────────────────────┬───────────────────────────────────────┘
                      │
        ┌─────────────┴─────────────┐
        │                           │
        ▼                           ▼
┌───────────────┐           ┌───────────────┐
│   REST API    │           │   WebSocket   │
│  (FastAPI)    │           │   (existing)  │
│  Port 8000    │           │   Port 7667   │
│               │           │               │
│ /api/v1/...   │           │ Real-time:    │
│ - scenarios   │           │ - Ticks       │
│ - world       │           │ - Presence    │
└───────┬───────┘           │ - Influence   │
        │                   │ - Turn state  │
        └─────────────┬─────└───────┬───────┘
                      │             │
                      ▼             ▼
            ┌─────────────────────────┐
            │      Orchestrator       │
            │  (turn-based tick loop) │
            └─────────────────────────┘
```

**Separation of concerns:**
- REST: One-shot requests (scenarios, world management)
- WebSocket: Streaming (ticks, presence, turn state, influence)

---

## REST API

**Base URL:** `/api/v1`

### Scenarios

```
GET /scenarios
  Response: {
    "scenarios": [
      { "name": "tavern_encounter", "title": "The Lusty Tankard", "characters": 3, "created_at": "..." }
    ]
  }

POST /scenarios/roll
  Request:  { "characters": 2 }  // optional, default from config
  Response: {
    "scenario": { "name": "random_abc123", "title": "...", "characters": [...] }
  }
  Notes: Calls existing roll logic, saves to disk, returns metadata
```

### World

```
GET /world
  Response: {
    "running": true,
    "world_id": "uuid",
    "name": "The Lusty Tankard",
    "tick": 42,
    "scenario": "tavern_encounter",
    "characters": ["Zara", "Marcus"],
    "turn_timeout": 60
  }
  // If no world running:
  Response: { "running": false }

POST /world/load
  Request:  { "scenario": "tavern_encounter" }
  Response: {
    "world_id": "uuid",
    "name": "...",
    "characters": ["Zara", "Marcus"]
  }
  Notes: Stops current world if running, loads scenario, starts fresh

POST /world/stop
  Response: { "stopped": true }
  Notes: Saves and stops current world
```

---

## WebSocket Protocol Changes

### Join with Nickname

```json
// Client → Server (on connect or to change name)
{ "cmd": "join", "nickname": "Alice" }

// Server → Client (confirmation)
{ "type": "joined", "player_id": "abc123", "nickname": "Alice" }

// Server → All (broadcast)
{ "type": "player_joined", "player_id": "abc123", "nickname": "Alice" }
```

- Anonymous players get auto-generated names ("Player 1", "Player 2")
- `player_id` is a UUID generated per connection

### Player Presence

```json
// Server → All (on any presence change)
{
  "type": "players",
  "players": [
    { "player_id": "abc123", "nickname": "Alice", "attached_to": "Zara", "ready": true },
    { "player_id": "def456", "nickname": "Bob", "attached_to": null, "ready": false }
  ]
}

// Server → All (single player update)
{ "type": "player_updated", "player_id": "abc123", "attached_to": "Zara", "ready": true }

// Server → All (player left)
{ "type": "player_left", "player_id": "abc123", "nickname": "Alice" }
```

### Turn-Based Tick Model

```json
// Client → Server (mark ready, optionally with influence)
{ "cmd": "ready" }
{ "cmd": "action", "text": "whisper something", "ready": true }

// Client → Server (submit influence without readying)
{ "cmd": "action", "text": "whisper something" }

// Server → All (turn state broadcast)
{
  "type": "turn_state",
  "players": [
    { "player_id": "abc123", "nickname": "Alice", "ready": true, "has_influence": true },
    { "player_id": "def456", "nickname": "Bob", "ready": false, "has_influence": false }
  ],
  "timeout_seconds": 45,
  "waiting_for": ["Bob"]
}

// Server → All (tick starting)
{ "type": "tick_start", "tick": 43, "triggered_by": "all_ready" | "timeout" | "host" }
```

### Tick Trigger Conditions

Tick fires when **any** condition met:
1. All connected players have `ready: true`
2. Turn timeout expires (default 60s)
3. Host forces tick via `{ "cmd": "tick" }`

**Special case:** If 0 players connected, tick does not auto-fire (prevents runaway simulation).

### Turn Timeout Configuration

```json
// Client → Server (host only in future, anyone for now)
{ "cmd": "set_turn_timeout", "seconds": 30 }

// Server → All
{ "type": "turn_timeout", "seconds": 30 }
```

### Influence Attribution

```json
// Existing messages now include sender
{ "type": "influence_queued", "character": "Zara", "text": "...", "from": "Alice" }
{ "type": "director_queued", "text": "...", "from": "Bob" }
```

---

## Frontend Changes

### Join/Nickname Flow

1. On app load, check localStorage for saved nickname
2. If none, show nickname prompt modal before connecting
3. Send `{ "cmd": "join", "nickname": "..." }` after WebSocket connects
4. Store nickname in localStorage for persistence

### Scenario Selection (Pre-game State)

When `GET /world` returns `{ "running": false }`:

1. Hide tick feed, show scenario selection UI
2. Fetch `GET /scenarios` to list available scenarios
3. "Roll Random" button → `POST /scenarios/roll` → refresh list
4. "Start" button → `POST /world/load` → transition to game view
5. All connected players see the selection UI and can participate

### Player Presence UI

- Header shows player count: "4 players"
- Expandable tooltip/dropdown shows:
  - Nicknames
  - Who's attached to which character
  - Ready status (checkmark or waiting indicator)

### Turn State UI

- Show countdown timer when turn is active
- Show "Waiting for: Bob, Carol" below action bar
- Ready button (separate from submit, or auto-ready on submit)
- Visual indication when you're the one holding up the group

### Influence Attribution (Nice-to-have)

- "Queued" badge shows who sent it: "Alice's whisper"
- Director panel shows "Bob's guidance: ..."

---

## Backend Implementation

### New File: `raunch/api.py`

FastAPI application with:
- CORS middleware (allow frontend origin)
- Routes for `/api/v1/scenarios`, `/api/v1/world`
- Reference to shared orchestrator instance

### Modified: `raunch/ws_server.py`

- Track connected players with `player_id`, `nickname`, `ready` state
- New message handlers: `join`, `ready`, `set_turn_timeout`
- Broadcast helpers: `broadcast_players()`, `broadcast_turn_state()`
- Turn state management: ready tracking, timeout timer

### Modified: `raunch/orchestrator.py`

- New turn-based mode (default when multiplayer):
  - `_turn_timeout` setting
  - `_player_ready_states` dict (managed by ws_server)
  - `_check_turn_ready()` method
- Tick loop waits for turn condition instead of fixed interval
- `trigger_tick(reason)` accepts reason for logging/broadcast

### New File: `raunch/turn_manager.py` (Optional)

If turn logic gets complex, extract to dedicated class:
- Tracks player ready states
- Manages timeout timer
- Emits "tick ready" signal to orchestrator

---

## Edge Cases

### Player Disconnects Mid-Turn
- Removed from player list and "waiting for" immediately
- If they were last non-ready player, tick fires
- Their already-queued influence still executes

### Player Joins Mid-Turn
- Added to player list as `ready: false`
- Receives current turn state
- Can submit influence and ready up before timeout

### No Players Connected
- Orchestrator pauses (no auto-ticks)
- Resumes when first player connects

### World Load While Players Connected
- All players get `{ "type": "world_loaded", "world_id": "...", "characters": [...] }`
- UI transitions to game view
- Turn resets, all players `ready: false`

### Rate Limiting
- One influence per player per turn
- Submitting again overwrites previous (not blocked)
- Prevents spam while allowing corrections

---

## Demo Checklist

**Must have for tomorrow:**
- [ ] FastAPI with `/scenarios` and `/world/load` endpoints
- [ ] Nickname prompt in frontend
- [ ] `join` command in WebSocket
- [ ] Player list broadcast
- [ ] Turn-based tick (all ready OR timeout)
- [ ] Turn state UI (waiting for, countdown)
- [ ] Scenario selection UI when no world running

**Nice to have:**
- [ ] Player presence indicator in header
- [ ] Influence attribution display
- [ ] Configurable turn timeout from UI

---

## Future Considerations

These are explicitly out of scope but the design accommodates them:

1. **Authentication**: Session tokens from REST can become JWT/OAuth tokens
2. **Rooms**: World management endpoints can evolve to `/rooms/{id}/world`
3. **BYOK**: API key could be passed in session creation
4. **Persistent accounts**: Player IDs can link to user accounts
5. **Host privileges**: Ready `player_id` tracking enables permission checks

---

## Open Questions

1. Should scenario selection require consensus (vote) or first-come-first-served?
   - **Decision for demo:** Anyone can load, last click wins

2. Should the frontend auto-ready after submitting influence?
   - **Decision for demo:** Yes, auto-ready on influence submit, separate ready button for "skip"
