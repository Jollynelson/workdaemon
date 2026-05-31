from __future__ import annotations

from datetime import datetime, timedelta, timezone

from supabase import Client, create_client

from src.config import settings

_client: Client | None = None


def db() -> Client:
    global _client
    if _client is None:
        _client = create_client(settings.supabase_url, settings.supabase_service_key)
    return _client


def _since(hours: int) -> str:
    return (datetime.now(timezone.utc) - timedelta(hours=hours)).isoformat()


# ── Training-signal readers (canonical companies schema, spec Section 5) ───────
# Every function takes company_id as its first argument and filters on it.
# This is the structural isolation guarantee — no function can return another
# company's data. The fine-tune pipeline reads exclusively from training_signals
# (populated by brain/logger.py); facts live in retrieval, behavior in signals.


def get_unused_training_signals(company_id: str, window_hours: int) -> list[dict]:
    """
    Training signals emitted by the interaction logger that have not yet been
    consumed by a deployed fine-tune. The canonical dataset source per
    spec Section 6.2 ("Build a per-company JSONL from training_signals").
    """
    resp = (
        db()
        .table("training_signals")
        .select("*")
        .eq("company_id", company_id)
        .is_("used_in_version", "null")
        .gte("created_at", _since(window_hours))
        .execute()
    )
    return resp.data


def get_eval_training_signals(company_id: str, window_hours: int) -> list[dict]:
    """
    All training signals in the window, regardless of used_in_version. The gate
    filters these to the deterministic ~10% eval holdout (which is never trained
    on, so held-out signals are never marked used and remain a stable eval set).
    """
    resp = (
        db()
        .table("training_signals")
        .select("*")
        .eq("company_id", company_id)
        .gte("created_at", _since(window_hours))
        .execute()
    )
    return resp.data


def mark_signals_used(company_id: str, signal_ids: list[str], version: int) -> None:
    """Stamp consumed training signals with the deployed version that used them."""
    if not signal_ids:
        return
    (
        db()
        .table("training_signals")
        .update({"used_in_version": version})
        .eq("company_id", company_id)
        .in_("id", signal_ids)
        .execute()
    )


def get_company_terminology(company_id: str) -> list[dict]:
    """All terminology for the company (no time window — always included)."""
    resp = (
        db()
        .table("cb_company_terminology")
        .select("*")
        .eq("company_id", company_id)
        .execute()
    )
    return resp.data


# ── Company / model-version helpers (canonical companies schema) ───────────────


def get_company_name(company_id: str) -> str:
    """Company name from the canonical `companies` table."""
    resp = (
        db()
        .table("companies")
        .select("name")
        .eq("id", company_id)
        .single()
        .execute()
    )
    return resp.data["name"]


def get_active_companies() -> list[str]:
    """All companies — every company gets a fine-tune + hunt run each cycle."""
    resp = db().table("companies").select("id").execute()
    return [row["id"] for row in resp.data]


def get_deployed_version(company_id: str) -> dict | None:
    """Most recent deployed adapter for this company, or None."""
    resp = (
        db()
        .table("model_versions")
        .select("*")
        .eq("company_id", company_id)
        .eq("deployed", True)
        .order("version", desc=True)
        .limit(1)
        .execute()
    )
    return resp.data[0] if resp.data else None


def get_next_version_number(company_id: str) -> int:
    """Next monotonically increasing version number for this company."""
    resp = (
        db()
        .table("model_versions")
        .select("version")
        .eq("company_id", company_id)
        .order("version", desc=True)
        .limit(1)
        .execute()
    )
    return (resp.data[0]["version"] + 1) if resp.data else 1


def insert_model_version(
    *,
    company_id: str,
    version: int,
    hf_repo: str,
    hf_revision: str,
    eval_score: float | None,
    deployed: bool,
    num_examples: int,
) -> dict:
    resp = (
        db()
        .table("model_versions")
        .insert(
            {
                "company_id": company_id,
                "version": version,
                "hf_repo": hf_repo,
                "hf_revision": hf_revision,
                "eval_score": eval_score,
                "deployed": deployed,
                "num_examples": num_examples,
            }
        )
        .execute()
    )
    return resp.data[0]


def mark_version_deployed(version_id: str) -> None:
    db().table("model_versions").update({"deployed": True}).eq("id", version_id).execute()
