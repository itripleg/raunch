# OAuth Manager Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add OAuth token management to AdminSettings panel for easy Claude Max token switching without server restart.

**Architecture:** Backend OAuth routes (PKCE flow) + token storage in SQLite + frontend Token Vault UI in AdminSettings. Admin-only access hardcoded to joshua.bell.828@gmail.com.

**Tech Stack:** FastAPI, SQLite, React/TypeScript, PKCE OAuth

---

## File Structure

**Create:**
- `raunch/oauth.py` - PKCE OAuth flow implementation
- `raunch/auth_db.py` - OAuth token storage functions

**Modify:**
- `raunch/db.py` - Add oauth_tokens and oauth_config tables to init_db()
- `raunch/api.py` - Mount OAuth routes and token management endpoints
- `raunch/llm.py` - Add reload_client() for hot-swap
- `frontend/src/components/AdminSettings.tsx` - Add OAuth Manager UI

---

## Chunk 1: Backend OAuth Infrastructure

### Task 1: Add OAuth Tables to Database

**Files:**
- Modify: `raunch/db.py:72-226` (init_db function)

- [ ] **Step 1: Add OAuth tables to init_db()**

Add these tables to the `init_db()` function's CREATE TABLE statements:

```python
        -- OAuth token management
        CREATE TABLE IF NOT EXISTS oauth_tokens (
            name TEXT PRIMARY KEY,
            token TEXT NOT NULL,
            status TEXT DEFAULT 'unknown',
            reset_time TEXT,
            checked_at TEXT,
            created_at TEXT DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS oauth_config (
            key TEXT PRIMARY KEY,
            value TEXT
        );
```

- [ ] **Step 2: Run to verify tables are created**

```bash
cd C:/dev/raunch && python -c "from raunch.db import init_db; init_db(); print('OK')"
```

Expected: `OK` (no errors)

- [ ] **Step 3: Commit**

```bash
git add raunch/db.py
git commit -m "feat(db): add oauth_tokens and oauth_config tables"
```

---

### Task 2: Create OAuth Token Storage Module

**Files:**
- Create: `raunch/auth_db.py`

- [ ] **Step 1: Create auth_db.py with token CRUD functions**

```python
"""OAuth token storage functions."""

import json
from typing import Dict, Any, List, Optional
from .db import _get_conn


def list_tokens() -> List[Dict[str, Any]]:
    """List all stored OAuth tokens."""
    conn = _get_conn()
    rows = conn.execute(
        "SELECT name, token, status, reset_time, checked_at, created_at FROM oauth_tokens ORDER BY name"
    ).fetchall()
    return [dict(r) for r in rows]


def get_token(name: str) -> Optional[Dict[str, Any]]:
    """Get a token by name."""
    conn = _get_conn()
    row = conn.execute(
        "SELECT name, token, status, reset_time, checked_at, created_at FROM oauth_tokens WHERE name = ?",
        (name,)
    ).fetchone()
    return dict(row) if row else None


def save_token(name: str, token: str) -> Dict[str, Any]:
    """Save or update a named token."""
    conn = _get_conn()
    conn.execute(
        """INSERT INTO oauth_tokens (name, token, status, created_at)
           VALUES (?, ?, 'unknown', CURRENT_TIMESTAMP)
           ON CONFLICT(name) DO UPDATE SET token = excluded.token, status = 'unknown'""",
        (name, token)
    )
    conn.commit()
    return get_token(name)


def delete_token(name: str) -> bool:
    """Delete a token by name."""
    conn = _get_conn()
    cursor = conn.execute("DELETE FROM oauth_tokens WHERE name = ?", (name,))
    conn.commit()
    return cursor.rowcount > 0


def update_token_status(name: str, status: str, reset_time: Optional[str] = None) -> bool:
    """Update a token's status."""
    conn = _get_conn()
    cursor = conn.execute(
        """UPDATE oauth_tokens SET status = ?, reset_time = ?, checked_at = CURRENT_TIMESTAMP
           WHERE name = ?""",
        (status, reset_time, name)
    )
    conn.commit()
    return cursor.rowcount > 0


def get_active_token_name() -> Optional[str]:
    """Get the name of the currently active token."""
    conn = _get_conn()
    row = conn.execute(
        "SELECT value FROM oauth_config WHERE key = 'active_token_name'"
    ).fetchone()
    return row["value"] if row else None


def set_active_token_name(name: Optional[str]) -> None:
    """Set the active token name."""
    conn = _get_conn()
    if name is None:
        conn.execute("DELETE FROM oauth_config WHERE key = 'active_token_name'")
    else:
        conn.execute(
            """INSERT INTO oauth_config (key, value) VALUES ('active_token_name', ?)
               ON CONFLICT(key) DO UPDATE SET value = excluded.value""",
            (name,)
        )
    conn.commit()


def get_active_token() -> Optional[str]:
    """Get the actual token value of the active token."""
    name = get_active_token_name()
    if not name:
        return None
    token_data = get_token(name)
    return token_data["token"] if token_data else None
```

