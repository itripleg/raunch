"""FastAPI REST API for raunch multiplayer endpoints."""

import logging

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

logger = logging.getLogger(__name__)

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
