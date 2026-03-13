# Solo vs Multiplayer Mode Design

## Overview

Add scenario-level `multiplayer` flag to cleanly separate solo and multiplayer experiences.

## Goals

- Solo mode: Simple, immediate experience without player tracking UI
- Multiplayer mode: Nickname prompt, player presence, ready/waiting turn state
- Backwards compatible: Existing scenarios default to solo

## Data Model

### Scenario JSON

Add optional `multiplayer` field (defaults to `false`):

```json
{
  "name": "Breeding Season at Millfield Farm",
  "multiplayer": false,
  ...
}
```

### Game State Broadcast

Backend includes mode in state sent to frontend:

```python
{
  "world_id": "...",
  "multiplayer": false,
  "players": [],
  "turn_state": null,
  ...
}
```

## Backend Behavior

### Scenario Loading

- Read `multiplayer` from scenario JSON (default `false`)
- Store on world instance
- Include in all game state broadcasts

### Solo Mode

- No player tracking (`players` array stays empty)
- No ready states (`turn_state` stays `null`)
- Ticks fire on regular auto-tick interval
- User actions queued and processed on next tick
- Manual tick button works
- Join messages ignored or rejected gracefully

### Multiplayer Mode

- Players must join with nickname
- Players can mark "ready" after submitting action
- Tick fires when all players ready OR auto-tick timeout hits (60s)
- Broadcast `turn_state` with ready/waiting counts
- Manual tick button works

## Frontend Behavior

### Conditional UI

| Component | Solo | Multiplayer |
|-----------|------|-------------|
| NicknamePrompt | Skip | Show on first visit |
| PlayerPresence | Hidden | Show player count |
| TurnStateUI | Hidden | Show ready/waiting |
| Ready button | Hidden | Show after action |
| Manual tick | Visible | Visible |
| Action input | Visible | Visible |

### Join Flow

- **Solo**: Auto-join with generic name or skip join entirely
- **Multiplayer**: Require nickname prompt, persist to localStorage

### State Access

- `useGame` hook exposes `game.multiplayer` boolean
- Components conditionally render based on this flag

## Edge Cases

| Scenario | Behavior |
|----------|----------|
| Missing `multiplayer` field | Defaults to `false` (solo) |
| Join message in solo mode | Ignored or rejected |
| Mode switch mid-game | Not supported; requires new world |

## Files to Modify

### Backend

- `raunch/orchestrator.py` - Read multiplayer flag, include in state
- Scenario JSON files - Add `multiplayer` field where needed

### Frontend

- `frontend/src/hooks/useGame.ts` - Expose `multiplayer` from game state
- `frontend/src/App.tsx` - Gate NicknamePrompt on multiplayer mode
- `frontend/src/components/GameLayout.tsx` - Gate PlayerPresence and TurnStateUI
- `frontend/src/components/CharacterPanel.tsx` - Gate ready button if present

## Testing

1. **Solo scenario**: No nickname prompt, no player UI, ticks on interval, manual tick works
2. **Multiplayer scenario**: Nickname prompt, player count visible, ready button works, early tick when all ready
3. **Existing scenarios**: No `multiplayer` field behaves as solo (backwards compatible)
