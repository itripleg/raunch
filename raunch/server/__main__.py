"""Run the Living Library server: python -m raunch.server"""

import uvicorn
from .app import create_app

app = create_app()
uvicorn.run(app, host="0.0.0.0", port=8000)
