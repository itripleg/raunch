# Raunch — Multi-Agent Adult Interactive Fiction

A tick-based autonomous world simulation powered by Claude. Characters think, act, and interact independently. You can observe by "attaching" to any character to see their inner thoughts, or take control of a character in player mode.

## Architecture

```
orchestrator.py          World tick loop — coordinates all agents
  ├── narrator agent     Advances world state, sets scenes, generates events
  ├── character agents   Autonomous NPCs with inner monologue + actions
  └── world.py           Single source of truth (locations, time, events)
```

**Tick cycle:**
1. Narrator receives world state → produces narration + events + world changes
2. Each character receives narration → produces inner thoughts + action
3. World state updates, display renders
4. Repeat

## Auth

Uses your Claude Max OAuth credentials automatically (reads from `~/.claude/.credentials.json`). No API key needed — just be logged into the `claude` CLI.

Fallback: set `ANTHROPIC_API_KEY` env var for pay-per-token.

## Setup

```bash
pip install -e .
```

## Usage

### Autonomous mode (watch the world unfold)
```bash
raunch start
```

### Player mode (step-by-step, you control a character)
```bash
raunch play --as "Lyra"
```

### Create a character
```bash
raunch create
```

### List character templates
```bash
raunch list
```

## Commands during simulation

| Key | Action |
|-----|--------|
| `a <name>` | Attach to character (see their inner thoughts) |
| `d` | Detach |
| `c` | List characters |
| `w` | Show world state |
| `p` | Pause/resume |
| `q` | Quit (autosaves) |

## Project Structure

```
raunch/
├── main.py           CLI entry point (Click)
├── orchestrator.py   World tick loop + agent coordination
├── world.py          World state management
├── client.py         Anthropic SDK client with OAuth
├── display.py        Rich terminal rendering
├── agents/
│   ├── base.py       Base agent (history, summarization, tick)
│   ├── narrator.py   World narrator
│   └── character.py  Autonomous NPC
├── prompts/
│   ├── narrator.py   Narrator system prompt
│   └── character.py  Character prompt template
saves/                Autosave JSON files
characters/           Character template JSON files
```

## Content

Setting: Future sci-fi fantasy — starships and sorcery.
Core themes: Breeding, pregnancy, fertility (magic + biotech).
All content involves consenting adults only.
