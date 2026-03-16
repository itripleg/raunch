"""Book endpoints."""

from fastapi import APIRouter, HTTPException, Header, Depends
from pydantic import BaseModel
from typing import Optional, List

from ..library import get_library, BookLimitReached
from raunch import db

router = APIRouter(prefix="/api/v1/books", tags=["books"])


def get_librarian_id(x_librarian_id: str = Header(..., alias="X-Librarian-ID")) -> str:
    """Extract and validate librarian ID from header."""
    librarian = db.get_librarian(x_librarian_id)
    if librarian is None:
        raise HTTPException(status_code=401, detail="Invalid librarian ID")
    return x_librarian_id


class CreateBookRequest(BaseModel):
    scenario: str
    private: bool = False


class CreateBookResponse(BaseModel):
    book_id: str
    bookmark: str


class JoinBookRequest(BaseModel):
    bookmark: str


class JoinBookResponse(BaseModel):
    book_id: str


class BookResponse(BaseModel):
    book_id: str
    bookmark: str
    scenario_name: str
    owner_id: Optional[str]
    private: bool
    page_count: int
    created_at: str
    last_active: str
    characters: List[str]
    readers: List[dict]
    paused: bool
    page_interval: int


@router.post("", status_code=201, response_model=CreateBookResponse)
async def create_book(
    request: CreateBookRequest,
    librarian_id: str = Depends(get_librarian_id),
):
    """Create a new book from a scenario."""
    library = get_library()

    try:
        book_id, bookmark = library.open_book(
            request.scenario,
            librarian_id,
            request.private,
        )
    except BookLimitReached as e:
        raise HTTPException(status_code=400, detail=str(e))

    return CreateBookResponse(book_id=book_id, bookmark=bookmark)


@router.get("", response_model=List[dict])
async def list_books(librarian_id: str = Depends(get_librarian_id)):
    """List books accessible to the librarian."""
    return db.list_books_for_librarian(librarian_id)


@router.get("/{book_id}", response_model=BookResponse)
async def get_book(
    book_id: str,
    librarian_id: str = Depends(get_librarian_id),
):
    """Get a book's current state."""
    library = get_library()
    book = library.get_book(book_id)

    if book is None:
        raise HTTPException(status_code=404, detail="Book not found")

    state = book.get_state()
    return BookResponse(**state.to_dict())


@router.delete("/{book_id}")
async def delete_book(
    book_id: str,
    librarian_id: str = Depends(get_librarian_id),
):
    """Delete a book (owner only)."""
    library = get_library()
    book = library.get_book(book_id)

    if book is None:
        raise HTTPException(status_code=404, detail="Book not found")

    if book.owner_id != librarian_id:
        raise HTTPException(status_code=403, detail="Only the owner can delete this book")

    library.close_book(book_id)
    return {"deleted": True}


@router.post("/join", response_model=JoinBookResponse)
async def join_book(
    request: JoinBookRequest,
    librarian_id: str = Depends(get_librarian_id),
):
    """Join a book via bookmark."""
    library = get_library()
    book_id = library.find_by_bookmark(request.bookmark)

    if book_id is None:
        raise HTTPException(status_code=404, detail="Book not found")

    book = library.get_book(book_id)
    if book and book.private:
        # Check if user has access
        books = db.list_books_for_librarian(librarian_id)
        if not any(b["id"] == book_id for b in books):
            raise HTTPException(status_code=403, detail="This book is private")

    # Grant access if not already granted
    db.grant_book_access(book_id, librarian_id, role="reader")

    return JoinBookResponse(book_id=book_id)


class PauseResponse(BaseModel):
    paused: bool


class SettingsRequest(BaseModel):
    page_interval: Optional[int] = None


@router.post("/{book_id}/pause", response_model=PauseResponse)
async def pause_book(
    book_id: str,
    librarian_id: str = Depends(get_librarian_id),
):
    """Pause page generation for a book."""
    library = get_library()
    book = library.get_book(book_id)

    if book is None:
        raise HTTPException(status_code=404, detail="Book not found")

    if book.orchestrator:
        book.orchestrator.pause()

    return PauseResponse(paused=True)


@router.post("/{book_id}/resume", response_model=PauseResponse)
async def resume_book(
    book_id: str,
    librarian_id: str = Depends(get_librarian_id),
):
    """Resume page generation for a book."""
    library = get_library()
    book = library.get_book(book_id)

    if book is None:
        raise HTTPException(status_code=404, detail="Book not found")

    if book.orchestrator:
        book.orchestrator.resume()

    return PauseResponse(paused=False)


@router.post("/{book_id}/page")
async def trigger_page(
    book_id: str,
    librarian_id: str = Depends(get_librarian_id),
):
    """Trigger the next page generation."""
    library = get_library()
    book = library.get_book(book_id)

    if book is None:
        raise HTTPException(status_code=404, detail="Book not found")

    if book.orchestrator:
        triggered = book.orchestrator.trigger_page()
        return {"triggered": triggered}

    return {"triggered": False, "message": "Book not started"}


@router.put("/{book_id}/settings")
async def update_settings(
    book_id: str,
    request: SettingsRequest,
    librarian_id: str = Depends(get_librarian_id),
):
    """Update book settings."""
    library = get_library()
    book = library.get_book(book_id)

    if book is None:
        raise HTTPException(status_code=404, detail="Book not found")

    if request.page_interval is not None and book.orchestrator:
        book.orchestrator.set_tick_interval(request.page_interval)

    return {"updated": True}
