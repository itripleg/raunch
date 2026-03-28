"""Scenario and wizard endpoints."""

from fastapi import APIRouter, HTTPException, Header, Depends
from pydantic import BaseModel
from typing import Optional, List, Dict, Any

from raunch.wizard import (
    list_scenarios,
    load_scenario,
    delete_scenario,
    random_scenario,
    generate_scenario,
    save_scenario,
    SETTINGS,
    PAIRINGS,
    KINK_POOLS,
    VIBES,
)
from raunch import db

router = APIRouter(tags=["scenarios"])


def get_librarian_id(x_librarian_id: str = Header(..., alias="X-Librarian-ID")) -> str:
    """Extract and validate librarian ID from header."""
    librarian = db.get_librarian(x_librarian_id)
    if librarian is None:
        raise HTTPException(status_code=401, detail="Invalid librarian ID")
    return x_librarian_id


class ScenarioSummary(BaseModel):
    file: Optional[str] = None  # For file-based scenarios
    id: Optional[str] = None  # For DB scenarios
    name: str
    setting: Optional[str] = None
    characters: int = 0
    themes: List[str] = []
    source: str  # "file" or "db"
    public: Optional[bool] = None  # Only for DB scenarios
    owner_id: Optional[str] = None  # Only for DB scenarios


class CharacterDetail(BaseModel):
    name: str
    species: Optional[str] = None
    personality: Optional[str] = None
    appearance: Optional[str] = None
    desires: Optional[str] = None
    backstory: Optional[str] = None
    kinks: Optional[str] = None


class ScenarioDetail(BaseModel):
    scenario_name: str
    setting: Optional[str] = None
    premise: Optional[str] = None
    themes: List[str] = []
    opening_situation: Optional[str] = None
    characters: List[CharacterDetail] = []
    multiplayer: bool = False


class WizardOptions(BaseModel):
    settings: List[str]
    pairings: List[str]
    kinks: List[str]
    vibes: List[str]


class WizardGenerateRequest(BaseModel):
    setting: Optional[str] = None
    pairings: Optional[List[str]] = None
    kinks: Optional[List[str]] = None
    vibe: Optional[str] = None
    preferences: Optional[str] = None
    num_characters: int = 2
    save: bool = False


class CreateScenarioRequest(BaseModel):
    name: str
    description: Optional[str] = None
    setting: Optional[str] = None
    data: Dict[str, Any]  # Full scenario JSON
    public: bool = False


