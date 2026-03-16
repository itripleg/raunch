"""Librarian endpoints."""

from typing import Optional

from fastapi import APIRouter, HTTPException, Header, Depends
from pydantic import BaseModel

from raunch import db

router = APIRouter(prefix="/api/v1/librarians", tags=["librarians"])


def get_librarian_id(x_librarian_id: str = Header(..., alias="X-Librarian-ID")) -> str:
    """Get librarian ID from header."""
    return x_librarian_id


class CreateLibrarianRequest(BaseModel):
    nickname: str
    kinde_user_id: Optional[str] = None


class SetLastActiveBookRequest(BaseModel):
    book_id: Optional[str] = None


class LibrarianResponse(BaseModel):
    librarian_id: str
    nickname: str
    kinde_user_id: Optional[str] = None
    last_active_book_id: Optional[str] = None
    created_at: str


@router.post("", status_code=201, response_model=LibrarianResponse)
async def create_librarian(request: CreateLibrarianRequest):
    """Create a librarian, optionally linked to a Kinde user."""
    librarian = db.create_librarian(request.nickname, request.kinde_user_id)
    return LibrarianResponse(
        librarian_id=librarian["id"],
        nickname=librarian["nickname"],
        kinde_user_id=librarian.get("kinde_user_id"),
        last_active_book_id=librarian.get("last_active_book_id"),
        created_at=librarian["created_at"],
    )


@router.get("/by-kinde/{kinde_user_id}", response_model=LibrarianResponse)
async def get_librarian_by_kinde(kinde_user_id: str):
    """Get a librarian by their Kinde user ID."""
    librarian = db.get_librarian_by_kinde_id(kinde_user_id)
    if librarian is None:
        raise HTTPException(status_code=404, detail="Librarian not found for this Kinde user")

    return LibrarianResponse(
        librarian_id=librarian["id"],
        nickname=librarian["nickname"],
        kinde_user_id=librarian.get("kinde_user_id"),
        last_active_book_id=librarian.get("last_active_book_id"),
        created_at=librarian["created_at"],
    )


@router.get("/{librarian_id}", response_model=LibrarianResponse)
async def get_librarian(librarian_id: str):
    """Get a librarian by ID."""
    librarian = db.get_librarian(librarian_id)
    if librarian is None:
        raise HTTPException(status_code=404, detail="Librarian not found")

    return LibrarianResponse(
        librarian_id=librarian["id"],
        nickname=librarian["nickname"],
        kinde_user_id=librarian.get("kinde_user_id"),
        last_active_book_id=librarian.get("last_active_book_id"),
        created_at=librarian["created_at"],
    )


@router.put("/me/last-active-book")
async def set_last_active_book(
    request: SetLastActiveBookRequest,
    librarian_id: str = Depends(get_librarian_id)
):
    """Set the last active book for the current librarian."""
    success = db.set_librarian_last_active_book(librarian_id, request.book_id)
    if not success:
        raise HTTPException(status_code=404, detail="Librarian not found")
    return {"success": True}