- [ ] **Step 2: Test the module imports correctly**

```bash
cd C:/dev/raunch && python -c "from raunch.auth_db import list_tokens, save_token; print('OK')"
```

Expected: `OK`

- [ ] **Step 3: Commit**

```bash
git add raunch/auth_db.py
git commit -m "feat(auth): add OAuth token storage module"
```

---

### Task 3: Create OAuth PKCE Flow Module

**Files:**
- Create: `raunch/oauth.py`

- [ ] **Step 1: Create oauth.py with PKCE flow**

```python
"""Claude OAuth PKCE flow implementation."""

import os
import secrets
import hashlib
import base64
import logging
from typing import Dict, Optional
from urllib.parse import urlencode, quote

import httpx
from fastapi import APIRouter, Request
from fastapi.responses import RedirectResponse, HTMLResponse

from .auth_db import save_token, set_active_token_name

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/oauth", tags=["oauth"])

# Claude OAuth configuration
CLAUDE_CLIENT_ID = "9d1c250a-e61b-44d9-88ed-5944d1962f5e"
CLAUDE_AUTHORIZE_URL = "https://claude.ai/oauth/authorize"
CLAUDE_TOKEN_URL = "https://console.anthropic.com/v1/oauth/token"

# In-memory PKCE storage (per-process, short-lived)
_pkce_storage: Dict[str, Dict[str, str]] = {}


def _generate_pkce_pair() -> tuple[str, str]:
    """Generate PKCE code_verifier and code_challenge."""
    code_verifier = secrets.token_urlsafe(32)
    digest = hashlib.sha256(code_verifier.encode()).digest()
    code_challenge = base64.urlsafe_b64encode(digest).rstrip(b"=").decode()
    return code_verifier, code_challenge


def _get_callback_url(request: Request) -> str:
    """Get OAuth callback URL from request."""
    # Use X-Forwarded headers if behind proxy
    scheme = request.headers.get("x-forwarded-proto", request.url.scheme)
    host = request.headers.get("x-forwarded-host", request.url.netloc)
    return f"{scheme}://{host}/oauth/callback"


@router.get("/start")
async def start_oauth(request: Request):
    """Start Claude OAuth flow with PKCE."""
    code_verifier, code_challenge = _generate_pkce_pair()
    state = secrets.token_urlsafe(16)

    _pkce_storage[state] = {"code_verifier": code_verifier}

    callback_url = _get_callback_url(request)
    auth_params = {
        "client_id": CLAUDE_CLIENT_ID,
        "response_type": "code",
        "redirect_uri": callback_url,
        "code_challenge": code_challenge,
        "code_challenge_method": "S256",
        "state": state,
        "scope": "user:profile",
    }

    auth_url = f"{CLAUDE_AUTHORIZE_URL}?{urlencode(auth_params)}"
    logger.info(f"Starting OAuth flow, callback: {callback_url}")

    return RedirectResponse(url=auth_url)


@router.get("/callback")
async def oauth_callback(request: Request, code: Optional[str] = None, state: Optional[str] = None, error: Optional[str] = None):
    """Handle OAuth callback from Claude."""
    # Error from OAuth provider
    if error:
        error_desc = request.query_params.get("error_description", "Unknown error")
        logger.error(f"OAuth error: {error} - {error_desc}")
        return HTMLResponse(_callback_html(success=False, message=error_desc))

    if not code or not state:
        return HTMLResponse(_callback_html(success=False, message="Missing code or state"))

    # Validate state and get verifier
    pkce_data = _pkce_storage.pop(state, None)
    if not pkce_data:
        return HTMLResponse(_callback_html(success=False, message="Invalid or expired state"))

    code_verifier = pkce_data["code_verifier"]
    callback_url = _get_callback_url(request)

    try:
        async with httpx.AsyncClient() as client:
            response = await client.post(
                CLAUDE_TOKEN_URL,
                data={
                    "grant_type": "authorization_code",
                    "client_id": CLAUDE_CLIENT_ID,
                    "code": code,
                    "redirect_uri": callback_url,
                    "code_verifier": code_verifier,
                },
                headers={"Content-Type": "application/x-www-form-urlencoded"},
                timeout=30,
            )

        if response.status_code != 200:
            logger.error(f"Token exchange failed: {response.status_code} - {response.text}")
            return HTMLResponse(_callback_html(success=False, message="Token exchange failed"))

        token_data = response.json()
        access_token = token_data.get("access_token")

        if not access_token:
            return HTMLResponse(_callback_html(success=False, message="No access token in response"))

        # Save token with auto-generated name
        import time
        token_name = f"oauth-{int(time.time())}"
        save_token(token_name, access_token)
        set_active_token_name(token_name)

        # Reload LLM client
        try:
            from .llm import reload_client
            reload_client()
        except Exception as e:
            logger.warning(f"Could not reload LLM client: {e}")

        logger.info(f"OAuth flow completed, saved as '{token_name}'")
        return HTMLResponse(_callback_html(success=True, message=f"Token saved as '{token_name}'"))

    except httpx.TimeoutException:
        return HTMLResponse(_callback_html(success=False, message="Token exchange timed out"))
    except Exception as e:
        logger.error(f"Token exchange error: {e}")
        return HTMLResponse(_callback_html(success=False, message=str(e)))


def _callback_html(success: bool, message: str) -> str:
    """Generate callback result HTML that closes popup and notifies parent."""
    status = "success" if success else "error"
    return f"""<!DOCTYPE html>
<html>
<head><title>OAuth {status.title()}</title></head>
<body>
<script>
if (window.opener) {{
    window.opener.postMessage({{ type: 'oauth-callback', success: {str(success).lower()}, message: '{message}' }}, '*');
    window.close();
}} else {{
    document.body.innerHTML = '<h2>{status.title()}</h2><p>{message}</p><p>You can close this window.</p>';
}}
</script>
<noscript><h2>{status.title()}</h2><p>{message}</p></noscript>
</body>
</html>"""
```

