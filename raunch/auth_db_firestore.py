"""OAuth token storage functions — Firestore implementation."""

from datetime import datetime, timezone
from typing import Dict, Any, List, Optional

from firebase_admin import firestore

_fs = firestore.client()

_TOKENS_COLLECTION = "oauth_tokens"
_CONFIG_COLLECTION = "oauth_config"


def list_tokens() -> List[Dict[str, Any]]:
    """List all stored OAuth tokens."""
    docs = _fs.collection(_TOKENS_COLLECTION).order_by("name").stream()
    return [doc.to_dict() for doc in docs]


def get_token(name: str) -> Optional[Dict[str, Any]]:
    """Get a token by name."""
    doc = _fs.collection(_TOKENS_COLLECTION).document(name).get()
    return doc.to_dict() if doc.exists else None


def save_token(name: str, token: str) -> Dict[str, Any]:
    """Save or update a named token."""
    doc_ref = _fs.collection(_TOKENS_COLLECTION).document(name)
    doc = doc_ref.get()
    now = datetime.now(timezone.utc).isoformat()

    if doc.exists:
        doc_ref.update({"token": token, "status": "unknown"})
    else:
        doc_ref.set({
            "name": name,
            "token": token,
            "status": "unknown",
            "reset_time": None,
            "checked_at": None,
            "created_at": now,
        })

    return get_token(name)


def delete_token(name: str) -> bool:
    """Delete a token by name."""
    doc_ref = _fs.collection(_TOKENS_COLLECTION).document(name)
    doc = doc_ref.get()
    if doc.exists:
        doc_ref.delete()
        return True
    return False


def update_token_status(name: str, status: str, reset_time: Optional[str] = None) -> bool:
    """Update a token's status."""
    doc_ref = _fs.collection(_TOKENS_COLLECTION).document(name)
    doc = doc_ref.get()
    if not doc.exists:
        return False
    now = datetime.now(timezone.utc).isoformat()
    doc_ref.update({
        "status": status,
        "reset_time": reset_time,
        "checked_at": now,
    })
    return True


def get_active_token_name() -> Optional[str]:
    """Get the name of the currently active token."""
    doc = _fs.collection(_CONFIG_COLLECTION).document("active_token_name").get()
    if doc.exists:
        data = doc.to_dict()
        return data.get("value")
    return None


def set_active_token_name(name: Optional[str]) -> None:
    """Set the active token name."""
    doc_ref = _fs.collection(_CONFIG_COLLECTION).document("active_token_name")
    if name is None:
        doc_ref.delete()
    else:
        doc_ref.set({"key": "active_token_name", "value": name})


def get_active_token() -> Optional[str]:
    """Get the actual token value of the active token."""
    name = get_active_token_name()
    if not name:
        return None
    token_data = get_token(name)
    return token_data["token"] if token_data else None
