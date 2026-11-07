"""Data loading: IBM AML dataset sample if present, otherwise a synthetic generator.

Output is always normalised to:
    tx_id, timestamp, from_account, to_account, amount, currency, is_laundering
and saved to <DATA_DIR>/sample.parquet. Ground-truth schemes go to <DATA_DIR>/ground_truth.json.
"""
from __future__ import annotations

import json
import os
import re
from collections import defaultdict
from pathlib import Path

import numpy as np
import pandas as pd
from dotenv import load_dotenv

load_dotenv(Path(__file__).resolve().parent / ".env")

REPO_ROOT = Path(__file__).resolve().parent.parent
DATA_DIR = Path(os.getenv("MULERADAR_DATA_DIR", REPO_ROOT / "data"))

# ibm (default): use/download the IBM HI-Small dataset, falling back to synthetic if unavailable
# local: use the IBM CSV only if it is already in data/;  synthetic: always generate synthetic data
DATASET = os.getenv("MULERADAR_DATASET", "ibm").lower()
IBM_TRANS = "HI-Small_Trans.csv"
IBM_PATTERNS = "HI-Small_Patterns.txt"
SAMPLE_FILE = "sample.parquet"
GROUND_TRUTH_FILE = "ground_truth.json"

COLUMNS = ["tx_id", "timestamp", "from_account", "to_account", "amount", "currency", "is_laundering"]
SCHEME_TYPES = ["CYCLE", "FAN-IN", "FAN-OUT", "SCATTER-GATHER", "GATHER-SCATTER", "STACK"]
SAMPLE_SIZE = 50_000


# --------------------------------------------------------------------------- IBM dataset

def _ibm_account(bank, account) -> str:
    return f"{str(bank).strip()}_{str(account).strip()}"


KAGGLE_DATASET = "ealtman2019/ibm-transactions-for-anti-money-laundering-aml"
# Fallback USD rates if the CSV has too few cross-currency rows to infer them
FX_FALLBACK = {
    "US Dollar": 1.0, "Euro": 1.17, "UK Pound": 1.29, "Swiss Franc": 1.09, "Yuan": 0.149, "Yen": 0.0095,
    "Rupee": 0.0136, "Ruble": 0.0129, "Canadian Dollar": 0.758, "Australian Dollar": 0.708,
    "Mexican Peso": 0.0473, "Brazil Real": 0.177, "Shekel": 0.296, "Saudi Riyal": 0.267, "Bitcoin": 11_880.0,
}


def download_ibm(data_dir: Path) -> bool:
    """Fetch HI-Small_Trans.csv + HI-Small_Patterns.txt from Kaggle (public, no login needed)."""
    try:
        import shutil
        import kagglehub
    except ImportError:
        print("[data] kagglehub not installed, skipping IBM download")
        return False
    try:
        for name in (IBM_PATTERNS, IBM_TRANS):
            print(f"[data] Downloading {name} from Kaggle ({KAGGLE_DATASET})...")
            src = kagglehub.dataset_download(KAGGLE_DATASET, path=name)
            shutil.copyfile(src, data_dir / name)
        return True
    except Exception as exc:  # offline, Kaggle down, rate limited...
        print(f"[data] IBM download failed ({exc.__class__.__name__}: {exc})")
        (data_dir / IBM_TRANS).unlink(missing_ok=True)
        return False


def load_ibm(data_dir: Path, sample_size: int = SAMPLE_SIZE, seed: int = 42) -> tuple[pd.DataFrame, dict]:
    """Keep every laundering row plus a uniform random sample of normal rows (bottom-k over chunks).

    IBM amounts are in the payer's currency, so everything is converted to USD using rates
    inferred from the dataset's own cross-currency transfers.
    """
    rng = np.random.default_rng(seed)
    laundering, normal, fx_rows = [], pd.DataFrame(), []
    for chunk in pd.read_csv(data_dir / IBM_TRANS, dtype=str, chunksize=500_000):
        # Columns: Timestamp, From Bank, Account, To Bank, Account.1, Amount Received,
        # Receiving Currency, Amount Paid, Payment Currency, Payment Format, Is Laundering
        cross = chunk[(chunk["Receiving Currency"] == "US Dollar") & (chunk["Payment Currency"] != "US Dollar")]
        fx_rows.append(cross[["Payment Currency", "Amount Received", "Amount Paid"]])
        is_bad = chunk["Is Laundering"].astype(int) == 1
        laundering.append(chunk[is_bad])
        norm = chunk[~is_bad].assign(_key=rng.random(int((~is_bad).sum())))
        normal = pd.concat([normal, norm]).nsmallest(sample_size, "_key")
    laundering = pd.concat(laundering)
    n_normal = max(0, sample_size - len(laundering))
    sample = pd.concat([laundering, normal.nsmallest(n_normal, "_key").drop(columns="_key")])
    sample["Is Laundering"] = sample["Is Laundering"].astype(int)

    fx = dict(FX_FALLBACK)
    cross = pd.concat(fx_rows)
    if not cross.empty:
        ratio = cross["Amount Received"].astype(float) / cross["Amount Paid"].astype(float)
        stats = ratio.groupby(cross["Payment Currency"]).agg(["median", "count"])
        fx.update({c: float(r["median"]) for c, r in stats.iterrows() if r["count"] >= 10})

    paid = sample["Amount Paid"].astype(float)
    df = pd.DataFrame({
        "timestamp": pd.to_datetime(sample["Timestamp"], format="%Y/%m/%d %H:%M"),
        "from_account": [_ibm_account(b, a) for b, a in zip(sample["From Bank"], sample["Account"])],
        "to_account": [_ibm_account(b, a) for b, a in zip(sample["To Bank"], sample["Account.1"])],
        "amount": (paid * sample["Payment Currency"].map(fx).fillna(1.0)).round(2),
        "currency": "USD",
        "is_laundering": sample["Is Laundering"].astype(int),
    })
    df = df[df["from_account"] != df["to_account"]]
    return _finalise(df), fx


