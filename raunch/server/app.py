"""FastAPI application factory."""

from fastapi import FastAPI, WebSocket
from fastapi.middleware.cors import CORSMiddleware

from .routes import health, librarians, books, readers, characters, scenarios, pages
from .ws import handle_websocket


def create_app() -> FastAPI:
    """Create and configure the FastAPI application."""
    app = FastAPI(
        title="Living Library API",
        description="Multi-book interactive fiction server",
        version="1.0.0",
    )

    # CORS
    app.add_middleware(
        CORSMiddleware,
        allow_origins=["*"],  # Configure properly for production
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    # Routes
    app.include_router(health.router)
    app.include_router(librarians.router)
    app.include_router(books.router)
    app.include_router(readers.router)
    app.include_router(characters.router)
    app.include_router(scenarios.router)
    app.include_router(pages.router)

    # WebSocket endpoint
    @app.websocket("/ws/{book_id}")
    async def websocket_endpoint(websocket: WebSocket, book_id: str):
        await handle_websocket(websocket, book_id)

    return app
