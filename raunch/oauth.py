"""Claude OAuth PKCE flow implementation.

Uses the platform.claude.com out-of-band callback so the user copies
the authorization code back into the app.  This avoids needing our own
redirect_uri to be registered with Anthropic.
"""

import secrets
import hashlib
import base64
import logging
import time
from typing import Dict

import httpx
from fastapi import APIRouter
from pydantic import BaseModel

from .auth_db import save_token, set_active_token_name

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/oauth", tags=["oauth"])

# Claude OAuth configuration
CLAUDE_CLIENT_ID = "9d1c250a-e61b-44d9-88ed-5944d1962f5e"
CLAUDE_AUTHORIZE_URL = "https://claude.ai/oauth/authorize"
CLAUDE_TOKEN_URL = "https://console.anthropic.com/api/oauth/token"
CLAUDE_REDIRECT_URI = "https://console.anthropic.com/oauth/code/callback"

# In-memory PKCE storage (per-process, short-lived)
_pkce_storage: Dict[str, Dict[str, str]] = {}


def _generate_pkce_pair() -> tuple[str, str]:
    """Generate PKCE code_verifier and code_challenge."""
    code_verifier = secrets.token_urlsafe(32)
    digest = hashlib.sha256(code_verifier.encode()).digest()
    code_challenge = base64.urlsafe_b64encode(digest).rstrip(b"=").decode()
    return code_verifier, code_challenge


@router.get("/start")
async def start_oauth():
    """Return the Claude authorize URL for the frontend to open.

    The redirect_uri points to platform.claude.com which will display
    the authorization code for the user to copy.
    """
    code_verifier, code_challenge = _generate_pkce_pair()
    state = secrets.token_urlsafe(16)

    _pkce_storage[state] = {"code_verifier": code_verifier}

    from urllib.parse import urlencode
    auth_params = {
        "client_id": CLAUDE_CLIENT_ID,
        "response_type": "code",
        "redirect_uri": CLAUDE_REDIRECT_URI,
        "code_challenge": code_challenge,
        "code_challenge_method": "S256",
        "state": state,
        "scope": "user:inference user:profile",
    }

    auth_url = f"{CLAUDE_AUTHORIZE_URL}?{urlencode(auth_params)}"
    logger.info(f"Starting OAuth flow, state={state}")

    return {"auth_url": auth_url, "state": state}


class ExchangeRequest(BaseModel):
    code: str
    state: str


@router.post("/exchange")
async def exchange_code(req: ExchangeRequest):
    """Exchange an authorization code (pasted by user) for an access token."""
    pkce_data = _pkce_storage.pop(req.state, None)
    if not pkce_data:
        return {"success": False, "message": "Invalid or expired state. Try starting the flow again."}

    code_verifier = pkce_data["code_verifier"]

    try:
        async with httpx.AsyncClient() as client:
            response = await client.post(
                CLAUDE_TOKEN_URL,
                data={
                    "grant_type": "authorization_code",
                    "client_id": CLAUDE_CLIENT_ID,
                    "code": req.code.strip(),
                    "redirect_uri": CLAUDE_REDIRECT_URI,
                    "code_verifier": code_verifier,
                },
                headers={"Content-Type": "application/x-www-form-urlencoded"},
                timeout=30,
            )

        if response.status_code != 200:
            logger.error(f"Token exchange failed: {response.status_code} - {response.text}")
            return {"success": False, "message": f"Token exchange failed ({response.status_code}): {response.text[:200]}"}

        token_data = response.json()
        access_token = token_data.get("access_token")

        if not access_token:
            return {"success": False, "message": "No access token in response"}

        # Save token
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
        return {"success": True, "message": f"Token saved as '{token_name}'", "token_name": token_name}

    except httpx.TimeoutException:
        return {"success": False, "message": "Token exchange timed out"}
    except Exception as e:
        logger.error(f"Token exchange error: {e}")
        return {"success": False, "message": str(e)}