_BEGIN_RE = re.compile(r"BEGIN LAUNDERING ATTEMPT\s*-\s*([A-Z\-]+)")


def parse_ibm_patterns(path: Path, df: pd.DataFrame, fx: dict | None = None) -> list[dict]:
    """Parse HI-Small_Patterns.txt into ground-truth schemes and link them to sample tx_ids."""
    fx = fx or FX_FALLBACK
    key_to_tx: dict[tuple, list[tuple[float, str]]] = defaultdict(list)
    for tx, ts, f, t, a in zip(df["tx_id"], df["timestamp"].dt.strftime("%Y/%m/%d %H:%M"),
                               df["from_account"], df["to_account"], df["amount"]):
        key_to_tx[(ts, f, t)].append((a, tx))
    schemes: list[dict] = []
    current = None
    with open(path) as fh:
        for line in fh:
            line = line.strip()
            if not line:
                continue
            m = _BEGIN_RE.match(line)
            if m:
                current = {"type": m.group(1), "accounts": set(), "transactions": []}
                continue
            if line.startswith("END LAUNDERING ATTEMPT"):
                if current is not None:
                    schemes.append(current)
                current = None
                continue
            if current is None:
                continue
            parts = line.split(",")
            if len(parts) < 11:
                continue
            src, dst = _ibm_account(parts[1], parts[2]), _ibm_account(parts[3], parts[4])
            current["accounts"].update([src, dst])
            usd = float(parts[7]) * fx.get(parts[8], 1.0)
            options = [(abs(a - usd), tx) for a, tx in key_to_tx.get((parts[0], src, dst), [])]
            if options and min(options)[0] <= 0.01 * usd + 0.01:
                current["transactions"].append(min(options)[1])
    return [
        {"scheme_id": f"GT{i + 1:04d}", "type": s["type"], "accounts": sorted(s["accounts"]),
         "transactions": s["transactions"]}
        for i, s in enumerate(schemes)
    ]


# --------------------------------------------------------------------------- synthetic data