- [ ] **Step 2: Test module imports**

```bash
cd C:/dev/raunch && python -c "from raunch.oauth import router; print('OK')"
```

Expected: `OK`

- [ ] **Step 3: Commit**

```bash
git add raunch/oauth.py
git commit -m "feat(oauth): add PKCE OAuth flow for Claude Max login"
```

---

### Task 4: Add LLM Client Hot-Reload

**Files:**
- Modify: `raunch/llm.py:286-295`

- [ ] **Step 1: Add reload_client function to llm.py**

Add after the `_instance` declaration around line 287:

```python
def reload_client() -> None:
    """Reload the LLM client with current token from database."""
    global _instance

    # Try to get active token from database
    try:
        from .auth_db import get_active_token
        token = get_active_token()
        if token:
            os.environ["CLAUDE_CODE_OAUTH_TOKEN"] = token
            logger.info(f"Loaded OAuth token from database: {token[:20]}...")
    except Exception as e:
        logger.debug(f"Could not load token from database: {e}")

    # Reset singleton to force re-initialization
    _instance = None
    logger.info("LLM client will reinitialize on next use")
```

- [ ] **Step 2: Add import for os at top of file if not present**

Check line 14 - os should already be imported. If not, add it.

- [ ] **Step 3: Test the function exists**

