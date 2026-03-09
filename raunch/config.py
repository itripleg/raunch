"""Global configuration and constants."""

import os

# Paths
PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SAVES_DIR = os.path.join(PROJECT_ROOT, "saves")
CHARACTERS_DIR = os.path.join(PROJECT_ROOT, "characters")

# LLM
DEFAULT_MODEL = "claude-sonnet-4-20250514"
DEFAULT_MAX_TOKENS = 2048
DEFAULT_TEMPERATURE = 0.9

# World tick
BASE_TICK_SECONDS = 8  # How often the world advances
NARRATOR_TICK_MULTIPLIER = 1  # Narrator runs every tick
CHARACTER_TICK_MULTIPLIER = 1  # Characters react every tick

# Server
SERVER_HOST = "0.0.0.0"  # Bind inside container
SERVER_PORT = 7666
CLIENT_HOST = "127.0.0.1"  # Clients connect to localhost (port-mapped)

# Ensure dirs exist
os.makedirs(SAVES_DIR, exist_ok=True)
os.makedirs(CHARACTERS_DIR, exist_ok=True)
