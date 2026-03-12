"""Anthropic API client with OAuth support for Claude Max subscriptions."""

import os
import json
import logging
import time
from typing import Optional, List, Dict, Any, Generator

import anthropic
import httpx

from .config import DEFAULT_MODEL, DEFAULT_MAX_TOKENS, DEFAULT_TEMPERATURE

logger = logging.getLogger(__name__)

CREDENTIALS_PATH = os.path.expanduser("~/.claude/.credentials.json")

# Claude Code's OAuth client ID (from the CLI source)
CLAUDE_CODE_CLIENT_ID = "9d1c250a-e61b-44d9-88ed-5944d1962f5e"
CLAUDE_TOKEN_URL = "https://console.anthropic.com/v1/oauth/token"


def _read_credentials() -> Dict[str, Any]:
    """Read the full OAuth credentials block."""
    try:
        if os.path.exists(CREDENTIALS_PATH):
            with open(CREDENTIALS_PATH, "r") as f:
                data = json.load(f)
            return data.get("claudeAiOauth", {})
    except Exception as e:
        logger.debug(f"Could not read credentials: {e}")
    return {}


def _refresh_oauth_token(refresh_token: str) -> Optional[str]:
    """Use the refresh token to get a new access token, and update the credentials file."""
    try:
        resp = httpx.post(
            CLAUDE_TOKEN_URL,
            data={
                "grant_type": "refresh_token",
                "refresh_token": refresh_token,
                "client_id": CLAUDE_CODE_CLIENT_ID,
            },
            timeout=15,
        )
        if resp.status_code == 200:
            token_data = resp.json()
            new_access = token_data.get("access_token")
            new_refresh = token_data.get("refresh_token", refresh_token)
            expires_in = token_data.get("expires_in", 3600)

            if new_access:
                # Update credentials file
                try:
                    with open(CREDENTIALS_PATH, "r") as f:
                        creds = json.load(f)
                    creds["claudeAiOauth"]["accessToken"] = new_access
                    creds["claudeAiOauth"]["refreshToken"] = new_refresh
                    creds["claudeAiOauth"]["expiresAt"] = int((time.time() + expires_in) * 1000)
                    with open(CREDENTIALS_PATH, "w") as f:
                        json.dump(creds, f, indent=2)
                    logger.info("Refreshed OAuth token and updated credentials file")
                except Exception as e:
                    logger.warning(f"Token refreshed but couldn't update file: {e}")
                return new_access
        else:
            logger.warning(f"Token refresh failed ({resp.status_code}): {resp.text[:200]}")
    except Exception as e:
        logger.warning(f"Token refresh error: {e}")
    return None


def _get_oauth_token() -> Optional[str]:
    """Read OAuth token from Claude CLI credentials."""
    # 1. Check env var
    token = os.environ.get("CLAUDE_CODE_OAUTH_TOKEN")
    if token and token.startswith("sk-ant-oat"):
        return token

    # 2. Read from credentials file
    creds = _read_credentials()
    token = creds.get("accessToken")
    if token and token.startswith("sk-ant-oat"):
        return token

    return None


