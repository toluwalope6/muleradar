"""Detection + scheme reconstruction.

Pipeline: transactions -> directed graph -> detectors (cycle, fan-in, fan-out, pass-through)
-> hits merged into cases -> risk score, scheme type, roles, timeline -> ground-truth comparison.
"""
from __future__ import annotations

import math
from collections import Counter, defaultdict
from dataclasses import dataclass, field

import networkx as nx
import numpy as np
import pandas as pd

# Detector parameters
CYCLE_MIN_LEN, CYCLE_MAX_LEN = 3, 6
CYCLE_WINDOW = pd.Timedelta(hours=96)
CLASSIFY_CYCLE_MAX_LEN = 12  # a reconstructed case can reveal longer loops than the detector searches for
CYCLE_WINDOW_STEP = pd.Timedelta(hours=24)
CYCLE_AMOUNT_RETENTION = (0.80, 1.05)  # each hop keeps 80-105% of the previous hop's amount
CYCLE_MIN_AMOUNT = 1_000.0  # only material transfers are followed around a cycle
FAN_MIN_COUNTERPARTIES = 5
FAN_WINDOW = pd.Timedelta(hours=24)
FAN_MIN_AMOUNT = 5_000.0  # total value moved in the 24h window
FAN_MATERIAL_SHARE = 0.10  # evidence keeps tx >= 10% of the largest tx in the window
PASS_WINDOW = pd.Timedelta(hours=48)
PASS_RATIO = (0.80, 1.05)
PASS_MIN_AMOUNT = 5_000.0
PASS_MATERIAL_SHARE = 0.10  # ignore tx smaller than 10% of the inflow when building evidence
MIN_CASE_RISK = 40
ENRICH_WINDOW = pd.Timedelta(hours=48)  # context added around a case when reconstructing it
ENRICH_MATERIAL_SHARE = 0.10
MATCH_THRESHOLD = 0.3  # Jaccard needed for a case to count as finding a ground-truth scheme
STRUCTURING_BAND = (8_000, 10_000)


@dataclass
class Hit:
    detector: str  # cycle | fan_in | fan_out | pass_through
    accounts: list[str]  # primary flagged accounts
    tx_ids: list[str]  # evidence transactions
    reason: str


@dataclass
class Case:
    id: str
    hits: list[Hit]
    tx: pd.DataFrame
    risk_score: int = 0
    scheme_type: str = ""
    nodes: list[dict] = field(default_factory=list)
    timeline: list[dict] = field(default_factory=list)
    summary: str = ""
    ground_truth: dict | None = None
    match_score: float = 0.0
    type_correct: bool | None = None
    matched_scheme_id: str | None = None


def _fmt(amount: float) -> str:
    return f"{amount:,.2f}"


def build_graph(df: pd.DataFrame) -> nx.MultiDiGraph:
    g = nx.MultiDiGraph()
    for tx, s, t, a, ts in zip(df["tx_id"], df["from_account"], df["to_account"], df["amount"], df["timestamp"]):
        g.add_edge(s, t, key=tx, amount=float(a), timestamp=ts)
    return g


# --------------------------------------------------------------------------- detectors

def detect_cycles(df: pd.DataFrame) -> list[Hit]:
    """Cycles of length 3-6 whose hops are time-ordered and keep roughly the same amount."""
    hits: dict[frozenset, Hit] = {}
    df = df[df["amount"] >= CYCLE_MIN_AMOUNT]
    if df.empty:
        return []
    t_min, t_max = df["timestamp"].min(), df["timestamp"].max()
    start = t_min
    while start <= t_max:
        win = df[(df["timestamp"] >= start) & (df["timestamp"] < start + CYCLE_WINDOW)]
        start += CYCLE_WINDOW_STEP
        if win.empty:
            continue
        g = nx.DiGraph()
        g.add_edges_from(zip(win["from_account"], win["to_account"]))
        pair_tx = defaultdict(list)
        for tx, s, t, a, ts in zip(win["tx_id"], win["from_account"], win["to_account"], win["amount"], win["timestamp"]):
            pair_tx[(s, t)].append((ts, float(a), tx))
        for cyc in nx.simple_cycles(g, length_bound=CYCLE_MAX_LEN):
            if len(cyc) < CYCLE_MIN_LEN or frozenset(cyc) in hits:
                continue
            path = _temporal_cycle(cyc, pair_tx)
            if path:
                total = sum(a for _, a, _ in path)
                hits[frozenset(cyc)] = Hit(
                    "cycle", list(cyc), [tx for _, _, tx in path],
                    f"{len(cyc)}-hop cycle: {_fmt(path[0][1])} left {cyc[0]} and {_fmt(path[-1][1])} returned "
                    f"within {(path[-1][0] - path[0][0]).total_seconds() / 3600:.1f}h (volume {_fmt(total)})",
                )
    return list(hits.values())


