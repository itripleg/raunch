"""Base agent with conversation history and LLM integration."""

import json
import logging
import re
from typing import List, Dict, Any, Optional, Generator, Tuple

from ..client import get_client

logger = logging.getLogger(__name__)

# Max messages kept in sliding window before summarization
MAX_HISTORY = 20


class Agent:
    """Base class for all agents (narrator, characters, etc.)."""

    def __init__(self, name: str, system_prompt: str):
        self.name = name
        self.system_prompt = system_prompt
        self.history: List[Dict[str, Any]] = []
        self.summary: str = ""  # Rolling summary of older history

    def _build_messages(self, user_message: str) -> List[Dict[str, Any]]:
        """Build message list with optional summary prefix."""
        messages = []
        if self.summary:
            messages.append({
                "role": "user",
                "content": f"[CONTEXT SUMMARY]\n{self.summary}",
            })
            messages.append({
                "role": "assistant",
                "content": "Understood, I have the context.",
            })
        messages.extend(self.history)
        messages.append({"role": "user", "content": user_message})
        return messages

    def _trim_history(self) -> None:
        """Summarize old history when it gets too long."""
        if len(self.history) <= MAX_HISTORY:
            return

        # Take the oldest half and ask the LLM to summarize
        cut = len(self.history) // 2
        old_messages = self.history[:cut]
        self.history = self.history[cut:]

        old_text = "\n".join(
            f"{m['role']}: {m['content']}" for m in old_messages
        )
        try:
            client = get_client()
            new_summary = client.chat(
                system="Summarize this conversation history concisely, preserving key events, character states, and relationships.",
                messages=[{"role": "user", "content": f"Previous summary:\n{self.summary}\n\nNew messages to incorporate:\n{old_text}"}],
                max_tokens=512,
                temperature=0.3,
            )
            self.summary = new_summary
            logger.info(f"[{self.name}] Summarized {cut} old messages")
        except Exception as e:
            logger.warning(f"[{self.name}] Summary failed, keeping raw: {e}")
            self.summary += f"\n{old_text}"

    def tick(self, world_context: str) -> Dict[str, Any]:
        """
        Run one tick: send world context to the agent, get response.
        Returns parsed JSON response or raw text fallback.
        """
        messages = self._build_messages(world_context)
        client = get_client()
        raw = client.chat(system=self.system_prompt, messages=messages)

        # Store in history
        self.history.append({"role": "user", "content": world_context})
        self.history.append({"role": "assistant", "content": raw})
        self._trim_history()

        # Try to parse JSON
        try:
            text = raw.strip()
            # Direct parse
            try:
                return json.loads(text)
            except json.JSONDecodeError:
                pass
            # Strip markdown fences
            fence_match = re.search(r"```(?:json)?\s*\n(.*?)```", text, re.DOTALL)
            if fence_match:
                return json.loads(fence_match.group(1).strip())
            # Extract { ... } block
            first = text.find("{")
            last = text.rfind("}")
            if first != -1 and last > first:
                return json.loads(text[first:last + 1])
            raise json.JSONDecodeError("no json", text, 0)
        except (json.JSONDecodeError, IndexError):
            logger.debug(f"[{self.name}] Response was not valid JSON, returning raw")
            return {"raw": raw}

    def tick_stream(
        self,
        world_context: str,
        on_delta: Optional[callable] = None
    ) -> Dict[str, Any]:
        """
        Run one tick with streaming. Calls on_delta(chunk) for each text chunk.
        Returns the parsed JSON response when complete.
        """
        messages = self._build_messages(world_context)
        client = get_client()

        full_response = ""
        try:
            for chunk in client.chat_stream(system=self.system_prompt, messages=messages):
                full_response += chunk
                if on_delta:
                    on_delta(chunk)
        except Exception as e:
            logger.error(f"[{self.name}] Streaming error: {e}")
            # Fall back to non-streaming
            if not full_response:
                full_response = client.chat(system=self.system_prompt, messages=messages)

        # Store in history
        self.history.append({"role": "user", "content": world_context})
        self.history.append({"role": "assistant", "content": full_response})
        self._trim_history()

        # Parse and return final result
        try:
            text = full_response.strip()
            try:
                return json.loads(text)
            except json.JSONDecodeError:
                pass
            fence_match = re.search(r"```(?:json)?\s*\n(.*?)```", text, re.DOTALL)
            if fence_match:
                return json.loads(fence_match.group(1).strip())
            first = text.find("{")
            last = text.rfind("}")
            if first != -1 and last > first:
                return json.loads(text[first:last + 1])
        except (json.JSONDecodeError, IndexError):
            pass
        return {"raw": full_response}

    def get_state(self) -> Dict[str, Any]:
        """Serialize agent state for saving."""
        return {
            "name": self.name,
            "history": self.history,
            "summary": self.summary,
        }

    def load_state(self, state: Dict[str, Any]) -> None:
        """Restore agent state from save data."""
        self.history = state.get("history", [])
        self.summary = state.get("summary", "")
