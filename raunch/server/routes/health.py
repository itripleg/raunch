"""Health check endpoint."""

from fastapi import APIRouter

router = APIRouter()

# Server identification
SERVER_TYPE = "raunch"
SERVER_VERSION = "1.0.0"


@router.get("/health")
async def health_check():
    """Health check endpoint with server identification."""
    return {
        "status": "ok",
        "server": SERVER_TYPE,
        "version": SERVER_VERSION,
    }