class LLMClient:
    """Thin wrapper around the Anthropic SDK with OAuth auto-detection."""

    def __init__(self):
        self.model = os.environ.get("LLM_MODEL", DEFAULT_MODEL)
        self.max_tokens = int(os.environ.get("LLM_MAX_TOKENS", DEFAULT_MAX_TOKENS))
        self.temperature = float(os.environ.get("LLM_TEMPERATURE", DEFAULT_TEMPERATURE))
        self.api_key = os.environ.get("ANTHROPIC_API_KEY")
        self._current_token: Optional[str] = None
        self._client: Optional[anthropic.Anthropic] = None
        self._init_client()

    def _init_client(self) -> None:
        """Create the Anthropic client with the best available auth."""
        token = _get_oauth_token()
        if token:
            self._current_token = token
            self._client = anthropic.Anthropic(api_key=token)
            self.auth_method = "oauth"
            logger.info("Using OAuth token")
        elif self.api_key:
            self._client = anthropic.Anthropic(api_key=self.api_key)
            self.auth_method = "api_key"
        else:
            raise RuntimeError(
                "No authentication found.\n"
                "  Option 1: Log in with `claude` CLI (OAuth auto-detected from ~/.claude/.credentials.json)\n"
                "  Option 2: Set ANTHROPIC_API_KEY environment variable\n"
                "  Option 3: Set CLAUDE_CODE_OAUTH_TOKEN environment variable"
            )

    def _try_refresh(self) -> bool:
        """Attempt to refresh the OAuth token. Returns True if successful."""
        creds = _read_credentials()
        refresh_token = creds.get("refreshToken")
        if not refresh_token:
            return False

        new_token = _refresh_oauth_token(refresh_token)
        if new_token:
            self._current_token = new_token
            self._client = anthropic.Anthropic(api_key=new_token)
            return True

        # Refresh failed — try re-reading the file (maybe claude CLI refreshed it)
        token = _get_oauth_token()
        if token and token != self._current_token:
            self._current_token = token
            self._client = anthropic.Anthropic(api_key=token)
            return True

        return False

    def chat(
        self,
        system: str,
        messages: List[Dict[str, Any]],
        model: Optional[str] = None,
        max_tokens: Optional[int] = None,
        temperature: Optional[float] = None,
    ) -> str:
        """Send a chat completion. Retries with token refresh on auth failure."""
        try:
            return self._do_chat(system, messages, model, max_tokens, temperature)
        except anthropic.AuthenticationError:
            logger.warning("Auth failed, attempting token refresh...")
            if self._try_refresh():
                logger.info("Token refreshed, retrying...")
                return self._do_chat(system, messages, model, max_tokens, temperature)
            # Last resort: wait a moment and re-read (token rotation window)
            logger.warning("Refresh failed, waiting 3s and retrying with re-read...")
            time.sleep(3)
            token = _get_oauth_token()
            if token and token != self._current_token:
                self._current_token = token
                self._client = anthropic.Anthropic(api_key=token)
                return self._do_chat(system, messages, model, max_tokens, temperature)
            raise

    def _do_chat(self, system, messages, model, max_tokens, temperature) -> str:
        response = self._client.messages.create(
            model=model or self.model,
            max_tokens=max_tokens or self.max_tokens,
            temperature=temperature if temperature is not None else self.temperature,
            system=system,
            messages=messages,
        )
        return response.content[0].text

    def chat_stream(
        self,
        system: str,
        messages: List[Dict[str, Any]],
        model: Optional[str] = None,
        max_tokens: Optional[int] = None,
        temperature: Optional[float] = None,
    ) -> Generator[str, None, None]:
        """Stream chat completion, yielding text deltas."""
        yielded_any = False
        try:
            for chunk in self._do_chat_stream(system, messages, model, max_tokens, temperature):
                yielded_any = True
                yield chunk
        except anthropic.AuthenticationError:
            if yielded_any:
                # Already yielded content, can't retry without duplicates
                logger.error("Auth failed mid-stream after yielding content, cannot retry")
                raise
            logger.warning("Auth failed during stream, attempting token refresh...")
            if self._try_refresh():
                logger.info("Token refreshed, retrying stream...")
                yield from self._do_chat_stream(system, messages, model, max_tokens, temperature)
            else:
                raise
        except anthropic.BadRequestError as e:
            if yielded_any:
                # Already yielded content, can't fall back cleanly
                logger.error(f"BadRequest mid-stream after yielding content: {e}")
                raise
            # Streaming may not be supported - fall back to non-streaming
            logger.warning(f"Streaming not supported, falling back: {e}")
            result = self.chat(system, messages, model, max_tokens, temperature)
            yield result

    def _do_chat_stream(self, system, messages, model, max_tokens, temperature) -> Generator[str, None, None]:
        """Internal streaming implementation."""
        with self._client.messages.stream(
            model=model or self.model,
            max_tokens=max_tokens or self.max_tokens,
            temperature=temperature if temperature is not None else self.temperature,
            system=system,
            messages=messages,
        ) as stream:
            for text in stream.text_stream:
                yield text


# Singleton
_instance: Optional[LLMClient] = None


def get_client() -> LLMClient:
    """Get or create the global LLM client."""
    global _instance
    if _instance is None:
        _instance = LLMClient()
    return _instance
