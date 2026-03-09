"""Anthropic API client with OAuth support for Claude Max subscriptions."""

import os
import json
import logging
from typing import Optional, List, Dict, Any

import anthropic

from .config import DEFAULT_MODEL, DEFAULT_MAX_TOKENS, DEFAULT_TEMPERATURE

logger = logging.getLogger(__name__)


def _get_oauth_token() -> Optional[str]:
    """Read OAuth token from Claude CLI credentials (re-reads each call)."""
    # 1. Check env var
    token = os.environ.get("CLAUDE_CODE_OAUTH_TOKEN")
    if token and token.startswith("sk-ant-oat"):
        return token

    # 2. Read from ~/.claude/.credentials.json (fresh read every time)
    try:
        creds_path = os.path.expanduser("~/.claude/.credentials.json")
        if os.path.exists(creds_path):
            with open(creds_path, "r") as f:
                data = json.load(f)
            token = data.get("claudeAiOauth", {}).get("accessToken")
            if token and token.startswith("sk-ant-oat"):
                return token
    except Exception as e:
        logger.debug(f"Could not read OAuth token: {e}")

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
        self._refresh_client()

    def _refresh_client(self) -> None:
        """(Re)create the Anthropic client with the latest token."""
        token = _get_oauth_token()
        if token and token != self._current_token:
            self._current_token = token
            self._client = anthropic.Anthropic(api_key=token)
            self.auth_method = "oauth"
            logger.info("Loaded OAuth token from credentials")
        elif token:
            pass  # Same token, client still good
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

    def chat(
        self,
        system: str,
        messages: List[Dict[str, Any]],
        model: Optional[str] = None,
        max_tokens: Optional[int] = None,
        temperature: Optional[float] = None,
    ) -> str:
        """Send a chat completion and return the text response. Retries once on auth failure."""
        try:
            return self._do_chat(system, messages, model, max_tokens, temperature)
        except anthropic.AuthenticationError:
            # Token may have rotated — re-read credentials and retry once
            logger.warning("Auth failed, refreshing token and retrying...")
            self._current_token = None
            self._refresh_client()
            return self._do_chat(system, messages, model, max_tokens, temperature)

    def _do_chat(self, system, messages, model, max_tokens, temperature) -> str:
        response = self._client.messages.create(
            model=model or self.model,
            max_tokens=max_tokens or self.max_tokens,
            temperature=temperature if temperature is not None else self.temperature,
            system=system,
            messages=messages,
        )
        return response.content[0].text


# Singleton
_instance: Optional[LLMClient] = None


def get_client() -> LLMClient:
    """Get or create the global LLM client."""
    global _instance
    if _instance is None:
        _instance = LLMClient()
    return _instance


