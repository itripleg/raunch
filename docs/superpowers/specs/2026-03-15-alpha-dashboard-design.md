# Alpha Dashboard & Splash Screen Design

**Date:** 2026-03-15
**Status:** Approved
**Author:** Claude + Josh

## Overview

Redesign the Raunch splash screen and landing page to reflect alpha testing status. Replace the direct-to-game flow with an alpha testing dashboard that provides testers with access to feedback tools, voting, and the game itself.

## Goals

- Communicate alpha status clearly via animated splash
- Provide a hub for tester communication (feedback kanban, polls)
- Enable dev-to-tester updates via hero message
- Keep it simple and unsecured for small alpha group (~5 testers)
- Lay groundwork for future Kinde auth integration

## Non-Goals

- Full authentication system (coming later with Kinde)
- Smut Storage implementation (placeholder only)
- URL-based routing (keeping state machine pattern)

---

## State Machine & Navigation

### Current Flow
```
SPLASH → SCENARIO_SELECTOR → (NICKNAME_PROMPT) → GAME
```

### New Flow
```
SPLASH (with ALPHA stamp)
    ↓
DASHBOARD (hero + cards)
    ↓ (based on card clicked)
    ├── KANBAN (feedback board)
    ├── VOTING (polls)
    ├── ABOUT (getting started)
    ├── STORAGE (placeholder)
    └── GAME_ENTRY → SCENARIO_SELECTOR → GAME
```

### State Management
- Add `view` state: `'dashboard' | 'kanban' | 'voting' | 'about' | 'storage' | 'game'`
- Dashboard becomes new home after splash
- Back navigation returns to dashboard
- `isAdmin` boolean for dev features, persisted to localStorage

### Admin Mode
- Dev code hidden in settings (gear icon in header)
- Code checked against environment variable via API
- Unlocks: drag kanban items, delete, edit hero, create polls

---

## Splash Screen Animation

### Sequence
1. **0-1.5s:** Raunch logo fades in (existing gradient animation)
2. **1.5-2.2s:** "ALPHA" stamps in below logo
   - Starts scaled up (1.5x) and slightly above
   - Slams down with spring physics
   - Brief screen shake on impact (2-3px)
   - Glow pulse on landing (pink/magenta)
3. **2.2-2.5s:** Hold
4. **2.5-3.2s:** Fade out, dashboard fades in

### ALPHA Text Styling
- Monospace or bold condensed font
- Outlined or semi-transparent fill
- Slight rotation (-2deg) for stamped look
- Pink/magenta from existing palette

### Connection Behavior
- No auto-connect during splash
- WebSocket connects when user clicks "Play Raunch" card

---

## Dashboard Layout

```
┌─────────────────────────────────────────────────────┐
│  RAUNCH ALPHA                        [settings]    │
├─────────────────────────────────────────────────────┤
│                                                     │
│   ┌─────────────────────────────────────────────┐   │
│   │  HERO: Dev Message / News                   │   │
│   │  "Welcome to alpha! Currently working on…"  │   │
│   │  Updated 2 days ago                         │   │
│   └─────────────────────────────────────────────┘   │
│                                                     │
│   ┌─────────────┐  ┌─────────────┐  ┌───────────┐   │
│   │  Feedback   │  │  Play       │  │  About    │   │
│   │  Board      │  │  Raunch     │  │           │   │
│   └─────────────┘  └─────────────┘  └───────────┘   │
│                                                     │
│   ┌─────────────┐  ┌─────────────┐                  │
│   │  Voting     │  │  Smut       │ ← Coming Soon   │
│   │             │  │  Storage    │                  │
│   └─────────────┘  └─────────────┘                  │
│                                                     │
└─────────────────────────────────────────────────────┘
```

### Cards
| Card | Action |
|------|--------|
| Feedback Board | Navigate to kanban |
| Play Raunch | Connect WS, navigate to scenario selector |
| About | Navigate to getting started page |
| Voting | Navigate to polls |
| Smut Storage | Disabled, shows "Coming Soon" modal |

### Hero Message
- Admin can edit inline (click to edit)
- Supports basic markdown (bold, links)
- Shows "Updated X ago" timestamp

### Responsive
- Mobile: cards stack vertically
- Tablet: 2-column grid
- Desktop: 3-column grid

---

## Feedback Kanban

### Columns
| Column | Who Adds | Features |
|--------|----------|----------|
| Planned | Admin | Dev's vision, no voting |
| Considering | Admin | Things being evaluated |
| Requests | Anyone | Upvoting enabled, sorted by votes |
| Results | Admin | Outcome badge (shipped/declined + reason) |

### Item Card
- Title (required)
- Notes/description (optional, expandable)
- Upvote button + count (Requests only)
- Outcome badge (Results only)

### Admin Features
- Drag items between columns
- Delete items (with confirmation)
- Add items to any column
- Add outcome notes when moving to Results

### User Features
- Submit requests via [+ Request] button
- Upvote requests (one per browser via localStorage UUID)

### Mobile
- Tab-based view (tap column header to switch)

