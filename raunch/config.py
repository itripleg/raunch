"""Global configuration and constants."""

import os

# Paths
PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SAVES_DIR = os.path.join(PROJECT_ROOT, "saves")
CHARACTERS_DIR = os.path.join(PROJECT_ROOT, "characters")
SCENARIOS_DIR = os.path.join(PROJECT_ROOT, "scenarios")

# LLM
DEFAULT_MODEL = "claude-sonnet-4-20250514"
DEFAULT_MAX_TOKENS = 2048
DEFAULT_TEMPERATURE = 0.9

# World page
BASE_PAGE_SECONDS = 0  # 0 = manual mode (default), >0 = auto-page interval
NARRATOR_PAGE_MULTIPLIER = 1  # Narrator runs every page
CHARACTER_PAGE_MULTIPLIER = 1  # Characters react every page

# Database backend: "sqlite" (default) or "firestore"
DB_BACKEND = os.environ.get("DB_BACKEND", "sqlite")
FIREBASE_PROJECT_ID = "gameplace-761d0"

# Firebase credentials: either a file path (local dev) or JSON string (Render env var)
_firebase_creds_json = os.environ.get("GOOGLE_APPLICATION_CREDENTIALS_JSON")
if _firebase_creds_json:
    # Render: write JSON env var to a temp file so firebase-admin can read it
    import tempfile, json as _json
    _tmp = tempfile.NamedTemporaryFile(mode="w", suffix=".json", delete=False)
    _tmp.write(_firebase_creds_json)
    _tmp.close()
    GOOGLE_APPLICATION_CREDENTIALS = _tmp.name
else:
    GOOGLE_APPLICATION_CREDENTIALS = os.environ.get(
        "GOOGLE_APPLICATION_CREDENTIALS",
        os.path.join(PROJECT_ROOT, "gameplace-761d0-firebase-adminsdk-x5e8h-727cd57e2f.json")
    )

# Server
SERVER_HOST = "0.0.0.0"  # Bind inside container
SERVER_PORT = 7666
CLIENT_HOST = "127.0.0.1"  # Clients connect to localhost (port-mapped)

# Ensure dirs exist
os.makedirs(SAVES_DIR, exist_ok=True)
os.makedirs(CHARACTERS_DIR, exist_ok=True)
os.makedirs(SCENARIOS_DIR, exist_ok=True)
