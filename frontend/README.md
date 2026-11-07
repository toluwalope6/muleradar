# MuleRadar frontend

Desktop investigation dashboard built with React, TypeScript, Vite and Cytoscape.js.

> **Demo: synthetic data.** Every account, transaction and amount in `src/data/mockData.ts` is fictional.
> Flags are indicators for review, not proof of wrongdoing. No AI service is connected. Explanations and draft
> reports are built from fixed templates using only the selected case's data.

## Run

```bash
cd frontend
npm install
npm run dev        # http://localhost:5173
npm run build      # type-check + production build
```

## Data access

The UI only calls the functions in `src/data/api.ts` (`listCases`, `getCase`, `generateDraftReport`). Right now they
return mock data. To connect the backend, replace those function bodies with `fetch` calls and map the responses
onto the types in `src/data/types.ts`.

Those types are **provisional frontend types**, not an agreed backend contract.

### Demo states

To show the loading, empty and error states, add a query parameter to the URL:

| URL | State |
|---|---|
| `/?mock=empty` | No flagged networks |
| `/?mock=error` | Case list fails to load |
| `/?mock=case-error` | Selected case fails to load |
| `/?mock=report-error` | Draft report generation fails |

## Mock cases

| Case | Pattern | Sample score |
|---|---|---|
| C-002 | Rapid fan-in (6 senders) and fan-out (3 recipients) through a newly opened account, with near-threshold amounts | 90 |
| C-001 | Four-account circular loop with rapid pass-through | 65 |
| C-003 | Single inflow split across five accounts within 1.5 hours | 50 |
| C-004 | Three-account circular transfers over about 3 days | 40 |

Scores come from transparent sample weights in `mockData.ts`. They are not model outputs, and no precision or
recall figures are shown.

## Live backend vs synthetic demo

- **Live (default):** start the backend (`./backend/run.sh`, API on `http://127.0.0.1:8000`), then `npm run dev`.
  The Vite dev/preview server proxies `/api/*` to the backend (`MULERADAR_API_URL` overrides the target), so no CORS setup is needed in the browser.
- **Synthetic demo:** open `?source=mock` (or set `VITE_DATA_SOURCE=mock`). The header shows which source is active, with a link to switch.
- Live failures are shown as errors; the app never falls back to mock data. See `.env.example` for settings. No credentials are used by the frontend.
