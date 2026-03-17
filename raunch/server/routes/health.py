"""Health check and introspection endpoints."""

import logging

from fastapi import APIRouter, Request

router = APIRouter()

# Suppress health check request logs — they're too noisy
logging.getLogger("uvicorn.access").addFilter(
    type("HealthFilter", (), {"filter": staticmethod(lambda r: "/health" not in r.getMessage())})()
)

# Server identification
SERVER_TYPE = "raunch"
SERVER_VERSION = "1.0.0"


@router.get("/health")
async def health_check():
    """Health check endpoint with server identification."""
    from ..app import _last_ping
    result = {
        "status": "ok",
        "server": SERVER_TYPE,
        "version": SERVER_VERSION,
    }
    if _last_ping.get("time"):
        result["last_ping"] = _last_ping["time"]
        result["ping_status"] = _last_ping["status"]
    return result


@router.get("/api/v1/routes")
async def list_routes(request: Request):
    """List all registered API routes for debug/introspection."""
    routes = []
    for route in request.app.routes:
        if hasattr(route, "methods") and hasattr(route, "path"):
            for method in route.methods:
                if method in ("GET", "POST", "PUT", "DELETE", "PATCH"):
                    routes.append({
                        "method": method,
                        "path": route.path,
                        "name": getattr(route, "name", None),
                    })
    # Sort by path then method
    routes.sort(key=lambda r: (r["path"], r["method"]))
    return {"routes": routes}


@router.get("/api/v1/ws/commands")
async def list_ws_commands():
    """List available WebSocket commands with descriptions and param hints."""
    return {"commands": [
        {"cmd": "join", "desc": "Join the book as a reader", "params": {"nickname": "string"}},
        {"cmd": "attach", "desc": "Attach to a character's POV", "params": {"character": "string"}},
        {"cmd": "detach", "desc": "Detach from current character"},
        {"cmd": "world", "desc": "Get current world state"},
        {"cmd": "list", "desc": "List all characters"},
        {"cmd": "status", "desc": "Get orchestrator status"},
        {"cmd": "history", "desc": "Get page history", "params": {"count": "int", "offset": "int?"}},
        {"cmd": "page", "desc": "Trigger next page (manual mode)"},
        {"cmd": "toggle_pause", "desc": "Toggle pause/resume"},
        {"cmd": "pause", "desc": "Pause page generation"},
        {"cmd": "resume", "desc": "Resume page generation"},
        {"cmd": "set_page_interval", "desc": "Set auto-page interval", "params": {"seconds": "int"}},
        {"cmd": "get_page_interval", "desc": "Get current page interval"},
        {"cmd": "action", "desc": "Submit player action", "params": {"text": "string"}},
        {"cmd": "whisper", "desc": "Whisper to a character", "params": {"character": "string", "text": "string"}},
        {"cmd": "director", "desc": "Send director guidance", "params": {"text": "string"}},
        {"cmd": "ready", "desc": "Signal ready for next page (multiplayer)"},
        {"cmd": "debug", "desc": "Get debug data", "params": {"limit": "int?", "include_raw": "bool?"}},
        {"cmd": "character_history", "desc": "Get a character's history", "params": {"character": "string", "count": "int?"}},
        {"cmd": "replay", "desc": "Replay a specific page", "params": {"page": "int"}},
    ]}