```bash
cd C:/dev/raunch && python -c "from raunch.llm import reload_client; print('OK')"
```

Expected: `OK`

- [ ] **Step 4: Commit**

```bash
git add raunch/llm.py
git commit -m "feat(llm): add reload_client for OAuth token hot-swap"
```

---

### Task 5: Add Token Management API Endpoints

**Files:**
- Modify: `raunch/api.py`

- [ ] **Step 1: Add imports at top of api.py (after line 47)**

```python
from .oauth import router as oauth_router
from .auth_db import (
    list_tokens as db_list_tokens,
    get_token as db_get_token,
    save_token as db_save_token,
    delete_token as db_delete_token,
    update_token_status,
    get_active_token_name,
    set_active_token_name,
)
from .llm import reload_client
```

- [ ] **Step 2: Mount OAuth router after line 204 (after other routers)**

```python
# OAuth routes
app.include_router(oauth_router)
```

- [ ] **Step 3: Add Pydantic models after existing models (around line 175)**

```python
class TokenInfo(BaseModel):
    """OAuth token info (without actual token value for security)."""
    name: str
    preview: str
    status: str
    reset_time: Optional[str] = None
    active: bool = False


class TokenCreate(BaseModel):
    """Request to create a token."""
    name: str
    token: str


class TokenActivateResponse(BaseModel):
    """Response after activating a token."""
    success: bool
    name: str
    message: str
```

- [ ] **Step 4: Add token management endpoints after alpha dashboard endpoints (end of file)**

