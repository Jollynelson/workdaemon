"""Scheduled brain jobs (FINAL spec Section 16) — plain callables.

Each job is a function over one company_id, assembled from the modules already
built. They're scheduler-agnostic: a cron/Inngest/Celery trigger, a test, or the
manual runner all just call them. The fan-out helper runs a job across all active
companies (cap concurrency at the scheduler).

Jobs:
  nightly_deep_pass  — once/night/company: DeepSeek Pro 1M-ctx deep hunt
  hourly_patterns    — cross-staff pattern detection
  intraday_hunts     — the fast hunt modes (threat/waste/knowledge) on cadence
"""

from __future__ import annotations

from typing import Callable

from src.brain.activity_feed import ActivityFeed
from src.brain.hunter import HUNT_SCHEDULE, HuntEngine
from src.brain.patterns import PatternDetector
from src.brain.router import default_router
from src.db import CompanyDB, supabase_client


def _hunt_engine(company_id: str, assemble_context: Callable[[str], str] | None = None,
                 push=None) -> HuntEngine:
    db = CompanyDB(company_id)
    ctx = assemble_context or _default_hunt_context(company_id)
    return HuntEngine(db, default_router(), ActivityFeed(db), assemble_context=ctx, push=push)


def _default_hunt_context(company_id: str):
    """RAG-assembled hunt context, or a minimal DB summary if RAG is off."""
    from src.api.deps import brain_context

    bc = brain_context(company_id, "the company")
    if bc:
        return lambda mode: bc.get_for_hunt(mode)
    return lambda mode: f"(no retrieval configured) hunt mode: {mode}"


def nightly_deep_pass(company_id: str) -> dict:
    """Once per night per company — the Pro deep pass over whole-company context."""
    findings = _hunt_engine(company_id).nightly_deep_pass()
    return {"company_id": company_id, "job": "nightly_deep_pass", "findings": len(findings)}


def intraday_hunts(company_id: str) -> dict:
    """Run the fast-tier hunt modes (cadence is enforced by the scheduler)."""
    eng = _hunt_engine(company_id)
    ran = {}
    for mode, cfg in HUNT_SCHEDULE.items():
        if cfg["depth"] == "fast":
            ran[mode] = len(eng.run_hunt(mode).findings)
    return {"company_id": company_id, "job": "intraday_hunts", "by_mode": ran}


def hourly_patterns(company_id: str, cluster_fn: Callable | None = None) -> dict:
    """Cross-staff pattern detection. cluster_fn defaults to semantic clustering."""
    db = CompanyDB(company_id)
    cf = cluster_fn or _default_cluster_fn(company_id)
    det = PatternDetector(db, default_router(), ActivityFeed(db), cluster_fn=cf)
    created = det.detect()
    return {"company_id": company_id, "job": "hourly_patterns", "patterns": len(created)}


def _default_cluster_fn(company_id: str):
    """Semantic clustering over recent interactions via the local embedder.

    Falls back to no clusters if embeddings aren't available, so the job never
    crashes — it just finds nothing until retrieval is configured.
    """
    def cluster(interactions: list[dict]):
        try:
            from src.brain.vector_store import default_embedder

            return _greedy_semantic_clusters(default_embedder(), interactions)
        except Exception:
            return []

    return cluster


def _greedy_semantic_clusters(embedder, interactions: list[dict], threshold: float = 0.82):
    """Cheap greedy clustering by cosine similarity of user_message embeddings."""
    from src.brain.patterns import Cluster

    def cos(a, b):
        import math

        dot = sum(x * y for x, y in zip(a, b))
        na = math.sqrt(sum(x * x for x in a)) or 1.0
        nb = math.sqrt(sum(y * y for y in b)) or 1.0
        return dot / (na * nb)

    items = [(i, embedder.embed(i.get("user_message", ""))) for i in interactions
             if i.get("user_message")]
    used, clusters = set(), []
    for idx, (item, vec) in enumerate(items):
        if idx in used:
            continue
        members = [item]
        ids = [item.get("staff_id")]
        iids = [item.get("id")]
        for jdx in range(idx + 1, len(items)):
            if jdx in used:
                continue
            other, ovec = items[jdx]
            if cos(vec, ovec) >= threshold:
                used.add(jdx)
                members.append(other)
                ids.append(other.get("staff_id"))
                iids.append(other.get("id"))
        if len({*ids}) >= 3:
            clusters.append(Cluster(interaction_ids=iids, staff_ids=ids,
                                    sample_messages=[m.get("user_message", "") for m in members[:5]]))
    return clusters


# ── Fan-out across companies ────────────────────────────────────────────────────
def active_company_ids() -> list[str]:
    resp = supabase_client().table("companies").select("id").execute()
    return [r["id"] for r in (getattr(resp, "data", None) or [])]


def fan_out(job: Callable[[str], dict], company_ids: list[str] | None = None) -> list[dict]:
    """Run a job over many companies. Concurrency is the scheduler's concern;
    this is sequential + isolated (one company_id per call → one Brain call per
    company, never mixed)."""
    out = []
    for cid in (company_ids if company_ids is not None else active_company_ids()):
        try:
            out.append(job(cid))
        except Exception as exc:
            out.append({"company_id": cid, "job": getattr(job, "__name__", "?"),
                        "error": str(exc)[:200]})
    return out
