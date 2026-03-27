"""Book endpoints."""

from fastapi import APIRouter, HTTPException, Header, Depends
from pydantic import BaseModel
from typing import Optional, List

from ..library import get_library, BookLimitReached
from raunch import db

router = APIRouter(prefix="/api/v1/books", tags=["books"])

# Backwards compatibility router for /api/v1/world
compat_router = APIRouter(tags=["backwards-compat"])


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
    """List books accessible to the librarian, enriched with scenario details."""
    from raunch.wizard import load_scenario
    books = db.list_books_for_librarian(librarian_id)
    for book in books:
        raw_name = book.get("scenario_name", "")
        try:
            data = load_scenario(raw_name)
            if data:
                if data.get("scenario_name"):
                    book["scenario_name"] = data["scenario_name"]
                book["setting"] = data.get("setting")
                book["characters"] = [c.get("name", "?") for c in data.get("characters", [])]
                book["premise"] = data.get("premise")
        except Exception:
            pass
        # Get last page mood and reader count
        try:
            book["mood"] = db.get_latest_mood(book["id"])
            book["readers"] = db.count_book_readers(book["id"])
        except Exception:
            pass
    return books


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


@router.delete("/{book_id}/leave")
async def leave_book(
    book_id: str,
    librarian_id: str = Depends(get_librarian_id),
):
    """Leave a joined book (removes reader access, cannot leave owned books)."""
    removed = db.revoke_book_access(book_id, librarian_id)
    if not removed:
        raise HTTPException(status_code=400, detail="Cannot leave — you own this book or aren't a member")
    return {"left": True}


@router.get("/public", response_model=List[dict])
async def list_public_books():
    """List all public books available to join."""
    from raunch.wizard import load_scenario
    books = db.list_public_books()
    for book in books:
        raw_name = book.get("scenario_name", "")
        try:
            data = load_scenario(raw_name)
            if data:
                if data.get("scenario_name"):
                    book["scenario_name"] = data["scenario_name"]
                book["setting"] = data.get("setting")
                book["characters"] = [c.get("name", "?") for c in data.get("characters", [])]
                book["premise"] = data.get("premise")
        except Exception:
            pass
        try:
            book["readers"] = db.count_book_readers(book["id"])
            book["mood"] = db.get_latest_mood(book["id"])
        except Exception:
            pass
    return books


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

    # Bookmark always grants access — private flag only controls public listing
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
    """Trigger the next page generation. Owner only."""
    library = get_library()
    book = library.get_book(book_id)

    if book is None:
        raise HTTPException(status_code=404, detail="Book not found")

    if book.owner_id != librarian_id:
        raise HTTPException(status_code=403, detail="Only the book owner can generate pages")

    if book.orchestrator:
        triggered = book.orchestrator.trigger_page()
        return {"triggered": triggered}

    return {"triggered": False, "message": "Book not started"}


@router.put("/{book_id}/share")
async def toggle_book_share(
    book_id: str,
    librarian_id: str = Depends(get_librarian_id),
):
    """Toggle a book's public/private status (owner only)."""
    library = get_library()
    book = library.get_book(book_id)

    if book is None:
        raise HTTPException(status_code=404, detail="Book not found")

    if book.owner_id != librarian_id:
        raise HTTPException(status_code=403, detail="Only the owner can share this book")

    new_private = not book.private
    db.set_book_private(book_id, new_private)
    book.private = new_private

    return {"shared": not new_private, "private": new_private}


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
        interval = request.page_interval
        # Minimum 30s for auto mode
        if interval > 0 and interval < 30:
            interval = 30
        book.orchestrator.set_page_interval(interval)

    return {"updated": True}


@router.post("/{book_id}/reset")
async def reset_book(
    book_id: str,
    librarian_id: str = Depends(get_librarian_id),
):
    """Reset a book to reuse its scenario (owner only)."""
    library = get_library()
    book = library.get_book(book_id)

    if book is None:
        raise HTTPException(status_code=404, detail="Book not found")

    if book.owner_id != librarian_id:
        raise HTTPException(status_code=403, detail="Only the owner can reset this book")

    # Stop the orchestrator if running and clear it so reconnect creates a fresh one
    if book.orchestrator:
        book.orchestrator.stop()
        book.set_orchestrator(None)

    # Clear all pages and characters from database
    success = db.reset_book(book_id)

    if not success:
        raise HTTPException(status_code=500, detail="Failed to reset book")

    return {"reset": True}


# Backwards compatibility: /api/v1/world returns first active book's world state
class WorldResponse(BaseModel):
    running: bool
    world_id: Optional[str] = None
    world_name: Optional[str] = None
    page_count: int = 0
    world_time: Optional[str] = None
    mood: Optional[str] = None
    characters: List[str] = []
    multiplayer: bool = False


@compat_router.get("/api/v1/world", response_model=WorldResponse)
async def get_world_compat():
    """Get current world state (backwards compatibility).

    Returns the first active book's world state.
    """
    library = get_library()

    # Find first active book with an orchestrator
    for book in library.books.values():
        if book.orchestrator and book.orchestrator._running:
            orch = book.orchestrator
            world = orch.world
            return WorldResponse(
                running=True,
                world_id=world.world_id,
                world_name=world.world_name,
                page_count=world.page_count,
                world_time=world.world_time,
                mood=world.mood,
                characters=list(orch.characters.keys()),
                multiplayer=world.multiplayer,
            )

    return WorldResponse(running=False)