```python
# =============================================================================
# OAuth Token Management Endpoints
# =============================================================================

@app.get("/api/v1/auth/tokens", response_model=List[TokenInfo])
async def list_auth_tokens():
    """List all stored OAuth tokens."""
    tokens = db_list_tokens()
    active_name = get_active_token_name()

    return [
        TokenInfo(
            name=t["name"],
            preview=f"{t['token'][:15]}...{t['token'][-4:]}" if len(t["token"]) > 19 else "***",
            status=t["status"] or "unknown",
            reset_time=t["reset_time"],
            active=t["name"] == active_name,
        )
        for t in tokens
    ]


@app.post("/api/v1/auth/tokens", response_model=TokenInfo)
async def create_auth_token(req: TokenCreate):
    """Save a new OAuth token."""
    if not req.token.startswith("sk-ant-"):
        raise HTTPException(status_code=400, detail="Invalid token format")

    db_save_token(req.name, req.token)
    active_name = get_active_token_name()

    return TokenInfo(
        name=req.name,
        preview=f"{req.token[:15]}...{req.token[-4:]}",
        status="unknown",
        active=req.name == active_name,
    )


@app.post("/api/v1/auth/tokens/{name}/activate", response_model=TokenActivateResponse)
async def activate_auth_token(name: str):
    """Activate a stored token."""
    token_data = db_get_token(name)
    if not token_data:
        raise HTTPException(status_code=404, detail=f"Token '{name}' not found")

    set_active_token_name(name)
    reload_client()

    return TokenActivateResponse(
        success=True,
        name=name,
        message=f"Token '{name}' activated",
    )


@app.delete("/api/v1/auth/tokens/{name}")
async def delete_auth_token(name: str):
    """Delete a stored token."""
    success = db_delete_token(name)
    if not success:
        raise HTTPException(status_code=404, detail=f"Token '{name}' not found")

    # If deleted token was active, clear active
    if get_active_token_name() == name:
        set_active_token_name(None)

    return {"success": True, "message": f"Token '{name}' deleted"}


@app.post("/api/v1/auth/tokens/{name}/check")
async def check_auth_token(name: str):
    """Check if a token is usable or rate-limited."""
    token_data = db_get_token(name)
    if not token_data:
        raise HTTPException(status_code=404, detail=f"Token '{name}' not found")

    # Save current env token
    original_token = os.environ.get("CLAUDE_CODE_OAUTH_TOKEN")

    try:
        # Temporarily set this token
        os.environ["CLAUDE_CODE_OAUTH_TOKEN"] = token_data["token"]

        # Try a minimal LLM call
        from .llm import LLMClient
        client = LLMClient()
        response = client.chat(
            system="Reply with only 'ok'.",
            messages=[{"role": "user", "content": "Say ok"}],
            max_tokens=10,
        )

        # Check for rate limit in response
        if "hit your limit" in response.lower() or "resets" in response.lower():
            update_token_status(name, "rate_limited")
            return {"name": name, "status": "rate_limited", "message": response}
        else:
            update_token_status(name, "usable")
            return {"name": name, "status": "usable", "message": "Token is working"}

    except Exception as e:
        error_str = str(e).lower()
        if "401" in error_str or "unauthorized" in error_str:
            update_token_status(name, "invalid")
            return {"name": name, "status": "invalid", "message": "Token is invalid"}
        else:
            update_token_status(name, "error")
            return {"name": name, "status": "error", "message": str(e)}
    finally:
        # Restore original token
        if original_token:
            os.environ["CLAUDE_CODE_OAUTH_TOKEN"] = original_token
        elif "CLAUDE_CODE_OAUTH_TOKEN" in os.environ:
            del os.environ["CLAUDE_CODE_OAUTH_TOKEN"]
```

- [ ] **Step 5: Add os import if not present (check top of file)**

Add `import os` to imports if missing.

- [ ] **Step 6: Test server starts**

```bash
cd C:/dev/raunch && timeout 5 python -c "from raunch.api import app; print('OK')" || echo "Timeout OK"
```

Expected: `OK` or timeout (both fine)

- [ ] **Step 7: Commit**

```bash
git add raunch/api.py
git commit -m "feat(api): add OAuth token management endpoints"
```

---

## Chunk 2: Frontend OAuth Manager UI

### Task 6: Update AdminSettings with OAuth Manager

**Files:**
- Modify: `frontend/src/components/AdminSettings.tsx`

- [ ] **Step 1: Replace entire AdminSettings.tsx content**

