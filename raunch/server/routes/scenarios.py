"""Scenario and wizard endpoints."""

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import Optional, List

from raunch.wizard import (
    list_scenarios,
    load_scenario,
    delete_scenario,
    random_scenario,
    generate_scenario,
    save_scenario,
    SETTINGS,
    KINK_POOLS,
    VIBES,
)

router = APIRouter(tags=["scenarios"])


class ScenarioSummary(BaseModel):
    file: str
    name: str
    setting: Optional[str] = None
    characters: int = 0
    themes: List[str] = []


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
    kinks: List[str]
    vibes: List[str]


class WizardGenerateRequest(BaseModel):
    setting: Optional[str] = None
    kinks: Optional[List[str]] = None
    vibe: Optional[str] = None
    preferences: Optional[str] = None
    num_characters: int = 3
    save: bool = False


@router.get("/api/v1/scenarios", response_model=List[ScenarioSummary])
async def get_scenarios():
    """List all available scenarios."""
    return list_scenarios()


@router.get("/api/v1/scenarios/{name}", response_model=ScenarioDetail)
async def get_scenario(name: str):
    """Get scenario details."""
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


@router.delete("/api/v1/scenarios/{name}")
async def remove_scenario(name: str):
    """Delete a scenario."""
    # Prevent deleting test scenarios
    if name.startswith("test_"):
        raise HTTPException(status_code=403, detail="Cannot delete test scenarios")

    deleted = delete_scenario(name)
    if not deleted:
        raise HTTPException(status_code=404, detail=f"Scenario '{name}' not found")

    return {"deleted": True, "name": name}


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