class UpdateScenarioRequest(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    setting: Optional[str] = None
    data: Optional[Dict[str, Any]] = None
    public: Optional[bool] = None


class ScenarioResponse(BaseModel):
    id: str
    owner_id: str
    name: str
    description: Optional[str] = None
    setting: Optional[str] = None
    data: Dict[str, Any]
    public: bool
    created_at: str


@router.get("/api/v1/scenarios", response_model=List[ScenarioSummary])
async def get_scenarios():
    """List all available scenarios (both file-based and public DB scenarios)."""
    results = []

    # Add file-based scenarios (filter out DB scenarios which are handled below)
    for scenario in list_scenarios():
        if scenario.get("source") != "file":
            continue
        results.append(ScenarioSummary(
            file=scenario.get("file"),
            name=scenario["name"],
            setting=scenario.get("setting"),
            characters=scenario.get("characters", 0),
            themes=scenario.get("themes", []),
            source="file"
        ))

    # Add public DB scenarios
    for scenario in db.list_public_scenarios():
        data = scenario["data"]
        results.append(ScenarioSummary(
            id=scenario["id"],
            name=scenario["name"],
            setting=scenario.get("setting"),
            characters=len(data.get("characters", [])),
            themes=data.get("themes", []),
            source="db",
            public=scenario["public"],
            owner_id=scenario["owner_id"]
        ))

    return results


@router.get("/api/v1/scenarios/mine", response_model=List[ScenarioResponse])
async def get_my_scenarios(librarian_id: str = Depends(get_librarian_id)):
    """List the current user's own scenarios (requires auth)."""
    scenarios = db.list_scenarios_for_librarian(librarian_id)
    return [ScenarioResponse(**s) for s in scenarios]


@router.post("/api/v1/scenarios/roll", response_model=ScenarioDetail)
async def roll_scenario():
    """Generate a random scenario."""
    scenario = random_scenario()
    return ScenarioDetail(
        scenario_name=scenario.get("scenario_name", "Random"),
        setting=scenario.get("setting"),
        premise=scenario.get("premise"),
        themes=scenario.get("themes", []),
        opening_situation=scenario.get("opening_situation"),
        characters=[
            CharacterDetail(**c) for c in scenario.get("characters", [])
        ],
    )


@router.get("/api/v1/wizard/options", response_model=WizardOptions)
async def get_wizard_options():
    """Get available options for the Smut Wizard."""
    return WizardOptions(
        settings=SETTINGS,
        pairings=PAIRINGS,
        kinks=KINK_POOLS,
        vibes=VIBES,
    )


@router.post("/api/v1/wizard/generate", response_model=ScenarioDetail)
async def wizard_generate(request: WizardGenerateRequest):
    """Generate a scenario with the Smut Wizard."""
    try:
        scenario = generate_scenario(
            preferences=request.preferences,
            num_characters=request.num_characters,
            pairings=request.pairings,
            kinks=request.kinks,
            setting_hint=request.setting,
            vibe=request.vibe,
        )
        if request.save:
            save_scenario(scenario)

        return ScenarioDetail(
            scenario_name=scenario.get("scenario_name", "Generated"),
            setting=scenario.get("setting"),
            premise=scenario.get("premise"),
            themes=scenario.get("themes", []),
            opening_situation=scenario.get("opening_situation"),
            characters=[
                CharacterDetail(**c) for c in scenario.get("characters", [])
            ],
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.delete("/api/v1/scenarios/file/{name}")
async def remove_file_scenario(name: str):
    """Delete a file-based scenario."""
    # Prevent deleting test scenarios
    if name.startswith("test_"):
        raise HTTPException(status_code=403, detail="Cannot delete test scenarios")

    deleted = delete_scenario(name)
    if not deleted:
        raise HTTPException(status_code=404, detail=f"Scenario '{name}' not found")

    return {"deleted": True, "name": name}


@router.post("/api/v1/scenarios", status_code=201, response_model=ScenarioResponse)
async def create_user_scenario(
    request: CreateScenarioRequest,
    librarian_id: str = Depends(get_librarian_id),
):
    """Create a user scenario in the database (requires librarian auth)."""
    try:
        scenario = db.create_scenario(
            owner_id=librarian_id,
            name=request.name,
            description=request.description,
            setting=request.setting,
            data=request.data,
            public=request.public,
        )
        return ScenarioResponse(**scenario)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.put("/api/v1/scenarios/{scenario_id}", response_model=ScenarioResponse)
async def update_user_scenario(
    scenario_id: str,
    request: UpdateScenarioRequest,
    librarian_id: str = Depends(get_librarian_id),
):
    """Update a user's own scenario (auth required, must own)."""
    # Check if scenario exists and user owns it
    scenario = db.get_scenario(scenario_id)
    if not scenario:
        raise HTTPException(status_code=404, detail="Scenario not found")

    if scenario["owner_id"] != librarian_id:
        raise HTTPException(status_code=403, detail="You do not own this scenario")

    # Update the scenario
    updated = db.update_scenario(
        scenario_id=scenario_id,
        name=request.name,
        description=request.description,
        setting=request.setting,
        data=request.data,
        public=request.public,
    )

    if not updated:
        raise HTTPException(status_code=500, detail="Failed to update scenario")

    # Return updated scenario
    scenario = db.get_scenario(scenario_id)
    return ScenarioResponse(**scenario)


@router.delete("/api/v1/scenarios/{scenario_id}")
async def delete_user_scenario(
    scenario_id: str,
    librarian_id: str = Depends(get_librarian_id),
):
    """Delete a user's own scenario (auth required, must own)."""
    # Check if scenario exists and user owns it
    scenario = db.get_scenario(scenario_id)
    if not scenario:
        raise HTTPException(status_code=404, detail="Scenario not found")

    if scenario["owner_id"] != librarian_id:
        raise HTTPException(status_code=403, detail="You do not own this scenario")

    # Delete the scenario
    deleted = db.delete_scenario(scenario_id)
    if not deleted:
        raise HTTPException(status_code=500, detail="Failed to delete scenario")

    return {"deleted": True, "id": scenario_id}


class ScenarioSaveResponse(BaseModel):
    saved_to: str


@router.post("/api/v1/scenarios/save", response_model=ScenarioSaveResponse)
async def save_scenario_endpoint(scenario: ScenarioDetail):
    """Save a generated scenario to disk."""
    try:
        scenario_dict = {
            "scenario_name": scenario.scenario_name,
            "setting": scenario.setting,
            "premise": scenario.premise,
            "themes": scenario.themes,
            "opening_situation": scenario.opening_situation,
            "characters": [c.model_dump() for c in scenario.characters],
            "multiplayer": scenario.multiplayer,
        }
        path = save_scenario(scenario_dict)
        return ScenarioSaveResponse(saved_to=path)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/api/v1/scenarios/{name}", response_model=ScenarioDetail)
async def get_scenario(name: str):
    """Get scenario details by filename (for file-based scenarios)."""
    scenario = load_scenario(name)
    if not scenario:
        raise HTTPException(status_code=404, detail=f"Scenario '{name}' not found")

    return ScenarioDetail(
        scenario_name=scenario.get("scenario_name", name),
        setting=scenario.get("setting"),
        premise=scenario.get("premise"),
        themes=scenario.get("themes", []),
        opening_situation=scenario.get("opening_situation"),
        characters=[
            CharacterDetail(**c) for c in scenario.get("characters", [])
        ],
        multiplayer=scenario.get("multiplayer", False),
    )
