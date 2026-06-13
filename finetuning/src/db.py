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


# ── Live WorkDaemon brain (Phase 2) ────────────────────────────────────────────
# The trainer reads the SAME tables the live app fills, so a company's real data
# becomes its model's training set. company_id == the live workspace_id.


def get_daemon_conversations(company_id: str, window_hours: int, limit: int = 600) -> list[dict]:
    """Recent daemon chat turns for this workspace (role + content), chronological.
    Paired user→assistant by the dataset builder."""
    resp = (
        db()
        .table("daemon_messages")
        .select("role, content, created_at")
        .eq("workspace_id", company_id)
        .gte("created_at", _since(window_hours))
        .order("created_at")
        .limit(limit)
        .execute()
    )
    return resp.data or []


def get_accepted_actions(company_id: str, window_hours: int, limit: int = 200) -> list[dict]:
    """Human-ACCEPTED daemon actions — the reward signal. Approved/applied/done
    outputs are what the user kept, so they're positive training targets."""
    resp = (
        db()
        .table("daemon_actions")
        .select("type, title, body, result, status, created_at")
        .eq("workspace_id", company_id)
        .in_("status", ["approved", "applied", "done", "executed", "completed"])
        .gte("created_at", _since(window_hours))
        .order("created_at")
        .limit(limit)
        .execute()
    )
    return resp.data or []


def get_brain_skills(company_id: str, limit: int = 60) -> list[dict]:
    """This workspace's LEARNED skills (how the company operates)."""
    resp = (
        db()
        .table("brain_skills")
        .select("name, trigger_description, body, status")
        .eq("workspace_id", company_id)
        .eq("status", "active")
        .limit(limit)
        .execute()
    )
    return resp.data or []


def get_workspace_documents(company_id: str, limit: int = 200) -> list[dict]:
    """The company's brain CORPUS (Slack history + docs) — the raw material the
    Q&A synthesizer mines into training pairs (Phase 2.5). EXCLUDES restricted docs:
    a per-company model trained on staff-scoped content could surface it to anyone,
    so only workspace-visible/public docs feed training."""
    resp = (
        db()
        .table("workspace_documents")
        .select("source, title, content, visibility")
        .eq("workspace_id", company_id)
        .or_("visibility.is.null,visibility.eq.public,visibility.eq.workspace")
        .limit(limit)
        .execute()
    )
    return [r for r in (resp.data or []) if (r.get("content") or "").strip()]


# ── Company / model-version helpers (live `workspaces` schema) ──────────────────


def get_company_name(company_id: str) -> str:
    """Company name from the live `workspaces` table (== the app's workspace)."""
    resp = (
        db()
        .table("workspaces")
        .select("name")
        .eq("id", company_id)
        .single()
        .execute()
    )
    return resp.data["name"]


def get_active_companies() -> list[str]:
    """All live workspaces — each gets a fine-tune cycle once it has enough data
    (run_company gates on MIN_EXAMPLES_TO_TRAIN)."""
    resp = db().table("workspaces").select("id").execute()
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


def promote_version(version_id: str, company_id: str) -> None:
    """Make `version_id` the single deployed adapter for the company: un-deploy every
    other version first, then deploy this one. Keeps exactly one row deployed so the
    serve's deployed=True lookup is unambiguous (and the previous model is the clean
    rollback target if a later gate fails)."""
    client = db()
    client.table("model_versions").update({"deployed": False}).eq(
        "company_id", company_id
    ).neq("id", version_id).execute()
    client.table("model_versions").update({"deployed": True}).eq("id", version_id).execute()


def set_version_eval_score(version_id: str, score: float | None) -> None:
    """Record the gate's score on a version row (deployed or not), for the registry."""
    db().table("model_versions").update({"eval_score": score}).eq("id", version_id).execute()


def set_version_base_score(version_id: str, score: float | None) -> None:
    """Record the shared-brain baseline score the candidate was measured against —
    so the registry shows, per version, how the fine-tune compared to the base model."""
    db().table("model_versions").update({"base_score": score}).eq("id", version_id).execute()


def count_daemon_messages_since(workspace_id: str, since_iso: str | None) -> int:
    """How many daemon_messages a workspace has logged since `since_iso` (its last
    train time). None → all-time. Drives the retrain cron: a company is worth a new
    GPU cycle only once its brain has meaningfully grown."""
    q = (
        db()
        .table("daemon_messages")
        .select("id", count="exact")
        .eq("workspace_id", workspace_id)
    )
    if since_iso:
        q = q.gt("created_at", since_iso)
    return q.execute().count or 0