class _SchemeBuilder:
    def __init__(self, rng: np.random.Generator, pool: list[str], start: pd.Timestamp, days: int):
        self.rng = rng
        self.pool = pool  # accounts not yet used by any scheme (shuffled)
        self.start = start
        self.days = days
        self.rows: list[dict] = []
        self.schemes: list[dict] = []

    def _take(self, n: int) -> list[str]:
        taken, self.pool = self.pool[:n], self.pool[n:]
        return taken

    def _t0(self) -> pd.Timestamp:
        return self.start + pd.Timedelta(hours=float(self.rng.uniform(24, (self.days - 4) * 24)))

    def _hours(self, lo: float, hi: float) -> pd.Timedelta:
        return pd.Timedelta(hours=float(self.rng.uniform(lo, hi)))

    def _fee(self) -> float:
        return float(self.rng.uniform(0.01, 0.04))

    def _structured(self) -> float:
        return round(float(self.rng.uniform(8_000, 9_950)), 2)

    def _tx(self, ts, src, dst, amount, txs):
        idx = len(self.rows)
        self.rows.append({"_sid": len(self.schemes), "_idx": idx, "timestamp": ts, "from_account": src,
                          "to_account": dst, "amount": round(float(amount), 2)})
        txs.append(idx)

    def _save(self, kind: str, accounts: list[str], txs: list[int]):
        self.schemes.append({"type": kind, "accounts": sorted(set(accounts)), "_tx_idx": txs})

    def cycle(self):
        accs = self._take(int(self.rng.integers(3, 7)))
        amount, t, txs = float(self.rng.uniform(20_000, 120_000)), self._t0(), []
        for i, src in enumerate(accs):
            dst = accs[(i + 1) % len(accs)]
            self._tx(t, src, dst, amount, txs)
            amount *= 1 - self._fee()
            t += self._hours(1, 10)
        self._save("CYCLE", accs, txs)

    def fan_in(self):
        senders, dest = self._take(int(self.rng.integers(6, 13))), self._take(1)[0]
        t, txs = self._t0(), []
        for s in senders:
            self._tx(t + self._hours(0, 20), s, dest, self._structured(), txs)
        self._save("FAN-IN", senders + [dest], txs)

    def fan_out(self):
        src, receivers = self._take(1)[0], self._take(int(self.rng.integers(6, 13)))
        t, txs = self._t0(), []
        for r in receivers:
            self._tx(t + self._hours(0, 20), src, r, self._structured(), txs)
        self._save("FAN-OUT", [src] + receivers, txs)

    def scatter_gather(self):
        src, mules, dest = self._take(1)[0], self._take(int(self.rng.integers(5, 9))), self._take(1)[0]
        t, txs = self._t0(), []
        for m in mules:
            amt = self._structured()
            t_in = t + self._hours(0, 12)
            self._tx(t_in, src, m, amt, txs)
            self._tx(t_in + self._hours(2, 24), m, dest, amt * (1 - self._fee()), txs)
        self._save("SCATTER-GATHER", [src] + mules + [dest], txs)

    def gather_scatter(self):
        sources, hub = self._take(int(self.rng.integers(5, 9))), self._take(1)[0]
        dests = self._take(int(self.rng.integers(5, 9)))
        t, txs, total = self._t0(), [], 0.0
        for s in sources:
            amt = self._structured()
            total += amt
            self._tx(t + self._hours(0, 18), s, hub, amt, txs)
        out_total = total * (1 - self._fee())
        weights = self.rng.dirichlet(np.ones(len(dests)) * 5)
        for d, w in zip(dests, weights):
            self._tx(t + self._hours(20, 40), hub, d, out_total * w, txs)
        self._save("GATHER-SCATTER", sources + [hub] + dests, txs)

    def stack(self):
        src = self._take(1)[0]
        layer1 = self._take(int(self.rng.integers(3, 5)))
        layer2 = self._take(int(self.rng.integers(3, 5)))
        dest = self._take(1)[0]
        t, txs = self._t0(), []
        l2_in: dict[str, list[tuple[pd.Timestamp, float]]] = {m: [] for m in layer2}
        for i, m1 in enumerate(layer1):
            amt = float(self.rng.uniform(15_000, 45_000))
            t1 = t + self._hours(0, 6)
            self._tx(t1, src, m1, amt, txs)
            out = amt * (1 - self._fee())
            targets = [layer2[i % len(layer2)], layer2[(i + 1) % len(layer2)]]
            for m2 in targets:
                t2 = t1 + self._hours(2, 12)
                self._tx(t2, m1, m2, out / 2, txs)
                l2_in[m2].append((t2, out / 2))
        for m2, ins in l2_in.items():
            if not ins:
                continue
            t_last = max(ts for ts, _ in ins)
            self._tx(t_last + self._hours(2, 12), m2, dest, sum(a for _, a in ins) * (1 - self._fee()), txs)
        self._save("STACK", [src] + layer1 + layer2 + [dest], txs)