```tsx
import { useState, useEffect, useCallback } from "react";
import { motion, AnimatePresence } from "motion/react";
import { X, ShieldCheck, Bug, LogOut, Key, Plus, Trash2, Check, Loader2, RefreshCw } from "lucide-react";
import { useKindeAuth } from "@kinde-oss/kinde-auth-react";

const ADMIN_EMAIL = "joshua.bell.828@gmail.com";

type TokenInfo = {
  name: string;
  preview: string;
  status: string;
  reset_time?: string;
  active: boolean;
};

type Props = {
  isOpen: boolean;
  onClose: () => void;
  onOpenDebug?: () => void;
  apiUrl?: string;
};

export function AdminSettings({ isOpen, onClose, onOpenDebug, apiUrl = "http://localhost:8000" }: Props) {
  const { user, logout } = useKindeAuth();
  const isAdmin = user?.email === ADMIN_EMAIL;

  const [tokens, setTokens] = useState<TokenInfo[]>([]);
  const [loading, setLoading] = useState(false);
  const [newTokenName, setNewTokenName] = useState("");
  const [newTokenValue, setNewTokenValue] = useState("");
  const [checkingToken, setCheckingToken] = useState<string | null>(null);

  const fetchTokens = useCallback(async () => {
    try {
      const res = await fetch(`${apiUrl}/api/v1/auth/tokens`);
      if (res.ok) {
        const data = await res.json();
        setTokens(data);
      }
    } catch (err) {
      console.error("Failed to fetch tokens:", err);
    }
  }, [apiUrl]);

  useEffect(() => {
    if (isOpen && isAdmin) {
      fetchTokens();
    }
  }, [isOpen, isAdmin, fetchTokens]);

  // Listen for OAuth callback messages
  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      if (event.data?.type === "oauth-callback") {
        fetchTokens();
      }
    };
    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  }, [fetchTokens]);

  const handleLogout = () => {
    logout();
    onClose();
  };

  const handleOpenDebug = () => {
    onClose();
    onOpenDebug?.();
  };

  const handleOAuthLogin = () => {
    window.open(`${apiUrl}/oauth/start`, "oauth", "width=600,height=700");
  };

  const handleAddToken = async () => {
    if (!newTokenName.trim() || !newTokenValue.trim()) return;
    setLoading(true);
    try {
      const res = await fetch(`${apiUrl}/api/v1/auth/tokens`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: newTokenName.trim(), token: newTokenValue.trim() }),
      });
      if (res.ok) {
        setNewTokenName("");
        setNewTokenValue("");
        fetchTokens();
      }
    } catch (err) {
      console.error("Failed to add token:", err);
    } finally {
      setLoading(false);
    }
  };

  const handleActivateToken = async (name: string) => {
    setLoading(true);
    try {
      await fetch(`${apiUrl}/api/v1/auth/tokens/${encodeURIComponent(name)}/activate`, { method: "POST" });
      fetchTokens();
    } catch (err) {
      console.error("Failed to activate token:", err);
    } finally {
      setLoading(false);
    }
  };

  const handleDeleteToken = async (name: string) => {
    if (!confirm(`Delete token "${name}"?`)) return;
    try {
      await fetch(`${apiUrl}/api/v1/auth/tokens/${encodeURIComponent(name)}`, { method: "DELETE" });
      fetchTokens();
    } catch (err) {
      console.error("Failed to delete token:", err);
    }
  };

  const handleCheckToken = async (name: string) => {
    setCheckingToken(name);
    try {
      await fetch(`${apiUrl}/api/v1/auth/tokens/${encodeURIComponent(name)}/check`, { method: "POST" });
      fetchTokens();
    } catch (err) {
      console.error("Failed to check token:", err);
    } finally {
      setCheckingToken(null);
    }
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50"
          />

          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 20 }}
            transition={{ type: "spring", stiffness: 400, damping: 30 }}
            className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-full max-w-md z-50"
          >
            <div className="bg-card border border-border rounded-2xl shadow-2xl overflow-hidden max-h-[85vh] flex flex-col">
              <div className="flex items-center justify-between px-6 py-4 border-b border-border">
                <h2 className="text-lg font-semibold text-foreground">Settings</h2>
                <button onClick={onClose} className="p-1 text-muted-foreground hover:text-foreground transition-colors">
                  <X className="w-5 h-5" />
                </button>
              </div>

              <div className="p-6 space-y-6 overflow-y-auto">
                {/* Auth Status */}
                <div className="space-y-3">
                  <div className="flex items-center gap-3 text-primary">
                    <ShieldCheck className="w-5 h-5" />
                    <span className="text-sm font-medium">Authenticated</span>
                    {isAdmin && (
                      <span className="px-2 py-0.5 text-[10px] bg-amber-500/20 text-amber-400 rounded">ADMIN</span>
                    )}
                  </div>
                  {user && (
                    <div className="pl-8 space-y-1">
                      {user.email && <p className="text-xs text-muted-foreground">{user.email}</p>}
                      {(user.given_name || user.family_name) && (
                        <p className="text-xs text-foreground/70">
                          {[user.given_name, user.family_name].filter(Boolean).join(" ")}
                        </p>
                      )}
                    </div>
                  )}
                </div>

                {/* OAuth Manager (Admin Only) */}
                {isAdmin && (
                  <div className="space-y-4 pt-2 border-t border-border">
                    <div className="flex items-center gap-2 text-amber-400">
                      <Key className="w-4 h-4" />
                      <span className="text-sm font-medium">AI Authentication</span>
                    </div>

                    {/* Token Vault */}
                    <div className="border border-border rounded-lg overflow-hidden">
                      <div className="px-3 py-2 bg-muted/20 border-b border-border flex items-center justify-between">
                        <span className="text-xs text-muted-foreground">Token Vault</span>
                        <span className="text-[10px] text-muted-foreground">{tokens.length} tokens</span>
                      </div>

                      <div className="max-h-40 overflow-y-auto">
                        {tokens.length === 0 ? (
                          <div className="px-3 py-4 text-center text-xs text-muted-foreground">No tokens stored</div>
                        ) : (
                          tokens.map((t) => (
                            <div
                              key={t.name}
                              className={`px-3 py-2 flex items-center gap-2 border-b border-border last:border-b-0 ${
                                t.active ? "bg-primary/5" : ""
                              }`}
                            >
                              {t.active && <span className="w-1.5 h-1.5 rounded-full bg-primary" />}
                              <span className="text-xs font-medium flex-1 truncate">{t.name}</span>
                              <span className="text-[10px] text-muted-foreground font-mono">{t.preview}</span>
                              {t.status === "rate_limited" && (
                                <span className="text-[10px] text-amber-400">limited</span>
                              )}
                              <div className="flex gap-1">
                                {!t.active && (
                                  <button
                                    onClick={() => handleActivateToken(t.name)}
                                    className="p-1 text-muted-foreground hover:text-primary"
                                    title="Use this token"
                                  >
                                    <Check className="w-3 h-3" />
                                  </button>
                                )}
                                <button
                                  onClick={() => handleCheckToken(t.name)}
                                  disabled={checkingToken === t.name}
                                  className="p-1 text-muted-foreground hover:text-foreground"
                                  title="Check token"
                                >
                                  {checkingToken === t.name ? (
                                    <Loader2 className="w-3 h-3 animate-spin" />
                                  ) : (
                                    <RefreshCw className="w-3 h-3" />
                                  )}
                                </button>
                                <button
                                  onClick={() => handleDeleteToken(t.name)}
                                  className="p-1 text-muted-foreground hover:text-destructive"
                                  title="Delete token"
                                >
                                  <Trash2 className="w-3 h-3" />
                                </button>
                              </div>
                            </div>
                          ))
                        )}
                      </div>

                      {/* Add Token */}
                      <div className="px-3 py-2 bg-muted/10 border-t border-border flex gap-2">
                        <input
                          type="text"
                          value={newTokenName}
                          onChange={(e) => setNewTokenName(e.target.value)}
                          placeholder="Name"
                          className="w-20 px-2 py-1 text-xs bg-background border border-border rounded"
                        />
                        <input
                          type="password"
                          value={newTokenValue}
                          onChange={(e) => setNewTokenValue(e.target.value)}
                          placeholder="sk-ant-oat..."
                          className="flex-1 px-2 py-1 text-xs bg-background border border-border rounded font-mono"
                        />
                        <button
                          onClick={handleAddToken}
                          disabled={loading || !newTokenName || !newTokenValue}
                          className="p-1.5 bg-primary text-primary-foreground rounded disabled:opacity-50"
                        >
                          <Plus className="w-3 h-3" />
                        </button>
                      </div>
                    </div>

                    {/* OAuth Login Button */}
                    <button
                      onClick={handleOAuthLogin}
                      className="w-full flex items-center justify-center gap-2 px-4 py-2.5 bg-gradient-to-r from-amber-600/20 to-orange-600/20 border border-amber-500/30 rounded-lg text-sm text-amber-400 hover:border-amber-400 transition-colors"
                    >
                      <Key className="w-4 h-4" />
                      Login with Claude Max
                    </button>
                  </div>
                )}

                {/* Actions */}
                <div className="space-y-3 pt-2 border-t border-border">
                  {onOpenDebug && (
                    <button
                      onClick={handleOpenDebug}
                      className="w-full flex items-center gap-3 px-4 py-3 border border-border rounded-lg text-sm text-foreground hover:bg-muted/20 transition-colors"
                    >
                      <Bug className="w-4 h-4 text-amber-400" />
                      <span>Open Debug Panel</span>
                    </button>
                  )}

                  <button
                    onClick={handleLogout}
                    className="w-full flex items-center gap-3 px-4 py-3 border border-destructive/30 rounded-lg text-sm text-destructive hover:bg-destructive/10 transition-colors"
                  >
                    <LogOut className="w-4 h-4" />
                    <span>Sign Out</span>
                  </button>
                </div>
              </div>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
```

