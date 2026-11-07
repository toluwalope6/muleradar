#!/usr/bin/env bash
# One-command setup + start for macOS/Linux:  ./backend/run.sh
# Creates the venv, installs deps, downloads the IBM AML data on first run (or falls back to
# synthetic data), then serves the API on http://localhost:8000
set -euo pipefail
cd "$(dirname "$0")"
PY=${PYTHON:-python3}
[ -d .venv ] || { echo "[setup] Creating virtual environment..."; "$PY" -m venv .venv; }
echo "[setup] Installing dependencies..."
.venv/bin/python -m pip install --quiet --disable-pip-version-check -r requirements.txt
[ -f .env ] || cp .env.example .env
.venv/bin/python top_cases.py
exec .venv/bin/python -m uvicorn main:app --host 127.0.0.1 --port 8000