def _temporal_cycle(cyc: list[str], pair_tx: dict) -> list[tuple] | None:
    """Find a time-ordered, amount-preserving tx sequence around the cycle, trying every rotation."""
    n = len(cyc)
    lo, hi = CYCLE_AMOUNT_RETENTION
    for r in range(n):
        order = cyc[r:] + cyc[:r]
        hops = [(order[i], order[(i + 1) % n]) for i in range(n)]

        def extend(i, prev):
            if i == n:
                return []
            for ts, a, tx in sorted(pair_tx[hops[i]]):
                if prev and (ts <= prev[0] or not (lo * prev[1] <= a <= hi * prev[1])):
                    continue
                rest = extend(i + 1, (ts, a))
                if rest is not None:
                    return [(ts, a, tx)] + rest
            return None

        path = extend(0, None)
        if path:
            return path
    return None


def _detect_fan(df: pd.DataFrame, direction: str) -> list[Hit]:
    """fan_in: one account receiving from 5+ distinct senders within 24h (fan_out is the mirror)."""
    key, other = ("to_account", "from_account") if direction == "fan_in" else ("from_account", "to_account")
    hits = []
    for acct, grp in df.groupby(key, sort=False):
        if grp[other].nunique() < FAN_MIN_COUNTERPARTIES:
            continue
        ts, cps, amts = grp["timestamp"].to_numpy(), grp[other].to_numpy(), grp["amount"].to_numpy()
        counts, best, j, total = Counter(), (0, 0.0, 0, 0), 0, 0.0
        for i in range(len(grp)):
            counts[cps[i]] += 1
            total += amts[i]
            while ts[i] - ts[j] > FAN_WINDOW.to_timedelta64():
                counts[cps[j]] -= 1
                total -= amts[j]
                if counts[cps[j]] == 0:
                    del counts[cps[j]]
                j += 1
            if len(counts) >= FAN_MIN_COUNTERPARTIES and total >= FAN_MIN_AMOUNT and (len(counts), total) > best[:2]:
                best = (len(counts), total, j, i)
        n, _, j, i = best
        if n:
            win = grp.iloc[j:i + 1]
            win = win[win["amount"] >= FAN_MATERIAL_SHARE * win["amount"].max()]
            n = win[other].nunique()
            if n < FAN_MIN_COUNTERPARTIES:
                continue
            verb = "received from" if direction == "fan_in" else "sent to"
            hits.append(Hit(direction, [acct], win["tx_id"].tolist(),
                            f"{acct} {verb} {n} distinct accounts within 24h (total {_fmt(win['amount'].sum())})"))
    return hits


def detect_fan_in(df: pd.DataFrame) -> list[Hit]:
    return _detect_fan(df, "fan_in")


def detect_fan_out(df: pd.DataFrame) -> list[Hit]:
    return _detect_fan(df, "fan_out")


def detect_pass_through(df: pd.DataFrame) -> list[Hit]:
    """Money in roughly equals money out within 48h of the first inflow."""
    hits = []
    incoming = {a: g for a, g in df.groupby("to_account", sort=False)}
    outgoing = {a: g for a, g in df.groupby("from_account", sort=False)}
    lo, hi = PASS_RATIO
    win64 = PASS_WINDOW.to_timedelta64()
    for acct, ins in incoming.items():
        outs = outgoing.get(acct)
        if outs is None or ins["amount"].sum() < PASS_MIN_AMOUNT:
            continue
        in_ts, in_amt = ins["timestamp"].to_numpy(), ins["amount"].to_numpy()
        out_ts, out_amt = outs["timestamp"].to_numpy(), outs["amount"].to_numpy()
        in_cum, out_cum = np.concatenate([[0], np.cumsum(in_amt)]), np.concatenate([[0], np.cumsum(out_amt)])
        best = None
        for k in range(len(ins)):
            t0 = in_ts[k]
            i_end = np.searchsorted(in_ts, t0 + win64, side="right")
            o_start = np.searchsorted(out_ts, t0, side="right")
            o_end = np.searchsorted(out_ts, t0 + win64, side="right")
            in_sum = in_cum[i_end] - in_cum[k]
            out_sum = out_cum[o_end] - out_cum[o_start]
            if in_sum < PASS_MIN_AMOUNT or o_end == o_start:
                continue
            ratio = out_sum / in_sum
            if lo <= ratio <= hi and (best is None or in_sum > best[0]):
                best = (in_sum, out_sum, ratio, k, i_end, o_start, o_end)
        if best:
            in_sum, out_sum, ratio, k, i_end, o_start, o_end = best
            floor = PASS_MATERIAL_SHARE * in_sum
            ev_in = ins.iloc[k:i_end]
            ev_out = outs.iloc[o_start:o_end]
            ev = pd.concat([ev_in[ev_in["amount"] >= floor], ev_out[ev_out["amount"] >= floor]])
            span = (ev["timestamp"].max() - ev["timestamp"].min()).total_seconds() / 3600
            hits.append(Hit("pass_through", [acct], ev["tx_id"].tolist(),
                            f"{acct} received {_fmt(in_sum)} and sent on {_fmt(out_sum)} ({ratio:.0%}) "
                            f"within {span:.1f}h"))
    return hits


