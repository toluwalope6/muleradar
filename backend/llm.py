"""LLM helpers for /ask and /report, with templated fallbacks so the demo never breaks."""
from __future__ import annotations

import json
import os
from pathlib import Path

import httpx
from dotenv import load_dotenv

load_dotenv(Path(__file__).resolve().parent / ".env")

TIMEOUT = float(os.getenv("LLM_TIMEOUT", "30"))
SYSTEM_PROMPT = (
    "You are MuleRadar, an anti-money-laundering investigation assistant. You are given a JSON case "
    "produced by a transaction-graph detector (accounts, money-flow edges, reconstructed timeline, "
    "risk score, scheme type). Answer strictly from the case data; cite account ids, amounts and "
    "timestamps. Be concise and factual. Do not invent facts that are not in the case. A sum over all "
    "transfers counts funds at every hop: call it the total across transfers, never unique funds or money lost."
)


def _provider() -> str | None:
    forced = os.getenv("LLM_PROVIDER", "").lower()
    if forced in ("openai", "anthropic"):
        return forced if os.getenv(f"{forced.upper()}_API_KEY") else None
    if os.getenv("OPENAI_API_KEY"):
        return "openai"
    if os.getenv("ANTHROPIC_API_KEY"):
        return "anthropic"
    return None


def _call_llm(prompt: str, max_tokens: int = 900) -> str | None:
    provider = _provider()
    if provider is None:
        return None
    try:
        if provider == "openai":
            r = httpx.post(
                "https://api.openai.com/v1/chat/completions",
                headers={"Authorization": f"Bearer {os.environ['OPENAI_API_KEY']}"},
                json={"model": os.getenv("OPENAI_MODEL", "gpt-4o-mini"), "max_tokens": max_tokens,
                      "messages": [{"role": "system", "content": SYSTEM_PROMPT},
                                   {"role": "user", "content": prompt}]},
                timeout=TIMEOUT,
            )
            r.raise_for_status()
            return r.json()["choices"][0]["message"]["content"].strip()
        r = httpx.post(
            "https://api.anthropic.com/v1/messages",
            headers={"x-api-key": os.environ["ANTHROPIC_API_KEY"], "anthropic-version": "2023-06-01"},
            json={"model": os.getenv("ANTHROPIC_MODEL", "claude-haiku-4-5"), "max_tokens": max_tokens,
                  "system": SYSTEM_PROMPT, "messages": [{"role": "user", "content": prompt}]},
            timeout=TIMEOUT,
        )
        r.raise_for_status()
        return "".join(b.get("text", "") for b in r.json()["content"]).strip()
    except Exception as exc:  # network/auth/model errors fall back to templates
        print(f"[llm] {provider} call failed, using template: {exc!r}")
        return None


def _context(case: dict, max_steps: int = 80) -> str:
    trimmed = dict(case)
    trimmed["timeline"] = case["timeline"][:max_steps]
    trimmed["edges"] = case["edges"][:max_steps]
    return json.dumps(trimmed, default=str)


# --------------------------------------------------------------------------- templates

def _money(x: float) -> str:
    return f"{x:,.2f}"


def _facts(case: dict) -> dict:
    roles = {"source": [], "mule": [], "destination": []}
    for n in case["nodes"]:
        roles[n["role"]].append(n["id"])
    amounts = [e["amount"] for e in case["edges"]]
    times = [e["timestamp"] for e in case["edges"]]
    return {"roles": roles, "total": sum(amounts), "n_tx": len(amounts),
            "start": min(times) if times else "", "end": max(times) if times else "",
            "structured": sum(8_000 <= a < 10_000 for a in amounts)}


