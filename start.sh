#\!/bin/sh
exec uvicorn raunch.server.app:create_app --factory --host 0.0.0.0 --port ${PORT:-8000}
