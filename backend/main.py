"""MuleRadar API. Run from this directory: uvicorn main:app --reload"""
from __future__ import annotations

import os
import time
from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from data import build_dataset
from detect import Results, case_detail, case_summary, run_detection
from llm import answer_question, draft_report_with_source

STATE: dict[str, Results] = {}


def get_results() -> Results:
    if "results" not in STATE:
        t0 = time.time()
        df, ground_truth = build_dataset()
        STATE["results"] = run_detection(df, ground_truth)
        print(f"[startup] {len(STATE['results'].cases)} cases in {time.time() - t0:.1f}s; "
              f"metrics={STATE['results'].metrics}")
    return STATE["results"]


@asynccontextmanager
async def lifespan(_: FastAPI):
    get_results()
    yield


app = FastAPI(title="MuleRadar", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=os.getenv(
        "MULERADAR_CORS_ORIGINS",
        "http://localhost:5173,http://127.0.0.1:5173,http://localhost:4173,http://127.0.0.1:4173",
    ).split(","),
    allow_methods=["*"],
    allow_headers=["*"],
)


class AskBody(BaseModel):
    question: str


def _case(case_id: str):
    case = get_results().by_id.get(case_id)
    if case is None:
        raise HTTPException(status_code=404, detail=f"Case {case_id} not found")
    return case


@app.get("/cases")
def list_cases():
    return [case_summary(c) for c in get_results().cases]


@app.get("/cases/{case_id}")
def get_case(case_id: str):
    return case_detail(_case(case_id))


@app.get("/metrics")
def metrics():
    return get_results().metrics


@app.post("/cases/{case_id}/ask")
def ask(case_id: str, body: AskBody):
    return {"answer": answer_question(case_detail(_case(case_id)), body.question)}


@app.post("/cases/{case_id}/report")
def report(case_id: str):
    text, generated_by = draft_report_with_source(case_detail(_case(case_id)))
    return {"report": text, "generated_by": generated_by}
