# Raunch Alpha Deployment Status

## What's Done

### Code Changes (all pushed to main)
1. **WebSocket integrated into FastAPI** - `/ws` endpoint for game connections
2. **Hosted mode** - `HOSTED_SCENARIO` env var auto-starts a world on boot
3. **Frontend updated** - WebSocket URL now uses `/ws` path for same-origin
4. **Scenarios committed** - 11 pre-built scenarios now in git
5. **CORS configured** - Allows raunch.motherhaven.net

### Deployments
- **Netlify** (frontend): Auto-deploys from main ✅
- **Render** (backend): Needs manual config update ⚠️

---

## What Boss Needs To Do

### 1. Update Render Service Settings

Go to: https://dashboard.render.com → raunch-backend → Settings

**Update these:**

| Setting | New Value |
|---------|-----------|
| **Start Command** | `uvicorn raunch.api:app --host 0.0.0.0 --port $PORT` |

**Add Environment Variable:**

| Key | Value |
|-----|-------|
| `HOSTED_SCENARIO` | `milk_money` |

Keep existing:
- `CLAUDE_CODE_OAUTH_TOKEN` (your 1-year token)

### 2. Trigger Redeploy

After updating settings, click "Manual Deploy" → "Deploy latest commit"

### 3. Update Netlify Env Vars (if needed)

The frontend should auto-detect URLs, but if needed:

| Key | Value |
|-----|-------|
| `VITE_API_URL` | `https://raunch.onrender.com` |
| `VITE_WS_URL` | `wss://raunch.onrender.com` |

Then redeploy Netlify.

---

## How It Works Now

```
┌─────────────────────────────────────────────────────────────┐
│                    raunch.onrender.com                       │
│                                                             │
│  ┌─────────────┐    ┌─────────────┐    ┌─────────────────┐ │
│  │  REST API   │    │  WebSocket  │    │   Orchestrator  │ │
│  │  /health    │    │    /ws      │    │   (milk_money)  │ │
│  │  /api/v1/*  │    │  game cmds  │    │   auto-started  │ │
│  └─────────────┘    └─────────────┘    └─────────────────┘ │
│         ↑                  ↑                    ↑          │
│         └──────────────────┴────────────────────┘          │
│                    All on same port ($PORT)                │
└─────────────────────────────────────────────────────────────┘
                              ↑
                              │ HTTPS/WSS
                              ↓
┌─────────────────────────────────────────────────────────────┐
│                 raunch.motherhaven.net                      │
│                                                             │
│  ┌─────────────────────────────────────────────────────┐   │
│  │  React Frontend (Netlify)                           │   │
│  │  - Splash screen                                    │   │
│  │  - Game interface                                   │   │
│  │  - WebSocket connection to backend                  │   │
│  └─────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────┘
```

---

## Test Checklist

After Render redeploys:

- [ ] https://raunch.onrender.com/health returns `{"status":"ok"}`
- [ ] https://raunch.onrender.com/api/v1/scenarios returns list of scenarios
- [ ] https://raunch.onrender.com/api/v1/world shows `"running": true`
- [ ] https://raunch.motherhaven.net connects and shows game

---

## Available Scenarios

1. milk_money (default)
2. last_call_in_nowhere
3. the_carnal_colosseum
4. the_nexus_of_flesh_and_mind
5. the_crimson_convergence
6. + 6 more

Change HOSTED_SCENARIO env var to switch scenarios.

---

For MoHa. 💎