---

## Voting / Polls

### Poll Types
- **Single choice:** Pick one option
- **Multi-select:** Pick up to N options (e.g., "top 5 kinks")

### Poll States
- **Active:** Voting open, shows live counts (configurable)
- **Closed:** Voting ended, shows winner + percentages

### Features
- One vote per browser (localStorage tracking)
- User-submitted options (toggleable per poll)
- Duplicate detection for submissions (case-insensitive fuzzy match)
- Real-time or hidden results (admin choice)

### Admin Features
- Create/edit/delete polls
- Close polls early
- Pin active poll to top
- Remove inappropriate submissions
- Toggle submissions on/off per poll

### Layout
- Active polls at top, full width
- Closed polls as collapsed summary cards below

---

## About / Getting Started

- Static content page with sections:
  - What is Raunch
  - How to test
  - Known limitations
  - Contact/feedback
- Admin can edit content (stored in `alpha_content` table, supports markdown)

---

## Smut Storage (Placeholder)

- Card shows "Coming Soon" badge
- Click opens modal explaining the feature
- Optional "Notify me" interest logging

---

## Data Model

### Tables

```sql
-- Hero/dev messages
alpha_messages (
    id INTEGER PRIMARY KEY,
    content TEXT,
    updated_at TIMESTAMP
)

-- About page content
alpha_content (
    id INTEGER PRIMARY KEY,
    slug TEXT UNIQUE NOT NULL,  -- 'about', 'getting-started', etc.
    content TEXT,
    updated_at TIMESTAMP
)

-- Kanban items
feedback_items (
    id INTEGER PRIMARY KEY,
    title TEXT NOT NULL,
    notes TEXT,
    status TEXT CHECK(status IN ('planned','considering','requests','results')),
    outcome TEXT CHECK(outcome IN ('shipped','declined',NULL)),
    outcome_notes TEXT,
    upvotes INTEGER DEFAULT 0,
    created_at TIMESTAMP,
    updated_at TIMESTAMP
)

-- Track upvotes by browser
feedback_votes (
    id INTEGER PRIMARY KEY,
    item_id INTEGER REFERENCES feedback_items(id) ON DELETE CASCADE,
    voter_id TEXT,  -- localStorage UUID
    UNIQUE(item_id, voter_id)
)

-- Polls
polls (
    id INTEGER PRIMARY KEY,
    question TEXT NOT NULL,
    poll_type TEXT CHECK(poll_type IN ('single','multi')),
    max_selections INTEGER,
    allow_submissions BOOLEAN DEFAULT TRUE,
    show_live_results BOOLEAN DEFAULT TRUE,
    closes_at TIMESTAMP,
    is_closed BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP
)

-- Poll options
poll_options (
    id INTEGER PRIMARY KEY,
    poll_id INTEGER REFERENCES polls(id) ON DELETE CASCADE,
    label TEXT NOT NULL,
    vote_count INTEGER DEFAULT 0,
    submitted_by TEXT  -- NULL if admin-created
)

-- Track poll votes
poll_votes (
    id INTEGER PRIMARY KEY,
    poll_id INTEGER REFERENCES polls(id) ON DELETE CASCADE,
    option_id INTEGER REFERENCES poll_options(id) ON DELETE CASCADE,
    voter_id TEXT,
    UNIQUE(poll_id, option_id, voter_id)
)
```

---

## API Endpoints

```
# Hero message
GET  /api/v1/alpha/message
PUT  /api/v1/alpha/message              (admin)

# About/content pages
GET  /api/v1/alpha/content/:slug
PUT  /api/v1/alpha/content/:slug        (admin)

# Feedback kanban
GET  /api/v1/alpha/feedback
POST /api/v1/alpha/feedback             (anyone for requests, admin for others)
PUT  /api/v1/alpha/feedback/:id         (admin)
DELETE /api/v1/alpha/feedback/:id       (admin)
POST /api/v1/alpha/feedback/:id/vote

# Polls
GET  /api/v1/alpha/polls
POST /api/v1/alpha/polls                (admin)
PUT  /api/v1/alpha/polls/:id            (admin)
DELETE /api/v1/alpha/polls/:id          (admin)
POST /api/v1/alpha/polls/:id/vote
POST /api/v1/alpha/polls/:id/options    (anyone if submissions enabled)

# Admin auth
POST /api/v1/alpha/admin/verify         (check dev code)
```

### Admin Verification
- Dev code stored in environment variable
- POST /verify returns `{ valid: true }` on success
- Frontend stores admin state in localStorage

---

## Tech Stack

- **Frontend:** React 19, Tailwind 4, Framer Motion (existing)
- **Backend:** Existing Raunch Python API + SQLite
- **State:** Extended state machine pattern (no router)
- **Auth:** Dev code for now, Kinde later

---

## Open Questions

None - all clarified during brainstorming.

---

## Future Considerations

- Kinde auth integration will replace dev code
- Smut Storage requires server-side session isolation
- May add URL routing when app grows
- Ranking poll type (drag to order) as stretch goal
