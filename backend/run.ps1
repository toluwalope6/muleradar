# One-command setup + start for Windows PowerShell:
#   powershell -ExecutionPolicy Bypass -File backend\run.ps1
# Creates the venv, installs deps, downloads the IBM AML data on first run (or falls back to
# synthetic data), then serves the API on http://localhost:8000
$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot
if (-not (Test-Path .venv)) {
    Write-Host "[setup] Creating virtual environment..."
    python -m venv .venv
}
$py = Join-Path $PSScriptRoot ".venv\Scripts\python.exe"
Write-Host "[setup] Installing dependencies..."
& $py -m pip install --quiet --disable-pip-version-check -r requirements.txt
if (-not (Test-Path .env)) { Copy-Item .env.example .env }
& $py top_cases.py
# Free port 8000 if an older backend is still running (e.g. in another window)
Get-NetTCPConnection -LocalPort 8000 -State Listen -ErrorAction SilentlyContinue |
    ForEach-Object { Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue }
& $py -m uvicorn main:app --host 127.0.0.1 --port 8000
