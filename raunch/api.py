"""FastAPI REST API for raunch multiplayer endpoints."""

import logging
from typing import List, Optional, TYPE_CHECKING

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from .wizard import (
    list_scenarios,
    random_scenario,
    load_scenario,
    generate_scenario,
    save_scenario,
    SETTINGS,
    KINK_POOLS,
    VIBES,
)
from .db import (
    get_remembered_characters,
    get_potential_characters as db_get_potential_characters,
    get_potential_character,
    promote_character,
    # Alpha dashboard
    get_alpha_message,
    set_alpha_message,
    get_feedback_items,
    create_feedback_item,
    update_feedback_item,
    delete_feedback_item,
    vote_feedback_item,
    get_polls,
    create_poll,
    add_poll_option,
    vote_poll,
    close_poll,
    delete_poll,
)
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


class NPCInfo(BaseModel):
    """NPC info for promoting to character."""

    name: str
    description: Optional[str] = None
    species: Optional[str] = None
    personality: Optional[str] = None
    appearance: Optional[str] = None
    desires: Optional[str] = None
    backstory: Optional[str] = None


class RememberedCharacter(BaseModel):
    """Character remembered from story history."""

    name: str
    appearances: int = 0
    last_seen_page: Optional[int] = None
    emotional_state: Optional[str] = None
    personality: Optional[str] = None
    sample_dialogue: List[str] = []
    sample_actions: List[str] = []


class WorldResponse(BaseModel):
    """Response schema for world state."""

    running: bool
    world_id: Optional[str] = None
    name: Optional[str] = None
    page: Optional[int] = None
    characters: Optional[List[str]] = None
    npcs: Optional[List[NPCInfo]] = None
    remembered: Optional[List[RememberedCharacter]] = None
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


class PotentialCharacter(BaseModel):
    """A character detected by the narrator but not yet promoted."""

    name: str
    description: Optional[str] = None
    first_page: int
    times_mentioned: int = 1


class GrabResponse(BaseModel):
    """Response after grabbing (promoting) a potential character."""

    success: bool
    name: str
    message: str


# Create FastAPI app
app = FastAPI(
    title="Raunch API",
    description="REST API for raunch multiplayer game",
    version="1.0.0",
)

# CORS MUST be added as FIRST middleware
# Include localhost for dev + production domains
CORS_ORIGINS = [
    "http://localhost:5173",
    "http://127.0.0.1:5173",
    "https://raunch.motherhaven.net",
    "https://raunch.netlify.app",
]
# Allow additional origins from env
if os.environ.get("CORS_ORIGINS"):
    CORS_ORIGINS.extend(os.environ["CORS_ORIGINS"].split(","))

