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
