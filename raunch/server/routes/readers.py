"""Reader endpoints for books."""

from fastapi import APIRouter, HTTPException, Header, Depends
from pydantic import BaseModel
from typing import Optional, List

from ..library import get_library
from raunch import db

router = APIRouter(prefix="/api/v1/books/{book_id}/readers", tags=["readers"])


def get_librarian_id(x_librarian_id: str = Header(..., alias="X-Librarian-ID")) -> str:
    """Extract and validate librarian ID from header."""
    librarian = db.get_librarian(x_librarian_id)
    if librarian is None:
        raise HTTPException(status_code=401, detail="Invalid librarian ID")
    return x_librarian_id


class ReaderResponse(BaseModel):
    """Reader information response."""

    reader_id: str
    nickname: str
    attached_to: Optional[str] = None
    ready: bool = False


@router.get("", response_model=List[ReaderResponse])
async def list_readers(
    book_id: str,
    librarian_id: str = Depends(get_librarian_id),
):
    """List all connected readers in the book."""
    library = get_library()
    book = library.get_book(book_id)

    if book is None:
        raise HTTPException(status_code=404, detail="Book not found")

    return [
        ReaderResponse(
            reader_id=r.reader_id,
            nickname=r.nickname,
            attached_to=r.attached_to,
            ready=r.ready,
        )
        for r in book.readers.values()
    ]


@router.delete("/{reader_id}")
async def kick_reader(
    book_id: str,
    reader_id: str,
    librarian_id: str = Depends(get_librarian_id),
):
    """Kick a reader from the book (owner only)."""
    library = get_library()
    book = library.get_book(book_id)

    if book is None:
        raise HTTPException(status_code=404, detail="Book not found")

    # Check ownership
    if book.owner_id != librarian_id:
        raise HTTPException(status_code=403, detail="Only the owner can kick readers")

    if reader_id not in book.readers:
        raise HTTPException(status_code=404, detail="Reader not found")

    book.remove_reader(reader_id)

    return {"kicked": True, "reader_id": reader_id}