def generate_synthetic(n_accounts: int = 2_000, n_normal: int = 40_000, days: int = 30,
                       n_schemes: int = 15, seed: int = 7) -> tuple[pd.DataFrame, list[dict]]:
    rng = np.random.default_rng(seed)
    start = pd.Timestamp("2026-10-01")
    accounts = np.array([f"ACC{i:05d}" for i in range(n_accounts)])

    # Normal behaviour: each account has a handful of regular counterparties and a skewed activity level.
    activity = rng.lognormal(0, 0.6, n_accounts)
    activity /= activity.sum()
    contacts = [rng.choice(n_accounts, size=int(rng.integers(3, 13)), replace=False) for _ in range(n_accounts)]
    senders = rng.choice(n_accounts, size=n_normal, p=activity)
    to_contact = rng.random(n_normal) < 0.8
    receivers = np.where(
        to_contact,
        [contacts[s][rng.integers(len(contacts[s]))] for s in senders],
        rng.integers(0, n_accounts, n_normal),
    )
    self_loop = receivers == senders
    receivers[self_loop] = (receivers[self_loop] + 1) % n_accounts
    normal = pd.DataFrame({
        "timestamp": start + pd.to_timedelta(rng.uniform(0, days * 86_400, n_normal).round(), unit="s"),
        "from_account": accounts[senders],
        "to_account": accounts[receivers],
        "amount": np.round(rng.lognormal(4.6, 1.0, n_normal), 2),
        "is_laundering": 0,
    })

    # Legitimate high-volume behaviour that looks like fan-out / fan-in: payroll runs and rent collection.
    legit = []
    for employer in rng.choice(n_accounts, size=4, replace=False):
        staff = rng.choice(n_accounts, size=int(rng.integers(8, 16)), replace=False)
        for payday in (1, 15):
            for e in staff:
                legit.append((start + pd.Timedelta(days=payday, hours=float(rng.uniform(8, 10))),
                              accounts[employer], accounts[e], round(float(rng.uniform(2_000, 4_500)), 2)))
    for landlord in rng.choice(n_accounts, size=2, replace=False):
        for tenant in rng.choice(n_accounts, size=int(rng.integers(6, 10)), replace=False):
            legit.append((start + pd.Timedelta(days=1, hours=float(rng.uniform(0, 20))),
                          accounts[tenant], accounts[landlord], round(float(rng.uniform(1_200, 2_500)), 2)))
    legit_df = pd.DataFrame(legit, columns=["timestamp", "from_account", "to_account", "amount"])
    legit_df = legit_df[legit_df["from_account"] != legit_df["to_account"]]
    normal = pd.concat([normal, legit_df.assign(is_laundering=0)], ignore_index=True)

    pool = list(rng.permutation(accounts))
    builder = _SchemeBuilder(rng, pool, start, days)
    makers = [builder.cycle, builder.fan_in, builder.fan_out, builder.scatter_gather,
              builder.gather_scatter, builder.stack]
    for i in range(n_schemes):
        makers[i % len(makers)]()

    bad = pd.DataFrame(builder.rows)
    bad["timestamp"] = pd.to_datetime(bad["timestamp"]).dt.round("s")
    bad["is_laundering"] = 1
    df = pd.concat([normal, bad.drop(columns=["_sid"])], ignore_index=True)
    df["currency"] = "USD"
    df = _finalise(df)

    # Map generator row index -> final tx_id
    idx_to_tx = dict(zip(df["_idx"].dropna().astype(int), df.loc[df["_idx"].notna(), "tx_id"]))
    schemes = [
        {"scheme_id": f"GT{i + 1:03d}", "type": s["type"], "accounts": s["accounts"],
         "transactions": [idx_to_tx[j] for j in s["_tx_idx"]]}
        for i, s in enumerate(builder.schemes)
    ]
    return df.drop(columns=["_idx"]), schemes


# --------------------------------------------------------------------------- common

def _finalise(df: pd.DataFrame) -> pd.DataFrame:
    df = df.sort_values("timestamp", kind="stable").reset_index(drop=True)
    df["tx_id"] = [f"T{i:06d}" for i in range(len(df))]
    extra = [c for c in df.columns if c not in COLUMNS]
    return df[COLUMNS + extra]


def build_dataset(data_dir: Path = DATA_DIR, force: bool = False) -> tuple[pd.DataFrame, list[dict] | None]:
    """Return (transactions, ground_truth_schemes). Ground truth is None when unavailable."""
    data_dir.mkdir(parents=True, exist_ok=True)
    sample_path, gt_path = data_dir / SAMPLE_FILE, data_dir / GROUND_TRUTH_FILE

    if sample_path.exists() and not force:
        df = pd.read_parquet(sample_path)
        gt = json.loads(gt_path.read_text()) if gt_path.exists() else None
        return df, gt

    want_ibm = DATASET != "synthetic"
    if want_ibm and not (data_dir / IBM_TRANS).exists() and DATASET != "local":
        download_ibm(data_dir)
    if want_ibm and (data_dir / IBM_TRANS).exists():
        print(f"[data] Loading IBM AML dataset from {data_dir / IBM_TRANS}")
        df, fx = load_ibm(data_dir)
        gt = parse_ibm_patterns(data_dir / IBM_PATTERNS, df, fx) if (data_dir / IBM_PATTERNS).exists() else None
    else:
        print("[data] Using synthetic data" + ("" if DATASET == "synthetic" else " (IBM dataset unavailable)"))
        df, gt = generate_synthetic()

    df.to_parquet(sample_path, index=False)
    if gt is not None:
        gt_path.write_text(json.dumps(gt, indent=2))
    elif gt_path.exists():
        gt_path.unlink()
    print(f"[data] {len(df):,} transactions, {int(df['is_laundering'].sum()):,} laundering, "
          f"{len(gt) if gt else 0} ground-truth schemes -> {sample_path}")
    return df, gt


if __name__ == "__main__":
    import sys
    build_dataset(force="--force" in sys.argv)
