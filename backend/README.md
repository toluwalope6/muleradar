# MuleRadar backend

> Criminals hide money in thousands of transactions. MuleRadar reverse-engineers the scheme.

FastAPI + pandas + NetworkX. Loads transactions, builds a money-flow graph, runs laundering detectors,
groups flagged accounts into **cases**, reconstructs each scheme (type, roles, ordered timeline) and scores
itself against ground truth.

## Run

```bash
cd backend
python3.11 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env            # optional: add OPENAI_API_KEY or ANTHROPIC_API_KEY

python data.py --force          # (optional) rebuild ../data/sample.parquet
python top_cases.py             # print top 10 cases + metrics
uvicorn main:app --reload       # API on http://localhost:8000 (docs at /docs)
```

The first startup builds the dataset and runs detection (a few seconds on synthetic data); results are cached
in memory so every request is fast. Delete `../data/sample.parquet` (or run `python data.py --force`) to rebuild.

## Data (`data.py`)

Data lives in `../data` (override with `MULERADAR_DATA_DIR`).

- **IBM AML dataset**: if `data/HI-Small_Trans.csv` exists, a ~50k-row sample is built with *all*
  `Is Laundering = 1` rows plus random normal rows. Accounts are `"<bank>_<account>"`. If
  `data/HI-Small_Patterns.txt` exists it's parsed into ground-truth schemes.
- **Synthetic fallback**: 2,000 accounts, ~40k normal transactions over 30 days (plus legitimate payroll and
  rent-collection bursts as realistic false-positive bait) and 15 injected schemes: CYCLE, FAN-IN, FAN-OUT,
  SCATTER-GATHER, GATHER-SCATTER, STACK. Ground truth goes to `data/ground_truth.json`.

Output schema (`data/sample.parquet`): `tx_id, timestamp, from_account, to_account, amount, currency, is_laundering`.

## Detection (`detect.py`)

| Detector | Rule |
|---|---|
| cycle | `nx.simple_cycles(length_bound=6)` on 72h sliding windows, length 3-6, hops must be time-ordered and keep 80-105% of the previous amount |
| fan-in / fan-out | 5+ distinct counterparties within 24h moving at least 5,000 |
| pass-through | inflow of at least 5,000 with 80-105% sent on within 48h |

Hits that share a flagged account or an evidence transaction are merged into a case. Each case gets:
- a **risk score** (0-100) built from the detectors that fired, the amount, structuring (8-10k transfers) and speed
- a **scheme type** from the graph shape (cycle, sources, sinks, intermediaries, longest path)
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