DETECTORS = [detect_cycles, detect_fan_in, detect_fan_out, detect_pass_through]


# --------------------------------------------------------------------------- cases

def group_hits(hits: list[Hit]) -> list[list[Hit]]:
    """Hits sharing a flagged account or an evidence transaction belong to the same case."""
    parent = list(range(len(hits)))

    def find(x):
        while parent[x] != x:
            parent[x] = parent[parent[x]]
            x = parent[x]
        return x

    owner: dict[str, int] = {}
    for i, h in enumerate(hits):
        for k in [f"a:{a}" for a in h.accounts] + [f"t:{t}" for t in h.tx_ids]:
            if k in owner:
                parent[find(i)] = find(owner[k])
            else:
                owner[k] = i
    groups = defaultdict(list)
    for i, h in enumerate(hits):
        groups[find(i)].append(h)
    return list(groups.values())


def classify(tx: pd.DataFrame, hits: list[Hit]) -> str:
    detectors = Counter(h.detector for h in hits)
    g = nx.DiGraph()
    g.add_edges_from(zip(tx["from_account"], tx["to_account"]))
    if detectors["cycle"] or any(len(c) >= CYCLE_MIN_LEN for c in nx.simple_cycles(g, length_bound=CLASSIFY_CYCLE_MAX_LEN)):
        return "CYCLE"
    ins, outs = dict(g.in_degree()), dict(g.out_degree())
    in_hubs = [n for n in g if ins[n] >= 3]
    out_hubs = [n for n in g if outs[n] >= 3]
    longest = len(nx.dag_longest_path(g)) if nx.is_directed_acyclic_graph(g) else 0
    if any(ins[n] >= 3 and outs[n] >= 3 for n in g):
        return "GATHER-SCATTER"  # one hub collects from many and pays out to many
    if in_hubs and out_hubs:
        if any(nx.has_path(g, s, d) for s in out_hubs for d in in_hubs):
            return "STACK" if longest >= 4 else "SCATTER-GATHER"  # fan out to mules, then re-collect
        return "GATHER-SCATTER"
    if in_hubs:
        return "STACK" if longest >= 4 else "FAN-IN"
    if out_hubs:
        return "STACK" if longest >= 4 else "FAN-OUT"
    if longest >= 3:
        return "STACK"
    return "FAN-IN" if detectors["fan_in"] >= detectors["fan_out"] else "FAN-OUT"


def assign_roles(tx: pd.DataFrame, scheme_type: str) -> dict[str, str]:
    accounts = pd.unique(tx[["from_account", "to_account"]].to_numpy().ravel())
    if scheme_type == "CYCLE":
        origin = tx.sort_values("timestamp").iloc[0]["from_account"]
        return {a: ("source" if a == origin else "mule") for a in accounts}
    senders, receivers = set(tx["from_account"]), set(tx["to_account"])
    return {a: "mule" if (a in senders and a in receivers) else ("source" if a in senders else "destination")
            for a in accounts}


def risk_score(tx: pd.DataFrame, hits: list[Hit]) -> int:
    det = Counter(h.detector for h in hits)
    score = 40 * bool(det["cycle"]) + 20 * bool(det["fan_in"]) + 20 * bool(det["fan_out"])
    score += min(36, 12 * det["pass_through"])
    total = tx["amount"].sum()
    score += float(np.clip(10 * math.log10(max(total, 1) / 1_000), 0, 25))
    lo, hi = STRUCTURING_BAND
    if len(tx) and ((tx["amount"] >= lo) & (tx["amount"] < hi)).mean() >= 0.3:
        score += 10
    if (tx["timestamp"].max() - tx["timestamp"].min()) <= pd.Timedelta(hours=72):
        score += 10
    return int(round(min(100, score)))


