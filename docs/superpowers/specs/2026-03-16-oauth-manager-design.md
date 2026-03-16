# OAuth Manager for AdminSettings

**Date**: 2026-03-16
**Status**: Draft

## Overview

Add an OAuth token management system to the AdminSettings panel, allowing the admin (joshua.bell.828@gmail.com) to easily switch Claude Max OAuth tokens without restarting the backend. This enables testing with different accounts and recovering from rate limits.

## Requirements

1. Admin-only access (hardcoded to joshua.bell.828@gmail.com)
2. Token Vault: store multiple named OAuth tokens
3. "Login with Claude" button: PKCE OAuth flow in popup
4. Manual token paste option
5. Token status checking (usable/rate-limited/invalid)
6. Hot-swap: change active token without server restart

## Architecture

### Frontend

**AdminSettings.tsx** changes:
- Add admin check: `const isAdmin = user?.email === "joshua.bell.828@gmail.com"`
- Add OAuth Manager section (admin only)
- Token Vault UI with list, add, activate, delete, check
- OAuth login popup handler

### Backend

**New file: `raunch/oauth.py`**
- PKCE OAuth flow implementation
- Claude OAuth endpoints (authorize, token exchange)
- Uses official Claude Code client ID

**New endpoints in `raunch/api.py`**:
```
GET  /oauth/start                    - Start OAuth flow (redirect)
GET  /oauth/callback                 - Handle OAuth callback
GET  /api/v1/auth/tokens             - List stored tokens
POST /api/v1/auth/tokens             - Add named token
POST /api/v1/auth/tokens/{name}/activate - Activate token
POST /api/v1/auth/tokens/{name}/check    - Check token status
DELETE /api/v1/auth/tokens/{name}    - Delete token
```

**Changes to `raunch/llm.py`**:
- Add `reload_client()` function for hot-swap
- Read active token from storage on reload

### Storage

SQLite table `oauth_tokens`:
```sql
CREATE TABLE oauth_tokens (
    name TEXT PRIMARY KEY,
    token TEXT NOT NULL,
    status TEXT DEFAULT 'unknown',
    reset_time TEXT,
    checked_at TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE oauth_config (
    key TEXT PRIMARY KEY,
    value TEXT
);
-- Store active_token_name here
```

## OAuth Flow Details

**PKCE Flow**:
1. Generate code_verifier (random 32 bytes, base64url)
2. Generate code_challenge = base64url(SHA256(code_verifier))
3. Redirect to Claude authorize URL with challenge
4. User logs in, Claude redirects back with code
5. Exchange code + verifier for access token
6. Save token, hot-reload LLM client

**Claude OAuth Config**:
- Client ID: `9d1c250a-e61b-44d9-88ed-5944d1962f5e`
- Authorize URL: `https://claude.ai/oauth/authorize`
- Token URL: `https://console.anthropic.com/v1/oauth/token`
- Scope: `user:profile`

## UI Components

### Token Vault (admin only)

```
┌─ Token Vault ────────────────────────────────┐
│ ● active-token   sk-ant-oat...KQA   [Check] │
│   backup-token   sk-ant-oat...xyz   [Use]   │
│                                              │
│ [Name____] [Token________________] [+ Add]   │
└──────────────────────────────────────────────┘
```

Each token row shows:
- Active indicator (● dot)
- Name
- Token preview (first 10 + last 4 chars)
- Status badge (if rate-limited, show reset time)
- Actions: Use, Check, Delete

### OAuth Login Button

```
[🔑 Login with Claude Max]
```

Opens popup window to `/oauth/start`, which redirects to Claude. On callback, token is saved and popup closes.

## Security Considerations

1. Admin check is frontend + could add backend check on token endpoints
2. Tokens stored in local SQLite (same security as current .env approach)
3. PKCE prevents authorization code interception
4. State parameter prevents CSRF

## Implementation Order

1. Backend: OAuth routes (`raunch/oauth.py`)
2. Backend: Token storage in SQLite (`raunch/db.py`)
3. Backend: Token management API endpoints (`raunch/api.py`)
4. Backend: LLM client hot-reload (`raunch/llm.py`)
5. Frontend: OAuth Manager UI in AdminSettings
6. Testing: End-to-end OAuth flow

## References

- Motherhaven implementation: `services/moha-backend/app/oauth_routes.py`
- Motherhaven token vault: `services/moha-backend/app/settings_routes.py`
- Motherhaven UI: `services/moha-frontend/app/templates/pages/settings.html`
