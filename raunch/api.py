"""FastAPI REST API for raunch multiplayer endpoints."""

import logging
from typing import List, Optional, TYPE_CHECKING

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from .wizard import list_scenarios, random_scenario

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
    tick: Optional[int] = None
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
        tick=world.tick_count,
        characters=character_names,
        turn_timeout=orch.tick_interval if orch.tick_interval > 0 else 60,
    )
