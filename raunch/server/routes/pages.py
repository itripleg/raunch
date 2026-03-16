"""Page history endpoints for books."""

from fastapi import APIRouter, HTTPException, Header, Depends, Query
from pydantic import BaseModel
from typing import Optional, List, Dict

from ..library import get_library
from raunch import db

router = APIRouter(prefix="/api/v1/books/{book_id}/pages", tags=["pages"])


def get_librarian_id(x_librarian_id: str = Header(..., alias="X-Librarian-ID")) -> str:
    """Extract and validate librarian ID from header."""
    librarian = db.get_librarian(x_librarian_id)
    if librarian is None:
        raise HTTPException(status_code=401, detail="Invalid librarian ID")
    return x_librarian_id


class CharacterPageData(BaseModel):
    """Character data for a single page."""

    action: Optional[str] = None
    dialogue: Optional[str] = None
    emotional_state: Optional[str] = None
    inner_thoughts: Optional[str] = None
    desires_update: Optional[str] = None


class PageResponse(BaseModel):
    """Single page response."""

    page: int
    narration: str
    mood: Optional[str] = None
    world_time: Optional[str] = None
    events: List[str] = []
    characters: Dict[str, CharacterPageData] = {}
    created_at: Optional[str] = None


class PagesListResponse(BaseModel):
    """Paginated pages list response."""

    pages: List[PageResponse]
    total: int
    limit: int
    offset: int


@router.get("", response_model=PagesListResponse)
async def list_pages(
    book_id: str,
    limit: int = Query(10, ge=1, le=100),
    offset: int = Query(0, ge=0),
    librarian_id: str = Depends(get_librarian_id),
):
    """Get page history for a book."""
    library = get_library()
    book = library.get_book(book_id)

    if book is None:
        raise HTTPException(status_code=404, detail="Book not found")

    if not book.orchestrator or not book.orchestrator.world.world_id:
        return PagesListResponse(pages=[], total=0, limit=limit, offset=offset)

    world_id = book.orchestrator.world.world_id

    # Get pages from database
    pages_data = db.get_page_history(world_id, limit=limit, offset=offset)
    total = db.get_page_count(world_id)

    pages = []
    for p in pages_data:
        # Get character data for this page
        char_pages = db.get_character_pages(world_id, p["page"])
        characters = {}
        for cp in char_pages:
            characters[cp["character_name"]] = CharacterPageData(
                action=cp.get("action"),
                dialogue=cp.get("dialogue"),
                emotional_state=cp.get("emotional_state"),
                inner_thoughts=cp.get("inner_thoughts"),
                desires_update=cp.get("desires_update"),
            )

        pages.append(PageResponse(
            page=p["page"],
            narration=p.get("narration", ""),
            mood=p.get("mood"),
            world_time=p.get("world_time"),
            events=p.get("events", []),
            characters=characters,
            created_at=p.get("created_at"),
        ))

    return PagesListResponse(pages=pages, total=total, limit=limit, offset=offset)


@router.get("/{page_num}", response_model=PageResponse)
async def get_page(
    book_id: str,
    page_num: int,
    librarian_id: str = Depends(get_librarian_id),
):
    """Get a specific page from history."""
    library = get_library()
    book = library.get_book(book_id)

    if book is None:
        raise HTTPException(status_code=404, detail="Book not found")

    if not book.orchestrator or not book.orchestrator.world.world_id:
        raise HTTPException(status_code=404, detail="No page history")

    world_id = book.orchestrator.world.world_id

    # Get page from database
    page_data = db.get_page(world_id, page_num)
    if not page_data:
        raise HTTPException(status_code=404, detail=f"Page {page_num} not found")

    # Get character data
    char_pages = db.get_character_pages(world_id, page_num)
    characters = {}
    for cp in char_pages:
        characters[cp["character_name"]] = CharacterPageData(
            action=cp.get("action"),
            dialogue=cp.get("dialogue"),
            emotional_state=cp.get("emotional_state"),
            inner_thoughts=cp.get("inner_thoughts"),
            desires_update=cp.get("desires_update"),
        )

    return PageResponse(
        page=page_data["page"],
        narration=page_data.get("narration", ""),
        mood=page_data.get("mood"),
        world_time=page_data.get("world_time"),
        events=page_data.get("events", []),
        characters=characters,
        created_at=page_data.get("created_at"),
    )