app.add_middleware(
    CORSMiddleware,
    allow_origins=CORS_ORIGINS,
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


class WizardOptionsResponse(BaseModel):
    """Available options for the Smut Wizard."""
    settings: List[str]
    kinks: List[str]
    vibes: List[str]


class WizardGenerateRequest(BaseModel):
    """Request to generate a scenario."""
    setting: Optional[str] = None
    kinks: Optional[List[str]] = None
    vibe: Optional[str] = None
    preferences: Optional[str] = None
    num_characters: int = 3
    save: bool = False


class ScenarioSaveResponse(BaseModel):
    """Response after saving a scenario."""
    saved_to: str


@app.get("/api/v1/wizard/options", response_model=WizardOptionsResponse)
async def get_wizard_options():
    """Get available options for the Smut Wizard."""
    return WizardOptionsResponse(
        settings=SETTINGS,
        kinks=KINK_POOLS,
        vibes=VIBES,
    )


@app.post("/api/v1/wizard/generate", response_model=GeneratedScenarioResponse)
async def wizard_generate(request: WizardGenerateRequest):
    """Generate a scenario with the Smut Wizard."""
    try:
        scenario = generate_scenario(
            preferences=request.preferences,
            num_characters=request.num_characters,
            kinks=request.kinks,
            setting_hint=request.setting,
            vibe=request.vibe,
        )
        if request.save:
            path = save_scenario(scenario)
            scenario["saved_to"] = path
        return scenario
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/v1/scenarios/save", response_model=ScenarioSaveResponse)
async def save_scenario_endpoint(scenario: GeneratedScenarioResponse):
    """Save a generated scenario to disk."""
    try:
        path = save_scenario(scenario.model_dump())
        return ScenarioSaveResponse(saved_to=path)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/v1/world", response_model=WorldResponse)
async def get_world():
    """Get current world state."""
    orch = get_orchestrator()
    if orch is None or not orch._running:
        return WorldResponse(running=False)

    world = orch.world
    character_names = list(orch.characters.keys())

    # Get NPCs and scenario characters (for auto-fill in character wizard)
    npcs = []
    if world.scenario:
        # Add NPCs
        for npc in world.scenario.get("npcs", []):
            npcs.append(NPCInfo(
                name=npc.get("name", ""),
                description=npc.get("description"),
                species=npc.get("species"),
                personality=npc.get("personality"),
                appearance=npc.get("appearance"),
                desires=npc.get("desires"),
                backstory=npc.get("backstory"),
            ))
        # Also add scenario characters (for reference/auto-fill)
        for char in world.scenario.get("characters", []):
            npcs.append(NPCInfo(
                name=char.get("name", ""),
                description=char.get("personality"),  # Use personality as description
                species=char.get("species"),
                personality=char.get("personality"),
                appearance=char.get("appearance"),
                desires=char.get("desires"),
                backstory=char.get("backstory"),
            ))

    # Get characters remembered from story history
    remembered = []
    if world.world_id:
        try:
            remembered_data = get_remembered_characters(world.world_id)
            for r in remembered_data:
                remembered.append(RememberedCharacter(
                    name=r["name"],
                    appearances=r["appearances"],
                    last_seen_page=r["last_seen_page"],
                    emotional_state=r["emotional_state"],
                    personality=r["personality"],
                    sample_dialogue=r["sample_dialogue"],
                    sample_actions=r["sample_actions"],
                ))
        except Exception as e:
            logger.warning(f"Failed to get remembered characters: {e}")

    return WorldResponse(
        running=True,
        world_id=world.world_id,
        name=world.world_name,
        page=world.page_count,
        characters=character_names,
        npcs=npcs if npcs else None,
        remembered=remembered if remembered else None,
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

    # Case-insensitive duplicate check
    name_lower = req.name.lower()
    for existing_name in orch.characters:
        if existing_name.lower() == name_lower:
            raise HTTPException(status_code=400, detail=f"Character '{existing_name}' already exists")

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

    # Persist character to scenario so it survives restart
    if orch.world.scenario is not None:
        if "characters" not in orch.world.scenario:
            orch.world.scenario["characters"] = []
        orch.world.scenario["characters"].append({
            "name": req.name,
            "species": req.species,
            "personality": req.personality,
            "appearance": req.appearance,
            "desires": req.desires,
            "backstory": req.backstory,
        })
        # Save immediately so character persists
        orch.world.save(orch.world.world_name)

    logger.info(f"Added character: {req.name} ({req.species}) at {location}")

    return AddCharacterResponse(
        success=True,
        name=req.name,
        message=f"Character '{req.name}' added to world at {location}"
    )


class DeleteCharacterResponse(BaseModel):
    """Response after deleting a character."""
    success: bool
    name: str
    message: str


@app.delete("/api/v1/characters/{name}", response_model=DeleteCharacterResponse)
async def delete_character(name: str):
    """Remove a character from the world (history is preserved)."""
    orch = get_orchestrator()
    if orch is None:
        raise HTTPException(status_code=404, detail="No world is running")

    if name not in orch.characters:
        raise HTTPException(status_code=404, detail=f"Character '{name}' not found")

    # Remove from orchestrator
    del orch.characters[name]

    # Remove from location tracking
    for loc in orch.world.locations.values():
        if name in loc.get("characters", []):
            loc["characters"].remove(name)

    # Remove from scenario (so they don't respawn on restart)
    if orch.world.scenario is not None:
        chars = orch.world.scenario.get("characters", [])
        orch.world.scenario["characters"] = [c for c in chars if c.get("name") != name]
        # Save immediately
        orch.world.save(orch.world.world_name)

    # Note: History in database is intentionally preserved (character "left the scene")

    logger.info(f"Deleted character: {name}")

    return DeleteCharacterResponse(
        success=True,
        name=name,
        message=f"Character '{name}' has left the scene (history preserved)"
    )


@app.get("/api/v1/potential-characters", response_model=List[PotentialCharacter])
async def get_potential_characters():
    """List detected but not-yet-promoted characters.

    Returns characters that the narrator has identified but which have not
    been "grabbed" (promoted) to full playable characters yet.
    """
    orch = get_orchestrator()
    if orch is None or not orch._running:
        raise HTTPException(status_code=404, detail="No world is running")

    world_id = orch.world.world_id
    if not world_id:
        raise HTTPException(status_code=404, detail="World has no ID")

    potential = db_get_potential_characters(world_id, include_promoted=False)

    return [
        PotentialCharacter(
            name=p["name"],
            description=p["description"],
            first_page=p["first_page"],
            times_mentioned=p["times_mentioned"],
        )
        for p in potential
    ]


@app.post("/api/v1/grab/{name}", response_model=GrabResponse)
async def grab_character(name: str):
    """Promote a potential character to a full character.

    This "grabs" a character that the narrator has mentioned and makes them
    a full playable character. For now, creates a basic character profile;
    full LLM-generated profiles can be added later.
    """
    orch = get_orchestrator()
    if orch is None or not orch._running:
        raise HTTPException(status_code=404, detail="No world is running")

    world_id = orch.world.world_id
    if not world_id:
        raise HTTPException(status_code=404, detail="World has no ID")

    # Check if potential character exists
    potential = get_potential_character(world_id, name)
    if not potential:
        raise HTTPException(
            status_code=404,
            detail=f"Potential character '{name}' not found"
        )

    if potential["promoted"]:
        raise HTTPException(
            status_code=400,
            detail=f"Character '{name}' has already been promoted"
        )

    # Check if character already exists in the world
    name_lower = name.lower()
    for existing_name in orch.characters:
        if existing_name.lower() == name_lower:
            raise HTTPException(
                status_code=400,
                detail=f"Character '{existing_name}' already exists in the world"
            )

    # Mark as promoted in the database
    success = promote_character(world_id, name)
    if not success:
        raise HTTPException(
            status_code=500,
            detail=f"Failed to promote character '{name}'"
        )

    # Create a basic character with the description from the narrator
    description = potential["description"] or "A mysterious figure"

    char = Character(
        name=name,
        species="Human",  # Default; can be enhanced later with LLM
        personality=description,
        appearance=description,
        desires="Unknown",
        backstory=f"First appeared on page {potential['first_page']}",
    )

    # Add to world
    location = list(orch.world.locations.keys())[0] if orch.world.locations else "unknown"
    orch.add_character(char, location=location)

    # Persist to scenario
    if orch.world.scenario is not None:
        if "characters" not in orch.world.scenario:
            orch.world.scenario["characters"] = []
        orch.world.scenario["characters"].append({
            "name": name,
            "species": "Human",
            "personality": description,
            "appearance": description,
            "desires": "Unknown",
            "backstory": f"First appeared on page {potential['first_page']}",
        })
        orch.world.save(orch.world.world_name)

    logger.info(f"Grabbed character: {name} (mentioned {potential['times_mentioned']} times)")

    return GrabResponse(
        success=True,
        name=name,
        message=f"Character '{name}' has been promoted to a full character"
    )


# =============================================================================
# Alpha Dashboard Endpoints
# =============================================================================

# Simple admin code - in production, use environment variable
ADMIN_CODE = "raunch-alpha-dev"


class AlphaMessage(BaseModel):
    """Hero message for the alpha dashboard."""
    content: str
    updated_at: Optional[str] = None


class AlphaMessageUpdate(BaseModel):
    """Request to update the hero message."""
    content: str


class AdminVerifyRequest(BaseModel):
    """Admin verification request."""
    code: str


class AdminVerifyResponse(BaseModel):
    """Admin verification response."""
    valid: bool


@app.post("/api/v1/alpha/admin/verify", response_model=AdminVerifyResponse)
async def verify_admin(req: AdminVerifyRequest):
    """Verify admin code."""
    return AdminVerifyResponse(valid=req.code == ADMIN_CODE)


@app.get("/api/v1/alpha/message")
async def get_message():
    """Get the hero/dev message."""
    msg = get_alpha_message()
    if msg is None:
        return AlphaMessage(
            content="Welcome to the Raunch alpha! Your feedback shapes what we create.",
            updated_at=None,
        )
    return AlphaMessage(content=msg["content"], updated_at=msg["updated_at"])


@app.put("/api/v1/alpha/message")
async def update_message(req: AlphaMessageUpdate):
    """Update the hero/dev message (admin only - no auth check for alpha)."""
    msg = set_alpha_message(req.content)
    return AlphaMessage(content=msg["content"], updated_at=msg["updated_at"])


class FeedbackItem(BaseModel):
    """Feedback item response."""
    id: int
    title: str
    notes: Optional[str] = None
    status: str
    outcome: Optional[str] = None
    outcome_notes: Optional[str] = None
    upvotes: int = 0
    has_voted: Optional[bool] = None
    created_at: str
    updated_at: Optional[str] = None


class FeedbackItemCreate(BaseModel):
    """Create feedback item request."""
    title: str
    notes: Optional[str] = None
    status: str = "requests"


class FeedbackItemUpdate(BaseModel):
    """Update feedback item request."""
    status: Optional[str] = None
    outcome: Optional[str] = None
    outcome_notes: Optional[str] = None


@app.get("/api/v1/alpha/feedback", response_model=List[FeedbackItem])
async def list_feedback(voter_id: Optional[str] = None):
    """Get all feedback items."""
    items = get_feedback_items(voter_id)
    return [FeedbackItem(**item) for item in items]


@app.post("/api/v1/alpha/feedback", response_model=FeedbackItem)
async def create_feedback(req: FeedbackItemCreate):
    """Create a new feedback item."""
    item = create_feedback_item(req.title, req.notes, req.status)
    return FeedbackItem(**item)


@app.put("/api/v1/alpha/feedback/{item_id}", response_model=FeedbackItem)
async def update_feedback(item_id: int, req: FeedbackItemUpdate):
    """Update a feedback item (admin)."""
    item = update_feedback_item(item_id, req.status, req.outcome, req.outcome_notes)
    if item is None:
        raise HTTPException(status_code=404, detail="Feedback item not found")
    return FeedbackItem(**item)


@app.delete("/api/v1/alpha/feedback/{item_id}")
async def remove_feedback(item_id: int):
    """Delete a feedback item (admin)."""
    success = delete_feedback_item(item_id)
    if not success:
        raise HTTPException(status_code=404, detail="Feedback item not found")
    return {"success": True}


class VoteRequest(BaseModel):
    """Vote request."""
    voter_id: str


@app.post("/api/v1/alpha/feedback/{item_id}/vote")
async def vote_on_feedback(item_id: int, req: VoteRequest):
    """Toggle vote on a feedback item."""
    voted = vote_feedback_item(item_id, req.voter_id)
    return {"voted": voted}


class PollOption(BaseModel):
    """Poll option."""
    id: int
    label: str
    vote_count: int = 0
    submitted_by: Optional[str] = None


class Poll(BaseModel):
    """Poll response."""
    id: int
    question: str
    poll_type: str
    max_selections: Optional[int] = None
    allow_submissions: bool = True
    show_live_results: bool = True
    closes_at: Optional[str] = None
    is_closed: bool = False
    options: List[PollOption] = []
    user_votes: Optional[List[int]] = None
    created_at: str


class PollCreate(BaseModel):
    """Create poll request."""
    question: str
    poll_type: str = "single"
    max_selections: int = 1
    allow_submissions: bool = True
    show_live_results: bool = True
    options: List[str] = []
    closes_at: Optional[str] = None


class PollVoteRequest(BaseModel):
    """Poll vote request."""
    voter_id: str
    option_ids: List[int]


class PollOptionCreate(BaseModel):
    """Add option to poll request."""
    label: str
    submitted_by: Optional[str] = None


@app.get("/api/v1/alpha/polls", response_model=List[Poll])
async def list_polls(voter_id: Optional[str] = None):
    """Get all polls."""
    polls = get_polls(voter_id)
    return [Poll(**p) for p in polls]


@app.post("/api/v1/alpha/polls", response_model=Poll)
async def create_new_poll(req: PollCreate):
    """Create a new poll (admin)."""
    poll = create_poll(
        req.question, req.poll_type, req.max_selections,
        req.allow_submissions, req.show_live_results,
        req.options, req.closes_at
    )
    return Poll(**poll)


@app.post("/api/v1/alpha/polls/{poll_id}/vote")
async def vote_on_poll(poll_id: int, req: PollVoteRequest):
    """Submit votes for a poll."""
    success = vote_poll(poll_id, req.option_ids, req.voter_id)
    return {"success": success}


@app.post("/api/v1/alpha/polls/{poll_id}/options", response_model=PollOption)
async def add_option_to_poll(poll_id: int, req: PollOptionCreate):
    """Add an option to a poll (user submission)."""
    option = add_poll_option(poll_id, req.label, req.submitted_by)
    return PollOption(**option)


@app.delete("/api/v1/alpha/polls/{poll_id}")
async def remove_poll(poll_id: int):
    """Delete a poll (admin)."""
    success = delete_poll(poll_id)
    if not success:
        raise HTTPException(status_code=404, detail="Poll not found")
    return {"success": True}
