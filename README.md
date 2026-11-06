# muleradar
A fraud investigation dashboard that detects suspicious transaction networks, visualises money flows, and drafts evidence-based reports.
# MuleRadar

MuleRadar is a hackathon prototype for investigating suspicious networks in synthetic banking transactions.

It identifies transaction patterns, displays account networks, explains the evidence and generates investigation report drafts.

Built for Cognition Builder Day — 7 November 2026.

## Demo workflow

1. View a ranked list of suspicious cases.
2. Select a case to inspect its account network.
3. Click accounts and transactions to explore the evidence.
4. Ask the AI analyst why the case was flagged.
5. Generate an investigation report draft.
6. Show precision and recall measured on the evaluation sample.

## Planned stack

- Frontend: React, Vite and Cytoscape.js
- Backend: Python and FastAPI
- Data processing: pandas
- Graph analysis: NetworkX
- AI explanations: LLM API configured through environment variables

## Repository structure

- backend/ — data preparation, detection and API
- frontend/ — dashboard, graph and analyst interface
- data/ — documentation and approved small sample
- docs/ — shared API contract and project notes

## Team ownership

- Jonathan: data preparation, detection engine and backend API
- Tolulope: frontend, integration and demo
- Both: review pull requests and test the complete workflow

## Planned API

- GET /cases
- GET /cases/{id}
- GET /metrics
- POST /cases/{id}/ask
- POST /cases/{id}/report

Agree on JSON response formats in docs/api-contract.md before implementing frontend and backend independently.

## Data


## Development workflow

1. Create a separate branch for each task.
2. Keep changes within the task's scope.
3. Open a pull request to main.
4. Review and test the changes.
5. Merge working changes.
6. Pull the latest main before starting the next task.

## Configuration

.env.example documents the planned environment variables.Real API keys belong in a local .env file or the agent's secret settings.

Never commit API keys.

## Prototype limitations

Flags indicate suspicious patterns, not confirmed money laundering.
Generated reports are drafts requiring investigator review.
Sample-level metrics do not establish real-world banking performance.

## Setup status

This repository currently contains the project structure and plan. Application installation and run commands will be added as the frontend and backend are implemented.
