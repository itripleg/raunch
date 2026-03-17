"""OAuth token management and admin endpoints."""

import logging
import os
from typing import List, Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from raunch.auth_db import (
    list_tokens as db_list_tokens,
    get_token as db_get_token,
    save_token as db_save_token,
    delete_token as db_delete_token,
    update_token_status,
    get_active_token_name,
    set_active_token_name,
)
from raunch import db as raunch_db
from raunch.llm import reload_client

logger = logging.getLogger(__name__)

router = APIRouter(tags=["auth"])

ADMIN_EMAIL = os.environ.get("ADMIN_EMAIL", "joshua.bell.828@gmail.com")


# ─── Models ───────────────────────────────────────────────────────────────────

class TokenInfo(BaseModel):
    name: str
    preview: str
    status: str
    reset_time: Optional[str] = None
    active: bool = False


class TokenCreate(BaseModel):
    name: str
    token: str


class TokenActivateResponse(BaseModel):
    success: bool
    name: str
    message: str


class AdminEmailRequest(BaseModel):
    admin_email: str


class CleanupResult(BaseModel):
    deleted_count: int
    deleted_books: List[str]


# ─── Token Endpoints ──────────────────────────────────────────────────────────

@router.get("/api/v1/auth/tokens", response_model=List[TokenInfo])
async def list_auth_tokens():
    """List all stored OAuth tokens."""
    tokens = db_list_tokens()
    active_name = get_active_token_name()

    return [
        TokenInfo(
            name=t["name"],
            preview=f"{t['token'][:15]}...{t['token'][-4:]}" if len(t["token"]) > 19 else "***",
            status=t["status"] or "unknown",
            reset_time=t["reset_time"],
            active=t["name"] == active_name,
        )
        for t in tokens
    ]


@router.post("/api/v1/auth/tokens", response_model=TokenInfo)
async def create_auth_token(req: TokenCreate):
    """Save a new OAuth token."""
    if not req.token.startswith("sk-ant-"):
        raise HTTPException(status_code=400, detail="Invalid token format")

    db_save_token(req.name, req.token)
    active_name = get_active_token_name()

    return TokenInfo(
        name=req.name,
        preview=f"{req.token[:15]}...{req.token[-4:]}",
        status="unknown",
        active=req.name == active_name,
    )


@router.post("/api/v1/auth/tokens/{name}/activate", response_model=TokenActivateResponse)
async def activate_auth_token(name: str):
    """Activate a stored token."""
    token_data = db_get_token(name)
    if not token_data:
        raise HTTPException(status_code=404, detail=f"Token '{name}' not found")

    set_active_token_name(name)
    reload_client()

    return TokenActivateResponse(
        success=True,
        name=name,
        message=f"Token '{name}' activated",
    )


@router.delete("/api/v1/auth/tokens/{name}")
async def delete_auth_token(name: str):
    """Delete a stored token."""
    success = db_delete_token(name)
    if not success:
        raise HTTPException(status_code=404, detail=f"Token '{name}' not found")

    if get_active_token_name() == name:
        set_active_token_name(None)

    return {"success": True, "message": f"Token '{name}' deleted"}


@router.post("/api/v1/auth/tokens/{name}/check")
async def check_auth_token(name: str):
    """Check if a token is usable or rate-limited."""
    token_data = db_get_token(name)
    if not token_data:
        raise HTTPException(status_code=404, detail=f"Token '{name}' not found")

    original_token = os.environ.get("CLAUDE_CODE_OAUTH_TOKEN")

    try:
        os.environ["CLAUDE_CODE_OAUTH_TOKEN"] = token_data["token"]

        from raunch.llm import LLMClient
        client = LLMClient()
        response = client.chat(
            system="Reply with only 'ok'.",
            messages=[{"role": "user", "content": "Say ok"}],
            max_tokens=10,
        )

        if "hit your limit" in response.lower() or "resets" in response.lower():
            update_token_status(name, "rate_limited")
            return {"name": name, "status": "rate_limited", "message": response}
        else:
            update_token_status(name, "usable")
            return {"name": name, "status": "usable", "message": "Token is working"}

    except Exception as e:
        error_str = str(e).lower()
        if "401" in error_str or "unauthorized" in error_str:
            update_token_status(name, "invalid")
            return {"name": name, "status": "invalid", "message": "Token is invalid"}
        else:
            update_token_status(name, "error")
            return {"name": name, "status": "error", "message": str(e)}
    finally:
        if original_token:
            os.environ["CLAUDE_CODE_OAUTH_TOKEN"] = original_token
        elif "CLAUDE_CODE_OAUTH_TOKEN" in os.environ:
            del os.environ["CLAUDE_CODE_OAUTH_TOKEN"]


# ─── Admin Cleanup ────────────────────────────────────────────────────────────

@router.post("/api/v1/admin/cleanup-invalid-books", response_model=CleanupResult)
async def cleanup_invalid_books(req: AdminEmailRequest):
    """Delete books with invalid scenario names (admin only)."""
    if req.admin_email.lower() != ADMIN_EMAIL.lower():
        raise HTTPException(status_code=403, detail="Admin access required")

    # Find books with short hex-like scenario names (invalid/test artifacts)
    valid_keywords = ["scenario", "library", "salvation", "gambit", ".json"]
    all_books = raunch_db.list_books_for_librarian("")  # empty string won't match, use direct query
    # Fall back to checking all librarians' books — just iterate known books
    deleted_books = []
    try:
        # Use SQLite raw path if available, otherwise skip cleanup on Firestore
        from raunch.config import DB_BACKEND
        if DB_BACKEND == "sqlite":
            from raunch.db_sqlite import _get_conn
            conn = _get_conn()
            invalid = conn.execute('''
                SELECT id, scenario_name, bookmark FROM books
                WHERE LENGTH(scenario_name) <= 12
                AND scenario_name NOT LIKE '%.json'
                AND scenario_name NOT LIKE '%scenario%'
                AND scenario_name NOT LIKE '%library%'
                AND scenario_name NOT LIKE '%salvation%'
                AND scenario_name NOT LIKE '%gambit%'
            ''').fetchall()
            deleted_books = [f"{row[2]} ({row[1]})" for row in invalid]
            if invalid:
                for row in invalid:
                    raunch_db.delete_book(row[0])
        else:
            # Firestore: not applicable (no stale data from ephemeral SQLite)
            pass
    except Exception as e:
        logger.warning(f"Cleanup error: {e}")

    logger.info(f"Admin cleanup: deleted {len(deleted_books)} invalid books")

    return CleanupResult(
        deleted_count=len(deleted_books),
        deleted_books=deleted_books,
    )
