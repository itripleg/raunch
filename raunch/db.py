"""Database access — delegates to SQLite or Firestore based on DB_BACKEND."""

from .config import DB_BACKEND

# Pure data helpers (not backend-specific) — always available
from .db_sqlite import _extract_character_fields  # noqa: F401

if DB_BACKEND == "firestore":
    from .db_firestore import *  # noqa: F401,F403
else:
    from .db_sqlite import *  # noqa: F401,F403
