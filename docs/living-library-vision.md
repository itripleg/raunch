# Living Library (LiLi) — Product Vision

> Working document capturing the north star for evolving Raunch into Living Library.

## Overview

**Living Library** is Motherhaven's flagship AI interactive fiction platform. Users create and nurture persistent story worlds ("books") that live and evolve over time.

## Company Context

- **Motherhaven** — makes bougie CLI games
- **CLI toolkit** — shared infrastructure in `../motherhaven` (Mohabots, "attach" concept)
- **Raunch** — current MVP, will become a "mode" within LiLi
- **Living Library** — the scaled, multi-user platform

## Core Concepts

| Term | Definition |
|------|------------|
| **Book** | A persistent world/story — scenario + characters + pages of generated content |
| **Living Library** | The platform housing all users' books |
| **Mode** | A game type or genre (Raunch = adult fiction mode, future modes possible) |

## Interfaces

Two full-featured interfaces for different audiences:

- **CLI** — Gamers, terminal lovers, power users. Bougie ASCII art, animations, keyboard-driven.
- **Web** — Casual users, non-techy, mobile-friendly. Point and click, visual.

Both can do everything. Same engine, different UX.

## Tiers

### Free (Local / Open Source)

| Feature | Details |
|---------|---------|
| Books | Unlimited (your storage) |
| Memory/History | Local SQLite |
| LLM | Your API keys or local models (Ollama, etc.) |
| Smut Wizard | Uses your own API |
| Single Player | Full experience |
| Multiplayer | Not available |
| Auth | Optional basic frontend password |

Users run on their own dime. No Motherhaven account required.

### Premium (Motherhaven Cloud)

| Feature | Details |
|---------|---------|
| Books | Unlimited (cloud storage) |
| Memory/History | Cloud DB, synced across devices |
| LLM | Managed — no API keys needed |
| Smut Wizard | **Premium rolls from Motherhaven API** |
| Single Player | Full experience |
| **Multiplayer** | **Yes — premium only** |
| Auth | Motherhaven account |
| Export | PDF/ebook export (potential) |

Premium features require connecting to Motherhaven API.

## Architecture Principles

1. **LLM-agnostic** — Claude, Ollama, future providers. Abstract the LLM layer.
2. **Open core** — Base engine is open source. Premium features are additive.
3. **CLI-first** — The CLI is a first-class citizen, not an afterthought.
4. **Offline-capable** — Free tier works fully offline with local models.
5. **Multiplayer as service** — Multiplayer requires Motherhaven infrastructure.

## Development Strategy

1. **Now:** Keep building Raunch MVP — learn what works
2. **Document:** This vision guides architectural decisions
3. **Later:** Evolve Raunch into LiLi when ready, Raunch becomes a "mode"

## Open Questions

- Export formats (PDF, ePub, etc.)?
- Custom themes/styling as premium?
- Character marketplace (share/sell characters)?
- Book sharing (read-only access to others' books)?

---

*Last updated: 2026-03-15*
