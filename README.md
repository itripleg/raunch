# Raunch — The Living Library

A multi-agent interactive fiction engine powered by Claude. Characters think, feel, and act autonomously. You are the Librarian — the unseen hand that guides the story through whispers.

## How It Works

```
Orchestrator          World page loop — coordinates all agents
  ├── Narrator        Advances the world, sets scenes, generates events
  ├── Characters      Autonomous NPCs with inner thoughts + actions + dialogue
  └── World State     Locations, time, mood, events
```

**Each page:**
1. Narrator receives world state → produces narration + events + world changes
2. Each character receives narration → produces inner thoughts + action + dialogue
3. World state updates, display renders
4. You can whisper to characters to nudge the story

## Quick Start

### Prerequisites
- Python 3.10+
- Node.js 18+ (for the web frontend)
- Claude Max subscription (OAuth) or Anthropic API key

### Install

```bash
pip install -e .
cd frontend && npm install
```

### Configure

Copy the example env files:

```bash
cp .env.example .env                        # Backend — add your Claude token
cp frontend/.env.example frontend/.env.local # Frontend
```

### Run

**Web UI (recommended):**
```bash
# Terminal 1: Backend API server
python -m raunch.server.app

# Terminal 2: Frontend dev server
cd frontend && npm run dev
```

**CLI only:**
```bash
raunch start --scenario the_living_library
```

## Authentication

Three options (checked in order):
1. **Claude Max OAuth** — auto-detected from `~/.claude/.credentials.json` (just be logged into `claude` CLI)
2. **OAuth token** — set `CLAUDE_CODE_OAUTH_TOKEN` in `.env`
3. **API key** — set `ANTHROPIC_API_KEY` in `.env` for pay-per-token

The web UI also lets you add/manage OAuth tokens through Settings.

## CLI Commands

### Top-level

| Command | Description |
|---------|-------------|
| `raunch start` | Start the world simulation server |
| `raunch wizard` | Interactive scenario creator with animations |
| `raunch roll` | Generate a fully random scenario |
| `raunch play <scenario>` | Local single-player mode |
| `raunch connect <host>` | Connect to a remote Living Library server |
| `raunch attach [character]` | Attach to a character on a running server |
| `raunch status` | Check if a server is running |
| `raunch scenarios` | List saved scenarios |
| `raunch create` | Create a character template |
| `raunch list` | List character templates |
| `raunch reset <scenario>` | Reset a scenario's save data |
| `raunch kill` | Stop any running server processes |

### Start options

```bash
raunch start [OPTIONS]
  --scenario <name>    Load a scenario (from wizard/roll/scenarios folder)
  --load <name>        Resume a saved game
  --name <name>        Name this world
  --headless           Run without interactive console
  --force, -f          Kill any existing server first
```

### Server console (during `raunch start`)

| Key | Action |
|-----|--------|
| `n` / `Enter` | Advance to next page (manual mode) |
| `p` | Pause / resume |
| `t <sec>` | Set page interval (0 = manual, 10+ = auto) |
| `c` | List characters |
| `a <name>` | Attach to character's POV |
| `d` | Detach from current character |
| `w` | Show world state |
| `r` | Force OAuth token refresh |
| `?` | Show all commands |
| `q` | Save and exit |

## Web Frontend

The frontend connects via WebSocket and provides:
- Immersive narration feed with typewriter animations
- Character panel showing inner thoughts of attached character
- Director mode for narrator guidance
- Whisper system to influence characters
- Scenario browser and wizard
- Multi-book library with dashboard

## Project Structure

```
raunch/
├── main.py              CLI entry point (Click)
├── orchestrator.py      World page loop + agent coordination
├── world.py             World state management
├── llm.py               Claude client (OAuth + API key)
├── display.py           Rich terminal rendering + animations
├── wizard.py            Scenario generation
├── wizard_display.py    Animated wizard UI
├── agents/
│   ├── base.py          Base agent (history, summarization, refusal handling)
│   ├── narrator.py      World narrator
│   └── character.py     Autonomous NPC
├── prompts/
│   ├── narrator.py      Narrator system prompt
│   └── character.py     Character prompt template
├── server/
│   ├── app.py           FastAPI server
│   ├── ws.py            WebSocket handler
│   └── routes/          API endpoints
├── db_sqlite.py         SQLite database backend
├── db_firestore.py      Firestore database backend (cloud deploy)
frontend/
├── src/
│   ├── App.tsx           Main app with auth + routing
│   ├── components/       UI components
│   ├── hooks/            useGame, useLibrary, useWebSocket
│   └── lib/utils.ts      Shared utilities
scenarios/                Scenario JSON files
saves/                    Autosave data
characters/               Character template JSON files
```

## Content

All scenarios involve consenting adults. Content and themes are customizable through the wizard or by editing scenario JSON files.
