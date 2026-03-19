# Raunch - Claude Code Guidelines

## Project Overview
Raunch is an interactive fiction/game platform with a Python backend and React frontend.

## ⚠️ CRITICAL: Git & Deploy Guardrails

**Every push to `main` triggers a production deployment and consumes build credits.**

### Rules (NON-NEGOTIABLE)

1. **NEVER push directly to `main`**
   - Always work on feature branches: `feature/your-feature`, `fix/bug-name`, `auto-claude/task-name`
   - Use Pull Requests to merge to main
   - Only humans approve merges to main

2. **Batch your commits**
   - DO NOT commit after every small change
   - Group related changes into logical commits
   - **Maximum 5 commits per session** unless explicitly authorized
   - Prefer 1-3 well-organized commits over many small ones

3. **Before pushing, ask yourself:**
   - "Is this ready for production?"
   - "Have I batched my changes?"
   - "Am I on a feature branch, not main?"

4. **Push frequency limits**
   - Max 2 pushes per hour to any branch
   - If you need to iterate, use local commits and push once when ready

### Branch Strategy
```
main (protected - deploys to prod)
├── unstable (integration/staging)
├── feature/* (new features)
├── fix/* (bug fixes)
└── auto-claude/* (agent work branches)
```

### Commit Message Format
```
<type>: <description>

Types: feat, fix, refactor, docs, test, chore
Example: feat: Add character memory system
```

## Project Structure

```
raunch/
├── raunch/           # Python backend
│   ├── server/       # Flask API server
│   ├── agents/       # Character AI agents
│   ├── db.py         # Database abstraction
│   └── orchestrator.py
├── frontend/         # React/TypeScript frontend
│   └── src/
├── scenarios/        # Game scenarios (JSON)
├── characters/       # Character definitions
└── tests/            # Python tests
```

## Development Commands

```bash
# Backend
python -m raunch.server        # Start API server
python -m raunch start         # Start CLI game
pytest tests/                  # Run tests

# Frontend
cd frontend && npm run dev     # Dev server
cd frontend && npm run build   # Production build
```

## Tech Stack
- **Backend**: Python, Flask, SQLite/Firestore
- **Frontend**: React, TypeScript, Vite, TailwindCSS
- **Auth**: Google OAuth
- **Deploy**: Render (backend), Netlify (frontend) - CURRENTLY SUSPENDED

## Agent Guidelines

1. **Read before modifying** - Understand existing code patterns
2. **Minimal changes** - Don't over-engineer or refactor unnecessarily
3. **Test your changes** - Run tests before committing
4. **Document decisions** - Add comments for non-obvious logic
5. **Respect the architecture** - Backend/frontend separation, existing patterns

## Current Status

- Production temporarily on ngrok while Netlify suspension is resolved
- Be extra conservative with commits during this period
