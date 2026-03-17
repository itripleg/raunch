"""FastAPI application factory."""

import asyncio
import logging
import os

import httpx
from fastapi import FastAPI, WebSocket
from fastapi.middleware.cors import CORSMiddleware

from .routes import health, librarians, books, readers, characters, scenarios, pages, alpha, auth
from ..oauth import router as oauth_router
from .ws import handle_websocket

logger = logging.getLogger(__name__)

SELF_PING_INTERVAL = 14 * 60  # 14 minutes


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
                logger.debug(f"Self-ping: {r.status_code}")
            except Exception as e:
                logger.warning(f"Self-ping failed: {e}")


def create_app() -> FastAPI:
    """Create and configure the FastAPI application."""
    app = FastAPI(
        title="Living Library API",
        description="Multi-book interactive fiction server",
        version="1.0.0",
    )

    @app.on_event("startup")
    async def start_keep_alive():
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
