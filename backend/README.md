# MuleRadar backend

> Criminals hide money in thousands of transactions. MuleRadar reverse-engineers the scheme.

FastAPI + pandas + NetworkX. Loads transactions, builds a money-flow graph, runs laundering detectors,
groups flagged accounts into **cases**, reconstructs each scheme (type, roles, ordered timeline) and scores
itself against ground truth.

## Run

**One command** (creates the venv, installs deps, downloads the data on first run, starts the API):

```powershell
powershell -ExecutionPolicy Bypass -File backend\run.ps1     # Windows
```
```bash
./backend/run.sh                                              # macOS / Linux
```

Manual equivalent:

```bash
cd backend
python3.11 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env            # optional: add OPENAI_API_KEY or ANTHROPIC_API_KEY

python data.py --force          # (optional) rebuild ../data/sample.parquet
python top_cases.py             # print top 10 cases + metrics
uvicorn main:app --reload       # API on http://localhost:8000 (docs at /docs)
```

The first run downloads the IBM HI-Small files (~450MB, public, no Kaggle login) and builds a ~45k-row
sample (~1 min); after that `../data/sample.parquet` is reused and startup takes ~10s. Run
`python data.py --force` to rebuild.

## Data (`data.py`)

Data lives in `../data` (override with `MULERADAR_DATA_DIR`). `MULERADAR_DATASET` picks the source:

| value | behaviour |
|---|---|
| `ibm` (default) | use `data/HI-Small_Trans.csv`; download it from Kaggle via `kagglehub` if missing; synthetic if that fails |
| `local` | use the IBM CSV only if it is already in `data/`, never download |
| `synthetic` | always generate synthetic data |

- **IBM AML dataset**: a ~50k-row sample with *all* `Is Laundering = 1` rows plus random normal rows.
  Accounts are `"<bank>_<account>"`. Amounts are converted to USD with exchange rates inferred from the
  dataset's own cross-currency transfers (IBM amounts are in the payer's currency, which otherwise breaks
  amount-matching). `HI-Small_Patterns.txt` is parsed into ground-truth schemes.
- **Synthetic fallback**: 2,000 accounts, ~40k normal transactions over 30 days (plus legitimate payroll and
  rent-collection bursts as realistic false-positive bait) and 15 injected schemes: CYCLE, FAN-IN, FAN-OUT,
  SCATTER-GATHER, GATHER-SCATTER, STACK. Ground truth goes to `data/ground_truth.json`.

Output schema (`data/sample.parquet`): `tx_id, timestamp, from_account, to_account, amount, currency, is_laundering`.

## Detection (`detect.py`)

| Detector | Rule |
|---|---|
| cycle | `nx.simple_cycles(length_bound=6)` on 96h sliding windows, length 3-6, hops must be time-ordered and keep 80-105% of the previous amount |
| fan-in / fan-out | 5+ distinct counterparties within 24h moving at least 5,000 |
| pass-through | inflow of at least 5,000 with 80-105% sent on within 48h |

Hits that share a flagged account or an evidence transaction are merged into a case. Each case gets:
- a **risk score** (0-100) built from the detectors that fired, the amount, structuring (8-10k transfers) and speed
- **context enrichment**: transfers between case accounts and with counterparties shared by 2+ case accounts (closes cycles, finds the scatter source)
- a **scheme type** from the graph shape (loops, fan-in/fan-out hubs and their order, longest path)
- **roles** (source / mule / destination) and an ordered **timeline** with one-line descriptions
- a **ground-truth match** by account Jaccard (counts as found when it's at least 0.3)

Metrics: transaction-level precision/recall against `is_laundering`, `schemes_found / schemes_total`, and
`scheme_type_accuracy` over the found schemes.

## API (`main.py`)

CORS is enabled for `http://localhost:5173`.

| Method | Path | Response |
|---|---|---|
| GET | `/cases` | `[{id, risk_score, scheme_type, account_count, total_amount, duration_hours, summary}]` (risk desc) |
| GET | `/cases/{id}` | `{id, risk_score, scheme_type, summary, nodes, edges, timeline, ground_truth, match_score, type_correct}` |
| GET | `/metrics` | `{precision, recall, schemes_found, schemes_total, scheme_type_accuracy}` |
| POST | `/cases/{id}/ask` | body `{question}` returns `{answer}` |
| POST | `/cases/{id}/report` | `{report}` (markdown SAR draft) |

`/ask` and `/report` call OpenAI or Anthropic (whichever key is in `.env`) with the case JSON as context.
If there's no key, or the call fails, they return a templated answer/report built from the case data.

```bash
curl localhost:8000/cases
curl localhost:8000/cases/C001
curl localhost:8000/metrics
curl -X POST localhost:8000/cases/C001/ask -H 'content-type: application/json' -d '{"question":"Why is this suspicious?"}'
curl -X POST localhost:8000/cases/C001/report
```
