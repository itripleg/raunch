"""FastAPI REST API for raunch multiplayer endpoints."""

import logging
from typing import List, Optional, TYPE_CHECKING

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from .wizard import list_scenarios, random_scenario, load_scenario
from .agents.character import Character

if TYPE_CHECKING:
    from .orchestrator import Orchestrator

logger = logging.getLogger(__name__)

# =============================================================================
# Module-level orchestrator reference for API access to game state
# =============================================================================

_orchestrator: Optional["Orchestrator"] = None


def set_orchestrator(orch: "Orchestrator") -> None:
    """Set the orchestrator instance for API access to game state."""
    global _orchestrator
    _orchestrator = orch


def get_orchestrator() -> Optional["Orchestrator"]:
    """Get the current orchestrator instance."""
    return _orchestrator


# =============================================================================
# Pydantic Models for API Request/Response Schemas
# =============================================================================


class CharacterSummary(BaseModel):
    """Summary of a character for API responses."""

    name: str
    species: Optional[str] = None


class ScenarioResponse(BaseModel):
    """Response schema for scenario data."""

    file: str
    name: str
    setting: Optional[str] = None
    characters: int = 0
    themes: List[str] = []


class LoadWorldRequest(BaseModel):
    """Request schema for loading a world from a scenario."""

    scenario: str


class WorldResponse(BaseModel):
    """Response schema for world state."""

    running: bool
    world_id: Optional[str] = None
    name: Optional[str] = None
    page: Optional[int] = None
    characters: Optional[List[str]] = None
    turn_timeout: int = 60


class CharacterDetail(BaseModel):
    """Full character details for generated scenarios."""

    name: str
    species: Optional[str] = None
    personality: Optional[str] = None
    appearance: Optional[str] = None
    desires: Optional[str] = None
    backstory: Optional[str] = None
    kinks: Optional[str] = None


class GeneratedScenarioResponse(BaseModel):
    """Response schema for a generated scenario from the wizard."""

    scenario_name: str
    setting: Optional[str] = None
    premise: Optional[str] = None
    themes: List[str] = []
    opening_situation: Optional[str] = None
    characters: List[CharacterDetail] = []


class StopResponse(BaseModel):
    """Response schema for stopping the world."""

    stopped: bool
    message: str


# Create FastAPI app
app = FastAPI(
    title="Raunch API",
    description="REST API for raunch multiplayer game",
    version="1.0.0",
)

# CORS MUST be added as FIRST middleware
# Include both localhost and 127.0.0.1 variants for development
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health")
async def health_check():
    """Health check endpoint."""
    return {"status": "ok"}


@app.get("/api/v1/scenarios", response_model=List[ScenarioResponse])
async def get_scenarios():
    """List all available scenarios."""
    scenarios = list_scenarios()
    return scenarios


@app.post("/api/v1/scenarios/roll", response_model=GeneratedScenarioResponse)
async def roll_scenario():
    """Generate a random scenario using the Smut Wizard."""
    scenario = random_scenario()
    return scenario


@app.get("/api/v1/world", response_model=WorldResponse)
async def get_world():
    """Get current world state."""
    orch = get_orchestrator()
    if orch is None or not orch._running:
        return WorldResponse(running=False)

    world = orch.world
    character_names = list(orch.characters.keys())

    return WorldResponse(
        running=True,
        world_id=world.world_id,
        name=world.world_name,
        page=world.page_count,
        characters=character_names,
        turn_timeout=orch.page_interval if orch.page_interval > 0 else 60,
    )


@app.post("/api/v1/world/load", response_model=WorldResponse)
async def load_world(request: LoadWorldRequest):
    """Load a scenario and start the world."""
    global _orchestrator

    # Check if a world is already running
    if _orchestrator is not None and _orchestrator._running:
        raise HTTPException(
            status_code=409,
            detail="A world is already running. Stop it first with POST /api/v1/world/stop"
        )

    # Load the scenario
    scenario = load_scenario(request.scenario)
    if scenario is None:
        raise HTTPException(
            status_code=404,
            detail=f"Scenario '{request.scenario}' not found"
        )

    # Import Orchestrator here to avoid circular imports
    from .orchestrator import Orchestrator

    # Create a new orchestrator
    orch = Orchestrator()

    # Apply the scenario to the orchestrator
    orch.world.scenario = scenario
    orch.world.world_name = scenario.get("scenario_name", orch.world.world_name)
    orch.world.multiplayer = scenario.get("multiplayer", False)

    # Update starting location from scenario setting
    setting = scenario.get("setting", "")
    if setting:
        loc_name = scenario.get("scenario_name", "The Scene")
        orch.world.locations = {
            loc_name: {
                "description": setting,
                "characters": [],
            }
        }
        location = loc_name
    else:
        location = list(orch.world.locations.keys())[0] if orch.world.locations else "The Scene"

    # Create characters from scenario
    for char_data in scenario.get("characters", []):
        char = Character(
            name=char_data["name"],
            species=char_data.get("species", "Human"),
            personality=char_data.get("personality", ""),
            appearance=char_data.get("appearance", ""),
            desires=char_data.get("desires", ""),
            backstory=char_data.get("backstory", ""),
            kinks=char_data.get("kinks", ""),
        )
        orch.add_character(char, location=location)

    # Set the module-level orchestrator
    _orchestrator = orch

    # Start the world simulation
    orch.start()

    logger.info(f"World loaded: {orch.world.world_name} with {len(orch.characters)} characters")

    return WorldResponse(
        running=True,
        world_id=orch.world.world_id,
        name=orch.world.world_name,
        page=orch.world.page_count,
        characters=list(orch.characters.keys()),
        turn_timeout=orch.page_interval if orch.page_interval > 0 else 60,
    )


@app.post("/api/v1/world/stop", response_model=StopResponse)
async def stop_world():
    """Stop the current world."""
    global _orchestrator

    orch = get_orchestrator()
    if orch is None or not orch._running:
        raise HTTPException(
            status_code=404,
            detail="No world is currently running"
        )

    world_name = orch.world.world_name
    orch.stop()
    _orchestrator = None

    logger.info(f"World stopped: {world_name}")

    return StopResponse(
        stopped=True,
        message=f"World '{world_name}' has been stopped and saved"
    )


class AddCharacterRequest(BaseModel):
    """Request to add a character to the running world."""
    name: str
    species: str = "Human"
    personality: str = "Curious and adaptable"
    appearance: str = "Average build"
    desires: str = "To find their place"
    backstory: str = "A mysterious stranger"
    location: Optional[str] = None


class AddCharacterResponse(BaseModel):
    """Response after adding a character."""
    success: bool
    name: str
    message: str


@app.post("/api/v1/characters", response_model=AddCharacterResponse)
async def add_character(req: AddCharacterRequest):
    """Add a character to the running world."""
    from .agents.character import Character

    orch = get_orchestrator()
    if orch is None:
        raise HTTPException(status_code=404, detail="No world is running")

    if req.name in orch.characters:
        raise HTTPException(status_code=400, detail=f"Character '{req.name}' already exists")

    char = Character(
        name=req.name,
        species=req.species,
        personality=req.personality,
        appearance=req.appearance,
        desires=req.desires,
        backstory=req.backstory,
    )

    location = req.location or list(orch.world.locations.keys())[0] if orch.world.locations else "unknown"
    orch.add_character(char, location=location)

    logger.info(f"Added character: {req.name} ({req.species}) at {location}")

    return AddCharacterResponse(
        success=True,
        name=req.name,
        message=f"Character '{req.name}' added to world at {location}"
    )
