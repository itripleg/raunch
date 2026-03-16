"""Anthropic API client with OAuth support for Claude Max subscriptions.

Supports two authentication methods:
1. OAuth Token - Uses Claude Max subscription via claude-agent-sdk (like Motherhaven)
2. API Key - Uses Anthropic API directly with pay-per-token billing

Usage:
    from raunch.llm import get_client

    client = get_client()
    result = client.chat(system="...", messages=[...])
"""

import os
import json
import logging
import asyncio
import time
from typing import Optional, List, Dict, Any, Generator

import anthropic

from .config import DEFAULT_MODEL, DEFAULT_MAX_TOKENS, DEFAULT_TEMPERATURE

logger = logging.getLogger(__name__)

CREDENTIALS_PATH = os.path.expanduser("~/.claude/.credentials.json")

# Check for claude-agent-sdk availability
try:
    from claude_agent_sdk import ClaudeAgentOptions, ClaudeSDKClient
    CLAUDE_SDK_AVAILABLE = True
except ImportError:
    CLAUDE_SDK_AVAILABLE = False
    ClaudeAgentOptions = None
    ClaudeSDKClient = None


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
    """Thin wrapper around Claude with OAuth auto-detection via claude-agent-sdk."""

    def __init__(self):
        self.model = os.environ.get("LLM_MODEL", DEFAULT_MODEL)
        self.max_tokens = int(os.environ.get("LLM_MAX_TOKENS", DEFAULT_MAX_TOKENS))
        self.temperature = float(os.environ.get("LLM_TEMPERATURE", DEFAULT_TEMPERATURE))
        self.api_key = os.environ.get("ANTHROPIC_API_KEY")
        self._current_token: Optional[str] = None
        self._client: Optional[anthropic.Anthropic] = None
        self._init_client()

    def _init_client(self) -> None:
        """Create the client with the best available auth."""
        token = _get_oauth_token()

        if token and CLAUDE_SDK_AVAILABLE:
            # Use claude-agent-sdk for OAuth (like Motherhaven)
            self._current_token = token
            os.environ["CLAUDE_CODE_OAUTH_TOKEN"] = token
            # Allow SDK to spawn Claude Code even if we're inside one
            os.environ.pop("CLAUDECODE", None)
            self.auth_method = "oauth_sdk"
            logger.debug(f"[AUTH] Using OAuth via claude-agent-sdk: {token[:25]}...")
        elif token:
            # OAuth token but no SDK - use direct (legacy, may conflict)
            self._current_token = token
            self._client = anthropic.Anthropic(api_key=token)
            self.auth_method = "oauth_direct"
            logger.warning(f"[AUTH] Using OAuth direct (no SDK, may conflict): {token[:25]}...")
        elif self.api_key:
            self._client = anthropic.Anthropic(api_key=self.api_key)
            self.auth_method = "api_key"
            logger.debug(f"[AUTH] Using API key: {self.api_key[:15]}...")
        else:
            raise RuntimeError(
                "No authentication found.\n"
                "  Option 1: Log in with `claude` CLI (OAuth auto-detected)\n"
                "  Option 2: Set ANTHROPIC_API_KEY environment variable\n"
                "  Option 3: Set CLAUDE_CODE_OAUTH_TOKEN environment variable"
            )

    @property
    def supports_streaming(self) -> bool:
        """Return True if the current auth method supports real streaming."""
        # Only API key supports true streaming - OAuth returns full responses
        return self.auth_method == "api_key"

    def _run_async(self, coro):
        """Run an async coroutine synchronously."""
        try:
            loop = asyncio.get_event_loop()
            if loop.is_running():
                import concurrent.futures
                with concurrent.futures.ThreadPoolExecutor() as executor:
                    return executor.submit(asyncio.run, coro).result()
            return loop.run_until_complete(coro)
        except RuntimeError:
            return asyncio.run(coro)

    async def _oauth_sdk_chat(
        self,
        system: str,
        messages: List[Dict[str, Any]],
        max_tokens: Optional[int] = None,
    ) -> str:
        """Chat using OAuth authentication via claude-agent-sdk."""
        if not CLAUDE_SDK_AVAILABLE:
            raise RuntimeError("claude-agent-sdk not available for OAuth auth")

        # Unset CLAUDECODE to allow nested SDK usage
        os.environ.pop("CLAUDECODE", None)

        # Build prompt from messages
        prompt_parts = []
        for m in messages:
            role = m.get('role', 'user')
            content = m.get('content', '')
            if role == 'user':
                prompt_parts.append(content)
            elif role == 'assistant':
                prompt_parts.append(f"[Previous assistant response: {content}]")

        full_prompt = "\n\n".join(prompt_parts)

        # Ensure token is set
        if self._current_token:
            os.environ['CLAUDE_CODE_OAUTH_TOKEN'] = self._current_token

        client = ClaudeSDKClient(options=ClaudeAgentOptions(
            model=self.model,
            system_prompt=system,
            allowed_tools=[],
            max_turns=1
        ))

        response_text = ""
        async with client:
            await client.query(full_prompt)
            async for msg in client.receive_response():
                if hasattr(msg, 'content'):
                    for c in msg.content:
                        if hasattr(c, 'text'):
                            response_text = c.text

        return response_text

    async def _oauth_sdk_chat_stream(
        self,
        system: str,
        messages: List[Dict[str, Any]],
        max_tokens: Optional[int] = None,
    ) -> Generator[str, None, None]:
        """Stream chat using OAuth authentication via claude-agent-sdk."""
        if not CLAUDE_SDK_AVAILABLE:
            raise RuntimeError("claude-agent-sdk not available for OAuth auth")

        # Build prompt from messages
        prompt_parts = []
        for m in messages:
            role = m.get('role', 'user')
            content = m.get('content', '')
            if role == 'user':
                prompt_parts.append(content)
            elif role == 'assistant':
                prompt_parts.append(f"[Previous assistant response: {content}]")

        full_prompt = "\n\n".join(prompt_parts)

        # Ensure token is set
        if self._current_token:
            os.environ['CLAUDE_CODE_OAUTH_TOKEN'] = self._current_token

        client = ClaudeSDKClient(options=ClaudeAgentOptions(
            model=self.model,
            system_prompt=system,
            allowed_tools=[],
            max_turns=1
        ))

        async with client:
            await client.query(full_prompt)
            async for msg in client.receive_response():
                if hasattr(msg, 'content'):
                    for c in msg.content:
                        if hasattr(c, 'text'):
                            yield c.text

    def chat(
        self,
        system: str,
        messages: List[Dict[str, Any]],
        model: Optional[str] = None,
        max_tokens: Optional[int] = None,
        temperature: Optional[float] = None,
    ) -> str:
        """Send a chat completion."""
        if self.auth_method == "oauth_sdk":
            return self._run_async(self._oauth_sdk_chat(system, messages, max_tokens))

        # Direct API call for api_key or oauth_direct
        try:
            response = self._client.messages.create(
                model=model or self.model,
                max_tokens=max_tokens or self.max_tokens,
                temperature=temperature if temperature is not None else self.temperature,
                system=system,
                messages=messages,
            )
            return response.content[0].text
        except anthropic.AuthenticationError as e:
            logger.error(f"Auth failed (401): {e}")
            raise
        except anthropic.APIError as e:
            logger.error(f"API error: {type(e).__name__}: {e}")
            raise

    def chat_stream(
        self,
        system: str,
        messages: List[Dict[str, Any]],
        model: Optional[str] = None,
        max_tokens: Optional[int] = None,
        temperature: Optional[float] = None,
    ) -> Generator[str, None, None]:
        """Stream chat completion, yielding text deltas."""
        if self.auth_method == "oauth_sdk":
            # Run the async generator synchronously
            async def collect_stream():
                chunks = []
                async for chunk in self._oauth_sdk_chat_stream(system, messages, max_tokens):
                    chunks.append(chunk)
                return chunks

            chunks = self._run_async(collect_stream())
            for chunk in chunks:
                yield chunk
            return

        # Direct streaming for api_key or oauth_direct
        try:
            with self._client.messages.stream(
                model=model or self.model,
                max_tokens=max_tokens or self.max_tokens,
                temperature=temperature if temperature is not None else self.temperature,
                system=system,
                messages=messages,
            ) as stream:
                for text in stream.text_stream:
                    yield text
        except anthropic.AuthenticationError as e:
            logger.error(f"Auth failed (401): {e}")
            raise
        except anthropic.APIError as e:
            logger.error(f"API error: {type(e).__name__}: {e}")
            raise


# Singleton
_instance: Optional[LLMClient] = None


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


def get_client() -> LLMClient:
    """Get or create the global LLM client."""
    global _instance
    if _instance is None:
        _instance = LLMClient()
    return _instance
