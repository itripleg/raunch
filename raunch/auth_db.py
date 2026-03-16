"""OAuth token storage functions."""

import json
from typing import Dict, Any, List, Optional
from .db import _get_conn


def list_tokens() -> List[Dict[str, Any]]:
    """List all stored OAuth tokens."""
    conn = _get_conn()
    rows = conn.execute(
        "SELECT name, token, status, reset_time, checked_at, created_at FROM oauth_tokens ORDER BY name"
    ).fetchall()
    return [dict(r) for r in rows]


def get_token(name: str) -> Optional[Dict[str, Any]]:
    """Get a token by name."""
    conn = _get_conn()
    row = conn.execute(
        "SELECT name, token, status, reset_time, checked_at, created_at FROM oauth_tokens WHERE name = ?",
        (name,)
    ).fetchone()
    return dict(row) if row else None


def save_token(name: str, token: str) -> Dict[str, Any]:
    """Save or update a named token."""
    conn = _get_conn()
    conn.execute(
        """INSERT INTO oauth_tokens (name, token, status, created_at)
           VALUES (?, ?, 'unknown', CURRENT_TIMESTAMP)
           ON CONFLICT(name) DO UPDATE SET token = excluded.token, status = 'unknown'""",
        (name, token)
    )
    conn.commit()
    return get_token(name)


def delete_token(name: str) -> bool:
    """Delete a token by name."""
    conn = _get_conn()
    cursor = conn.execute("DELETE FROM oauth_tokens WHERE name = ?", (name,))
    conn.commit()
    return cursor.rowcount > 0


def update_token_status(name: str, status: str, reset_time: Optional[str] = None) -> bool:
    """Update a token's status."""
    conn = _get_conn()
    cursor = conn.execute(
        """UPDATE oauth_tokens SET status = ?, reset_time = ?, checked_at = CURRENT_TIMESTAMP
           WHERE name = ?""",
        (status, reset_time, name)
    )
    conn.commit()
    return cursor.rowcount > 0


def get_active_token_name() -> Optional[str]:
    """Get the name of the currently active token."""
    conn = _get_conn()
    row = conn.execute(
        "SELECT value FROM oauth_config WHERE key = 'active_token_name'"
    ).fetchone()
    return row["value"] if row else None


def set_active_token_name(name: Optional[str]) -> None:
    """Set the active token name."""
    conn = _get_conn()
    if name is None:
        conn.execute("DELETE FROM oauth_config WHERE key = 'active_token_name'")
    else:
        conn.execute(
            """INSERT INTO oauth_config (key, value) VALUES ('active_token_name', ?)
               ON CONFLICT(key) DO UPDATE SET value = excluded.value""",
            (name,)
        )
    conn.commit()


def get_active_token() -> Optional[str]:
    """Get the actual token value of the active token."""
    name = get_active_token_name()
    if not name:
        return None
    token_data = get_token(name)
    return token_data["token"] if token_data else None