def template_answer(case: dict, question: str) -> str:
    f, q = _facts(case), question.lower()
    r = f["roles"]
    if any(w in q for w in ("why", "suspicious", "risk", "flag")):
        return (f"Case {case['id']} scores {case['risk_score']}/100 as a {case['scheme_type']} scheme. "
                f"{case['summary']} {f['structured']} of {f['n_tx']} transfers sit just under the 10k "
                f"reporting threshold.")
    if any(w in q for w in ("how much", "amount", "total", "money", "value")):
        return (f"Total across {f['n_tx']} transfers between {f['start']} and {f['end']}: {_money(f['total'])}. "
                f"Funds passing through several accounts are counted at each step, so this is not unique funds.")
    if any(w in q for w in ("who", "account", "source", "mule", "destination", "beneficiar")):
        return (f"Sources: {', '.join(r['source']) or 'none'}. Mules: {', '.join(r['mule']) or 'none'}. "
                f"Destinations: {', '.join(r['destination']) or 'none'}.")
    if any(w in q for w in ("when", "timeline", "order", "sequence", "step", "how did")):
        steps = case["timeline"][:6]
        lines = [f"{s['step']}. {s['timestamp']}: {s['description']}" for s in steps]
        more = f" (+{len(case['timeline']) - 6} more steps)" if len(case["timeline"]) > 6 else ""
        return "Money flow: " + " ".join(lines) + more
    if any(w in q for w in ("next", "recommend", "action", "do")):
        return (f"Freeze or monitor the mule accounts ({', '.join(r['mule'][:5]) or 'n/a'}), request KYC on "
                f"destinations ({', '.join(r['destination'][:5]) or 'n/a'}), and file a SAR for case "
                f"{case['id']}.")
    return f"{case['summary']} (Set OPENAI_API_KEY or ANTHROPIC_API_KEY for free-form answers.)"


def template_report(case: dict) -> str:
    f = _facts(case)
    r = f["roles"]
    rows = "\n".join(
        f"| {s['step']} | {s['timestamp']} | {s['from']} | {s['to']} | {_money(s['amount'])} | {s['description']} |"
        for s in case["timeline"]
    )
    subjects = "\n".join(f"- `{n['id']}` ({n['role']}, account risk {n['risk_score']}/100)" for n in case["nodes"])
    findings = "\n".join(f"- Detector finding ({h['detector']}): {h['reason']}" for h in case.get("indicators", []))
    return f"""# Suspicious Activity Report (DRAFT) - Case {case['id']}

**Typology:** {case['scheme_type']}  
**Risk score:** {case['risk_score']}/100  
**Activity period:** {f['start']} to {f['end']}  
**Total across transfers:** {_money(f['total'])} over {f['n_tx']} transfers (funds passing through several accounts are counted at each step; this is not unique funds or money lost)

## 1. Summary
{case['summary']}

## 2. Subjects
{subjects}

## 3. Description of activity
Funds originated from {', '.join(r['source']) or 'unidentified accounts'}, were routed through
{len(r['mule'])} intermediary account(s) ({', '.join(r['mule']) or 'none'}) and ended with
{', '.join(r['destination']) or 'the originating account (cycle)'}. The reconstructed sequence is below.

| Step | Timestamp | From | To | Amount | Description |
|---|---|---|---|---|---|
{rows}

## 4. Red-flag indicators
- Network shape classified by the detector as **{case['scheme_type']}**.
- {f['structured']} transfer(s) just below the 10,000 reporting threshold (possible structuring).
{findings}

## 5. Recommended actions
1. Place enhanced monitoring / temporary holds on the mule accounts.
2. Request KYC and source-of-funds documentation from source and destination account holders.
3. Preserve transaction records and escalate to the MLRO for SAR filing.

_Draft generated by MuleRadar from detector output; analyst review required before filing._
"""


# --------------------------------------------------------------------------- public API

def answer_question(case: dict, question: str) -> str:
    prompt = f"Case JSON:\n{_context(case)}\n\nInvestigator question: {question}"
    return _call_llm(prompt, max_tokens=500) or template_answer(case, question)


def draft_report(case: dict) -> str:
    return draft_report_with_source(case)[0]


def draft_report_with_source(case: dict) -> tuple[str, str]:
    """Returns (markdown, generated_by) where generated_by is "template", "openai" or "anthropic"."""
    prompt = (
        f"Case JSON:\n{_context(case)}\n\nDraft a Suspicious Activity Report in Markdown with sections: "
        "Summary, Subjects (accounts and roles), Description of activity (include a timeline table), "
        "Red-flag indicators, Recommended actions. Mark it as a DRAFT requiring analyst review."
    )
    text = _call_llm(prompt, max_tokens=1500)
    return (text, _provider() or "template") if text else (template_report(case), "template")
