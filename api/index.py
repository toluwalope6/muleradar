"""Vercel entrypoint: serves the MuleRadar FastAPI backend under /api using the bundled demo sample."""
import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
os.environ.setdefault("MULERADAR_DATASET", "local")  # never download at runtime
os.environ.setdefault("MULERADAR_DATA_DIR", str(ROOT / "backend" / "demo_data"))
sys.path.insert(0, str(ROOT / "backend"))

from fastapi import FastAPI  # noqa: E402

from main import app as backend_app  # noqa: E402

app = FastAPI(title="MuleRadar (Vercel)")
app.mount("/api", backend_app)