- [ ] **Step 2: Check TypeScript compilation**

```bash
cd C:/dev/raunch/frontend && npx tsc --noEmit 2>&1 | head -20
```

Expected: No errors related to AdminSettings.tsx

- [ ] **Step 3: Commit**

```bash
git add frontend/src/components/AdminSettings.tsx
git commit -m "feat(ui): add OAuth manager to AdminSettings for admin users"
```

---

### Task 7: Update App.tsx to Pass apiUrl to AdminSettings

**Files:**
- Modify: `frontend/src/App.tsx:652`

- [ ] **Step 1: Update AdminSettings props**

Find the AdminSettings component usage around line 652 and add apiUrl:

```tsx
      <AdminSettings
        isOpen={showSettings}
        onClose={() => setShowSettings(false)}
        onOpenDebug={() => setShowDebugPanel(true)}
        apiUrl={apiUrl}
      />
```

- [ ] **Step 2: Verify no TypeScript errors**

```bash
cd C:/dev/raunch/frontend && npx tsc --noEmit 2>&1 | head -20
```

- [ ] **Step 3: Commit**

```bash
git add frontend/src/App.tsx
git commit -m "feat(app): pass apiUrl to AdminSettings for OAuth manager"
```

---

## Chunk 3: Integration and Testing

### Task 8: Manual End-to-End Test

