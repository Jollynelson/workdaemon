"""Brain endpoints — hunt engine, findings, ingestion trigger."""

from __future__ import annotations

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from src.brain.hunter import run_all_hunts, run_hunt
from src.db import db
from src.ingestion.pipeline import ingest_document
from src.ingestion.normalize import normalize
from src.push.delivery import push_finding_to_agents

router = APIRouter()


@router.post("/{company_id}/hunt")
def run_hunt_endpoint(company_id: str, mode: str | None = None):
    """Run one or all hunt modes for a company."""
    client = db()
    if mode:
        if mode not in ("threat", "waste", "opportunity", "performance", "knowledge"):
            raise HTTPException(400, "Invalid hunt mode")
        finding_ids = run_hunt(company_id, mode, client)
        return {"mode": mode, "findings_created": len(finding_ids), "ids": finding_ids}
    else:
        results = run_all_hunts(company_id, client)
        total = sum(len(v) for v in results.values())
        return {"modes_run": list(results.keys()), "total_findings": total, "by_mode": results}


@router.get("/{company_id}/findings")
def get_findings(company_id: str, status: str = "open", limit: int = 30):
    client = db()
    resp = (
        client.table("cb_hunt_findings")
        .select("*")
        .eq("company_id", company_id)
        .eq("status", status)
        .order("confidence", desc=True)
        .order("created_at", desc=True)
        .limit(limit)
        .execute()
    )
    return resp.data or []


@router.post("/{company_id}/findings/{finding_id}/push")
def push_finding(company_id: str, finding_id: str):
    """Manually push a finding to the relevant agents."""
    client = db()
    resp = (
        client.table("cb_hunt_findings")
        .select("*")
        .eq("id", finding_id)
        .eq("company_id", company_id)
        .single()
        .execute()
    )
    if not resp.data:
        raise HTTPException(404, "Finding not found")
    count = push_finding_to_agents(company_id, resp.data, client)
    return {"pushed_to": count}


@router.post("/{company_id}/findings/{finding_id}/dismiss")
def dismiss_finding(company_id: str, finding_id: str):
    client = db()
    client.table("cb_hunt_findings").update({"status": "dismissed"}).eq(
        "id", finding_id
    ).eq("company_id", company_id).execute()
    return {"ok": True}


class IngestRequest(BaseModel):
    source: str
    doc_type: str = "document"
    content: str
    author: str = ""
    metadata: dict = {}


@router.post("/{company_id}/ingest")
def ingest(company_id: str, body: IngestRequest):
    """Ingest a single document into the company vector store."""
    doc = normalize(
        raw={"content": body.content, "author": body.author, **body.metadata},
        source=body.source,
        doc_type=body.doc_type,
        company_id=company_id,
    )
    chunks = ingest_document(doc, company_id)
    return {"chunks_ingested": chunks}
