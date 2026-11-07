"""Vercel entrypoint: serves the MuleRadar FastAPI backend under /api using the bundled demo sample."""
import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
os.environ.setdefault("MULERADAR_DATASET", "local")  # never download at runtime
os.environ.setdefault("MULERADAR_DATA_DIR", str(ROOT / "backend" / "demo_data"))
sys.path.insert(0, str(ROOT / "backend"))

import re  # noqa: E402

from fastapi import FastAPI, Request  # noqa: E402
from fastapi.responses import JSONResponse  # noqa: E402

from main import app as backend_app  # noqa: E402

# Only the endpoints the dashboard uses are public; /ask (which can call a paid AI provider) and the rest are not.
# request.url.path is already percent-decoded, so an encoded slash can't slip past these patterns.
PUBLIC_PATHS = [re.compile(p) for p in (r"^/api/metrics/?$", r"^/api/cases/?$", r"^/api/cases/[^/]+/?$",
                                        r"^/api/cases/[^/]+/report/?$")]

app = FastAPI(title="MuleRadar (Vercel)", docs_url=None, redoc_url=None, openapi_url=None)


@app.middleware("http")
async def only_dashboard_endpoints(request: Request, call_next):
    if not any(p.match(request.url.path) for p in PUBLIC_PATHS):
        return JSONResponse({"detail": "Not found"}, status_code=404)
    return await call_next(request)


app.mount("/api", backend_app)
