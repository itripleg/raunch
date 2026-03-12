"""FastAPI REST API for raunch multiplayer endpoints."""

import logging
from typing import List, Optional

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

logger = logging.getLogger(__name__)


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