- [ ] **Step 1: Start the backend**

```bash
cd C:/dev/raunch && python -m raunch.server
```

- [ ] **Step 2: Start the frontend (new terminal)**

```bash
cd C:/dev/raunch/frontend && npm run dev
```

- [ ] **Step 3: Test token management**

1. Open http://localhost:5173
2. Log in with joshua.bell.828@gmail.com (Kinde)
3. Click settings gear
4. Verify "AI Authentication" section appears
5. Try adding a token manually
6. Try "Login with Claude Max" button
7. Verify token appears in vault

- [ ] **Step 4: Commit final integration**

```bash
git add -A
git commit -m "feat: complete OAuth manager integration

- Backend: PKCE OAuth flow, token storage, management API
- Frontend: Token Vault UI in AdminSettings (admin only)
- Hot-swap tokens without server restart"
```

---

## Summary

**Files created:**
- `raunch/oauth.py` - PKCE OAuth flow
- `raunch/auth_db.py` - Token storage functions

**Files modified:**
- `raunch/db.py` - OAuth tables
- `raunch/api.py` - OAuth routes + token API
- `raunch/llm.py` - reload_client()
- `frontend/src/components/AdminSettings.tsx` - OAuth Manager UI
- `frontend/src/App.tsx` - Pass apiUrl prop

**Admin access:** Hardcoded to joshua.bell.828@gmail.com