def build_timeline(tx: pd.DataFrame, roles: dict[str, str], scheme_type: str) -> list[dict]:
    tx = tx.sort_values("timestamp")
    received: dict[str, list[tuple[pd.Timestamp, float]]] = defaultdict(list)
    origin = tx.iloc[0]["from_account"]
    steps = []
    for step, row in enumerate(tx.itertuples(index=False), start=1):
        s, t, amt, ts = row.from_account, row.to_account, float(row.amount), row.timestamp
        rs, rt = roles.get(s, "mule"), roles.get(t, "mule")
        prior = [(pts, pa) for pts, pa in received[s] if pts < ts]
        if scheme_type == "CYCLE" and t == origin:
            desc = f"Cycle closes: {s} returns {_fmt(amt)} to origin {t}, hiding the source of funds"
        elif rs == "mule" and prior:
            lag = (ts - prior[-1][0]).total_seconds() / 3600
            desc = (f"Mule {s} forwards {_fmt(amt)} to {rt} {t}, {lag:.1f}h after receiving "
                    f"{_fmt(sum(pa for _, pa in prior))}")
        elif rs == "source" and rt == "mule":
            desc = f"Source {s} places {_fmt(amt)} with mule {t}"
        elif rs == "source" and rt == "destination" and scheme_type == "FAN-IN":
            desc = f"{s} deposits {_fmt(amt)} into collection account {t}"
        elif rs == "source" and rt == "destination":
            desc = f"Source {s} disperses {_fmt(amt)} to {t}"
        else:
            desc = f"{s} ({rs}) sends {_fmt(amt)} to {t} ({rt})"
        lo, hi = STRUCTURING_BAND
        if lo <= amt < hi:
            desc += " [just under 10k reporting threshold]"
        received[t].append((ts, amt))
        steps.append({"step": step, "timestamp": ts.isoformat(), "from": s, "to": t,
                      "amount": round(amt, 2), "description": desc})
    return steps


def enrich(tx_ids: set[str], df: pd.DataFrame, df_by_tx: pd.DataFrame) -> set[str]:
    """Add the context needed to reconstruct the scheme around the detector evidence:
    transfers between case accounts (e.g. the hop that closes a cycle) and transfers with a
    counterparty that deals with 2+ case accounts (e.g. the source that scattered to the mules)."""
    tx = df_by_tx.loc[sorted(tx_ids)]
    accts = set(tx["from_account"]) | set(tx["to_account"])
    t0, t1 = tx["timestamp"].min() - ENRICH_WINDOW, tx["timestamp"].max() + ENRICH_WINDOW
    floor = ENRICH_MATERIAL_SHARE * tx["amount"].median()
    lo, hi = df["timestamp"].searchsorted([t0, t1], side="left")
    win = df.iloc[lo:hi]
    win = win[(win["amount"] >= floor) & (win["from_account"].isin(accts) | win["to_account"].isin(accts))]
    internal = win["from_account"].isin(accts) & win["to_account"].isin(accts)
    cp = win.loc[~internal, "from_account"].where(win.loc[~internal, "to_account"].isin(accts),
                                                  win.loc[~internal, "to_account"])
    links = pd.DataFrame({"cp": cp, "case_acct": win.loc[~internal, "to_account"].where(
        win.loc[~internal, "to_account"].isin(accts), win.loc[~internal, "from_account"])})
    shared = set(links.groupby("cp")["case_acct"].nunique().loc[lambda n: n >= 2].index)
    keep = internal.to_numpy().copy()
    keep[~keep] = cp.isin(shared).to_numpy()
    return tx_ids | set(win.loc[keep, "tx_id"])


def build_case(case_id: str, hits: list[Hit], df_by_tx: pd.DataFrame, df: pd.DataFrame | None = None) -> Case:
    tx_ids = {t for h in hits for t in h.tx_ids}
    if df is not None:
        tx_ids = enrich(tx_ids, df, df_by_tx)
    tx = df_by_tx.loc[sorted(tx_ids)].reset_index()
    case = Case(id=case_id, hits=hits, tx=tx)
    case.scheme_type = classify(tx, hits)
    case.risk_score = risk_score(tx, hits)
    roles = assign_roles(tx, case.scheme_type)
    flagged = Counter(a for h in hits for a in h.accounts)
    case.nodes = [
        {"id": a, "role": r,
         "risk_score": int(min(100, round(0.5 * case.risk_score + 20 * flagged[a] + (10 if r == "mule" else 0))))}
        for a, r in sorted(roles.items(), key=lambda kv: (-flagged[kv[0]], kv[0]))
    ]
    case.timeline = build_timeline(tx, roles, case.scheme_type)
    n_src = sum(r == "source" for r in roles.values())
    n_mule = sum(r == "mule" for r in roles.values())
    n_dst = sum(r == "destination" for r in roles.values())
    reasons = sorted(hits, key=lambda h: ["cycle", "fan_in", "fan_out", "pass_through"].index(h.detector))
    case.summary = (
        f"{case.scheme_type} scheme: {len(roles)} accounts ({n_src} source, {n_mule} mule, {n_dst} destination) "
        f"moved {_fmt(tx['amount'].sum())} across {len(tx)} transactions in {duration_hours(tx):.1f}h. "
        f"Key signal: {reasons[0].reason}."
    )
    return case


