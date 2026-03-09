"""Narrator agent — drives world progression each tick."""

from .base import Agent
from ..prompts import NARRATOR_SYSTEM_PROMPT


class Narrator(Agent):
    """The world narrator. Advances time, sets scenes, generates events."""

    def __init__(self):
        super().__init__(name="Narrator", system_prompt=NARRATOR_SYSTEM_PROMPT)
