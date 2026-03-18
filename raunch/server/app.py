"""FastAPI application factory."""

import asyncio
import logging
import os
import traceback

import httpx
from fastapi import FastAPI, Request, WebSocket
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from .routes import health, librarians, books, readers, characters, scenarios, pages, alpha, auth
from ..oauth import router as oauth_router
from .ws import handle_websocket

logger = logging.getLogger(__name__)

SELF_PING_INTERVAL = 14 * 60  # 14 minutes


_last_ping: dict = {"time": None, "status": None}


async def _keep_alive():
    """Ping own health endpoint to prevent Render free-tier sleep."""
    url = os.environ.get("RENDER_EXTERNAL_URL")
    if not url:
        logger.info("RENDER_EXTERNAL_URL not set — self-ping disabled")
        return
    ping_url = f"{url}/health"
    logger.info(f"Self-ping enabled: {ping_url} every {SELF_PING_INTERVAL}s")
    async with httpx.AsyncClient() as client:
        while True:
            await asyncio.sleep(SELF_PING_INTERVAL)
            try:
                r = await client.get(ping_url, timeout=10)
                from datetime import datetime, timezone
                _last_ping["time"] = datetime.now(timezone.utc).isoformat()
                _last_ping["status"] = r.status_code
                logger.info(f"🏓 Self-ping: {r.status_code}")
            except Exception as e:
                _last_ping["time"] = None
                _last_ping["status"] = f"failed: {e}"
                logger.warning(f"Self-ping failed: {e}")


def create_app() -> FastAPI:
    """Create and configure the FastAPI application."""
    app = FastAPI(
        title="Living Library API",
        description="Multi-book interactive fiction server",
        version="1.0.0",
    )

    @app.on_event("startup")
    async def on_startup():
        # Ensure our logger is visible
        logging.basicConfig(level=logging.INFO)
        # Startup health checks
        from ..config import DB_BACKEND
        logger.info(f"╔══════════════════════════════════════╗")
        logger.info(f"║  Living Library — starting up...     ║")
        logger.info(f"╚══════════════════════════════════════╝")
        logger.info(f"  DB backend: {DB_BACKEND}")

        # Init DB and verify connectivity
        try:
            from .. import db
            db.init_db()
            logger.info(f"  ✓ Database OK")
        except Exception as e:
            logger.error(f"  ✗ Database FAILED: {e}")

        # Check for LLM credentials
        llm_ok = False
        try:
            from ..auth_db import get_active_token
            token = get_active_token()
            if token:
                logger.info(f"  ✓ LLM token: active (OAuth)")
                llm_ok = True
        except Exception:
            pass
        if not llm_ok:
            api_key = os.environ.get("ANTHROPIC_API_KEY")
            if api_key:
                logger.info(f"  ✓ LLM token: ANTHROPIC_API_KEY set")
            else:
                oauth_token = os.environ.get("CLAUDE_CODE_OAUTH_TOKEN")
                if oauth_token:
                    logger.info(f"  ✓ LLM token: CLAUDE_CODE_OAUTH_TOKEN set")
                else:
                    logger.warning(f"  ✗ No LLM credentials found — page generation will fail")

        # Check scenarios
        try:
            from ..wizard import list_scenarios
            file_scenarios = list_scenarios()
            logger.info(f"  ✓ Scenarios: {len(file_scenarios)} file-based")
        except Exception as e:
            logger.warning(f"  ✗ Scenarios: {e}")

        logger.info(f"  Ready!")

        # Start keep-alive ping
        asyncio.create_task(_keep_alive())

    # CORS — allow_credentials=True is incompatible with allow_origins=["*"]
    # so we use allow_origin_regex to match everything instead
    app.add_middleware(
        CORSMiddleware,
        allow_origin_regex=r".*",
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    # Catch-all exception handler — ensures 500s return JSON (with CORS headers)
    @app.exception_handler(Exception)
    async def unhandled_exception_handler(request: Request, exc: Exception):
        tb = traceback.format_exception(type(exc), exc, exc.__traceback__)
        logger.error(f"Unhandled exception on {request.method} {request.url}:\n{''.join(tb)}")
        return JSONResponse(
            status_code=500,
            content={"detail": str(exc), "type": type(exc).__name__},
        )

    # Routes
    app.include_router(health.router)
    app.include_router(librarians.router)
    app.include_router(books.router)
    app.include_router(books.compat_router)  # Backwards compatibility for /api/v1/world
    app.include_router(readers.router)
    app.include_router(characters.router)
    app.include_router(characters.global_router)  # Backwards compatibility for /api/v1/potential-characters
    app.include_router(scenarios.router)
    app.include_router(pages.router)
    app.include_router(alpha.router)
    app.include_router(auth.router)
    app.include_router(oauth_router)

    # WebSocket endpoint
    @app.websocket("/ws/{book_id}")
    async def websocket_endpoint(websocket: WebSocket, book_id: str):
        await handle_websocket(websocket, book_id)

    return app