def duration_hours(tx: pd.DataFrame) -> float:
    return round((tx["timestamp"].max() - tx["timestamp"].min()).total_seconds() / 3600, 1)


# --------------------------------------------------------------------------- evaluation

def match_ground_truth(cases: list[Case], ground_truth: list[dict] | None) -> None:
    if not ground_truth:
        return
    gt_sets = [set(s["accounts"]) for s in ground_truth]
    for case in cases:
        accts = {n["id"] for n in case.nodes}
        scores = [len(accts & g) / len(accts | g) for g in gt_sets]
        best = int(np.argmax(scores))
        if scores[best] >= MATCH_THRESHOLD:
            s = ground_truth[best]
            case.ground_truth = {"scheme_type": s["type"], "account_ids": s["accounts"]}
            case.matched_scheme_id = s["scheme_id"]
            case.match_score = round(scores[best], 3)
            case.type_correct = case.scheme_type == s["type"]


def compute_metrics(df: pd.DataFrame, cases: list[Case], ground_truth: list[dict] | None) -> dict:
    flagged = {t for c in cases for t in c.tx["tx_id"]}
    laundering = set(df.loc[df["is_laundering"] == 1, "tx_id"])
    tp = len(flagged & laundering)
    precision = tp / len(flagged) if flagged else 0.0
    recall = tp / len(laundering) if laundering else 0.0

    schemes_total = len(ground_truth) if ground_truth else 0
    found, type_ok = 0, 0
    for s in ground_truth or []:
        candidates = [c for c in cases if c.matched_scheme_id == s["scheme_id"] and c.match_score >= MATCH_THRESHOLD]
        if candidates:
            found += 1
            best = max(candidates, key=lambda c: c.match_score)
            type_ok += best.scheme_type == s["type"]
    return {
        "precision": round(precision, 3),
        "recall": round(recall, 3),
        "schemes_found": found,
        "schemes_total": schemes_total,
        "scheme_type_accuracy": round(type_ok / found, 3) if found else 0.0,
    }


# --------------------------------------------------------------------------- entry point

@dataclass
class Results:
    cases: list[Case]
    metrics: dict
    by_id: dict[str, Case]


def run_detection(df: pd.DataFrame, ground_truth: list[dict] | None) -> Results:
    df = df.sort_values("timestamp", kind="stable").reset_index(drop=True)
    hits = [h for detector in DETECTORS for h in detector(df)]
    df_by_tx = df.set_index("tx_id")
    candidates = [build_case("", group, df_by_tx, df) for group in group_hits(hits)]
    cases = sorted((c for c in candidates if c.risk_score >= MIN_CASE_RISK),
                   key=lambda c: (-c.risk_score, -c.tx["amount"].sum()))
    for i, c in enumerate(cases, start=1):
        c.id = f"C{i:03d}"
    match_ground_truth(cases, ground_truth)
    metrics = compute_metrics(df, cases, ground_truth)
    return Results(cases=cases, metrics=metrics, by_id={c.id: c for c in cases})


# --------------------------------------------------------------------------- serialisation

def case_summary(c: Case) -> dict:
    return {"id": c.id, "risk_score": c.risk_score, "scheme_type": c.scheme_type,
            "account_count": len(c.nodes), "total_amount": round(float(c.tx["amount"].sum()), 2),
            "duration_hours": duration_hours(c.tx), "summary": c.summary}


def case_detail(c: Case) -> dict:
    return {
        "id": c.id, "risk_score": c.risk_score, "scheme_type": c.scheme_type, "summary": c.summary,
        "nodes": c.nodes,
        "edges": [{"source": r.from_account, "target": r.to_account, "amount": round(float(r.amount), 2),
                   "timestamp": r.timestamp.isoformat()}
                  for r in c.tx.sort_values("timestamp").itertuples(index=False)],
        "timeline": c.timeline,
        "ground_truth": c.ground_truth,
        "match_score": c.match_score,
        "type_correct": c.type_correct,
    }
