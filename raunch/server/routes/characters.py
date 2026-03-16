"""Character endpoints for books."""

from fastapi import APIRouter, HTTPException, Header, Depends
from pydantic import BaseModel
from typing import Optional, List

from ..library import get_library
from raunch import db
from raunch.agents.character import Character

router = APIRouter(prefix="/api/v1/books/{book_id}/characters", tags=["characters"])

# Additional router for global endpoints (backwards compatibility)
global_router = APIRouter(tags=["characters"])


def get_librarian_id(x_librarian_id: str = Header(..., alias="X-Librarian-ID")) -> str:
    """Extract and validate librarian ID from header."""
    librarian = db.get_librarian(x_librarian_id)
    if librarian is None:
        raise HTTPException(status_code=401, detail="Invalid librarian ID")
    return x_librarian_id


class CharacterResponse(BaseModel):
    name: str
    species: str
    emotional_state: Optional[str] = None
    attached_by: Optional[str] = None


class AddCharacterRequest(BaseModel):
    name: str
    species: str = "Human"
    personality: str = ""
    appearance: str = ""
    desires: str = ""
    backstory: str = ""
    kinks: str = ""
    location: Optional[str] = None


class AddCharacterResponse(BaseModel):
    name: str
    species: str
    message: str


@router.get("", response_model=List[CharacterResponse])
async def list_characters(
    book_id: str,
    librarian_id: str = Depends(get_librarian_id),
):
    """List all characters in the book."""
    library = get_library()
    book = library.get_book(book_id)

    if book is None:
        raise HTTPException(status_code=404, detail="Book not found")

    if not book.orchestrator:
        return []

    result = []
    for name, char in book.orchestrator.characters.items():
        # Check if character is attached by a reader
        attached_by = None
        for reader in book.readers.values():
            if reader.attached_to == name:
                attached_by = reader.reader_id
                break

        result.append(CharacterResponse(
            name=name,
            species=char.character_data.get("species", ""),
            emotional_state=char.emotional_state,
            attached_by=attached_by,
        ))

    return result


@router.post("", status_code=201, response_model=AddCharacterResponse)
async def add_character(
    book_id: str,
    request: AddCharacterRequest,
    librarian_id: str = Depends(get_librarian_id),
):
    """Add a character to the book."""
    library = get_library()
    book = library.get_book(book_id)

    if book is None:
        raise HTTPException(status_code=404, detail="Book not found")

    if not book.orchestrator:
        raise HTTPException(status_code=400, detail="Book not started")

    # Check for duplicate
    name_lower = request.name.lower()
    for existing in book.orchestrator.characters:
        if existing.lower() == name_lower:
            raise HTTPException(status_code=400, detail=f"Character '{existing}' already exists")

    # Create character
    char = Character(
        name=request.name,
        species=request.species,
        personality=request.personality,
        appearance=request.appearance,
        desires=request.desires,
        backstory=request.backstory,
        kinks=request.kinks,
    )

    # Add to orchestrator
    location = request.location
    if not location and book.orchestrator.world.locations:
        location = list(book.orchestrator.world.locations.keys())[0]

    book.orchestrator.add_character(char, location=location or "unknown")

    return AddCharacterResponse(
        name=request.name,
        species=request.species,
        message=f"Character '{request.name}' added",
    )


@router.delete("/{name}")
async def delete_character(
    book_id: str,
    name: str,
    librarian_id: str = Depends(get_librarian_id),
):
    """Remove a character from the book."""
    library = get_library()
    book = library.get_book(book_id)

    if book is None:
        raise HTTPException(status_code=404, detail="Book not found")

    if not book.orchestrator:
        raise HTTPException(status_code=400, detail="Book not started")

    if name not in book.orchestrator.characters:
        raise HTTPException(status_code=404, detail=f"Character '{name}' not found")

    # Remove from orchestrator
    del book.orchestrator.characters[name]

    # Remove from location tracking
    for loc in book.orchestrator.world.locations.values():
        if name in loc.get("characters", []):
            loc["characters"].remove(name)

    return {"deleted": True, "name": name}


class GrabRequest(BaseModel):
    name: str


@router.post("/grab", response_model=AddCharacterResponse)
async def grab_character(
    book_id: str,
    request: GrabRequest,
    librarian_id: str = Depends(get_librarian_id),
):
    """Promote an NPC to a full character."""
    library = get_library()
    book = library.get_book(book_id)

    if book is None:
        raise HTTPException(status_code=404, detail="Book not found")

    if not book.orchestrator:
        raise HTTPException(status_code=400, detail="Book not started")

    world_id = book.orchestrator.world.world_id
    if not world_id:
        raise HTTPException(status_code=400, detail="World has no ID")

    # Check if potential character exists
    potential = db.get_potential_character(world_id, request.name)
    if not potential:
        raise HTTPException(status_code=404, detail=f"NPC '{request.name}' not found")

    if potential["promoted"]:
        raise HTTPException(status_code=400, detail=f"'{request.name}' already promoted")

    # Check for existing character
    name_lower = request.name.lower()
    for existing in book.orchestrator.characters:
        if existing.lower() == name_lower:
            raise HTTPException(status_code=400, detail=f"Character '{existing}' already exists")

    # Promote in database
    db.promote_character(world_id, request.name)

    # Create character
    description = potential["description"] or "A mysterious figure"
    char = Character(
        name=request.name,
        species="Human",
        personality=description,
        appearance=description,
        desires="Unknown",
        backstory=f"First appeared on page {potential['first_page']}",
    )

    location = list(book.orchestrator.world.locations.keys())[0] if book.orchestrator.world.locations else "unknown"
    book.orchestrator.add_character(char, location=location)

    return AddCharacterResponse(
        name=request.name,
        species="Human",
        message=f"NPC '{request.name}' promoted to character",
    )


# Global endpoint for potential characters (backwards compatibility)
class PotentialCharacter(BaseModel):
    name: str
    description: Optional[str] = None
    first_page: int
    promoted: bool = False


@global_router.get("/api/v1/potential-characters", response_model=List[PotentialCharacter])
async def get_potential_characters():
    """List detected but not-yet-promoted characters across all books.

    For backwards compatibility - finds the first active book and returns its potential characters.
    """
    library = get_library()

    # Find first active book with an orchestrator
    for book in library._books.values():
        if book.orchestrator and book.orchestrator.world:
            world_id = book.orchestrator.world.world_id
            if world_id:
                potential = db.get_potential_characters(world_id, include_promoted=False)
                return [
                    PotentialCharacter(
                        name=p["name"],
                        description=p.get("description"),
                        first_page=p["first_page"],
                        promoted=p.get("promoted", False),
                    )
                    for p in potential
                ]

    return []
