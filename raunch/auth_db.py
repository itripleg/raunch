"""Auth token storage — delegates to SQLite or Firestore based on DB_BACKEND."""

from .config import DB_BACKEND

if DB_BACKEND == "firestore":
    from .auth_db_firestore import *  # noqa: F401,F403
else:
    from .auth_db_sqlite import *  # noqa: F401,F403
