"""Minimal FastAPI for wizard endpoint. Full API coming from agents."""

import logging
from typing import List, Optional

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from .wizard import generate_scenario, save_scenario, list_scenarios, SETTINGS, KINK_POOLS, VIBES

logger = logging.getLogger(__name__)

app = FastAPI(title="Raunch API", version="0.1.0")

# CORS for frontend
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173", "*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


class WizardRequest(BaseModel):
    setting: Optional[str] = None
    kinks: List[str] = []
    vibe: Optional[str] = None
    preferences: Optional[str] = None
    num_characters: int = 3
    save: bool = True  # Set to false to preview without saving


class WizardResponse(BaseModel):
    scenario_name: str
    setting: str
    premise: str
    themes: List[str]
    opening_situation: str
    characters: list
    saved_to: Optional[str] = None


class OptionsResponse(BaseModel):
    settings: List[str]
    kinks: List[str]
    vibes: List[str]


@app.get("/health")
async def health():
    return {"status": "ok"}


@app.get("/api/v1/wizard/options", response_model=OptionsResponse)
async def get_wizard_options():
    """Get available options for the wizard."""
    return OptionsResponse(
        settings=SETTINGS,
        kinks=KINK_POOLS,
        vibes=VIBES,
    )


@app.post("/api/v1/wizard/generate", response_model=WizardResponse)
async def generate_wizard_scenario(request: WizardRequest):
    """Generate a scenario with the smut wizard, optionally saving it."""
    try:
        scenario = generate_scenario(
            preferences=request.preferences,
            num_characters=request.num_characters,
            kinks=request.kinks if request.kinks else None,
            setting_hint=request.setting,
            vibe=request.vibe,
        )

        saved_path = None
        if request.save:
            saved_path = save_scenario(scenario)
            logger.info(f"Scenario saved to {saved_path}")

        return WizardResponse(
            scenario_name=scenario.get("scenario_name", "Untitled"),
            setting=scenario.get("setting", ""),
            premise=scenario.get("premise", ""),
            themes=scenario.get("themes", []),
            opening_situation=scenario.get("opening_situation", ""),
            characters=scenario.get("characters", []),
            saved_to=saved_path,
        )
    except Exception as e:
        logger.error(f"Wizard generation failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/v1/scenarios")
async def get_scenarios():
    """List saved scenarios."""
    return list_scenarios()


@app.post("/api/v1/scenarios/save")
async def save_scenario_endpoint(scenario: dict):
    """Save a scenario JSON to the scenarios folder."""
    try:
        saved_path = save_scenario(scenario)
        logger.info(f"Scenario saved to {saved_path}")
        return {"saved_to": saved_path}
    except Exception as e:
        logger.error(f"Failed to save scenario: {e}")
        raise HTTPException(status_code=500, detail=str(e))
