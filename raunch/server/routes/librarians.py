"""Librarian endpoints."""

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from raunch import db

router = APIRouter(prefix="/api/v1/librarians", tags=["librarians"])


class CreateLibrarianRequest(BaseModel):
    nickname: str


class LibrarianResponse(BaseModel):
    librarian_id: str
    nickname: str
    created_at: str


@router.post("", status_code=201, response_model=LibrarianResponse)
async def create_librarian(request: CreateLibrarianRequest):
    """Create an anonymous librarian."""
    librarian = db.create_librarian(request.nickname)
    return LibrarianResponse(
        librarian_id=librarian["id"],
        nickname=librarian["nickname"],
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
        created_at=librarian["created_at"],
    )
