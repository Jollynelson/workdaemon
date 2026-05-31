"""
The Hunt Engine — 5 proactive scanning modes.

Each mode is a scheduled job (every 15min–1hr via Inngest) that:
  1. Queries tool data + interaction signals for this company
  2. Runs an LLM reasoning pass (Claude, using retrieved context)
  3. Emits cb_hunt_findings rows with confidence + recommended action
  4. Triggers pushes for high-confidence findings

The four golden examples from the vision doc are implemented as tests in
tests/test_patterns.py: sales churn, ops bottleneck, CEO brief, HR burnout.

Privacy: findings reference patterns and signals, never raw personal words.
HR-style findings (burnout/flight risk) go to authorized roles only.
"""

from __future__ import annotations

import logging
from datetime import datetime, timedelta, timezone

import anthropic

from src.config import settings

logger = logging.getLogger(__name__)

_HUNT_MODES = ("threat", "waste", "opportunity", "performance", "knowledge")

_MODE_SYSTEM_PROMPTS = {
    "threat": (
        "You are a threat analyst for a company. "
        "Given the following signals, identify the most important risks: "
        "churn signals in CRM, cash flow dangers, staff dissatisfaction, security anomalies. "
        "Output a JSON list of findings, each: "
        '{"title": str, "detail": str, "confidence": 0-1, "target_role": str|null, '
        '"recommended_action": str}. '
        "Only include findings with confidence ≥ 0.6."
    ),
    "waste": (
        "You are a waste analyst for a company. "
        "Identify inefficiencies: redundant approval steps, duplicated work, unused tools, "
        "meetings that could be messages, time spent on low-value activities. "
        "Output a JSON list: "
        '{"title": str, "detail": str, "confidence": 0-1, "estimated_saving": str, '
        '"recommended_action": str}. '
        "Confidence ≥ 0.6 only."
    ),
    "opportunity": (
        "You are an opportunity analyst for a company. "
        "Identify upsell signals, partnership angles, underutilised talent, expansion openings. "
        "Output a JSON list: "
        '{"title": str, "detail": str, "confidence": 0-1, "target_role": str|null, '
        '"recommended_action": str}. '
        "Confidence ≥ 0.6 only."
    ),
    "performance": (
        "You are a performance analyst for a company. "
        "Identify over/under-performers, processes worth replicating, burnout signals, "
        "overload indicators from work-hour patterns and interaction data. "
        "Output a JSON list: "
        '{"title": str, "detail": str, "confidence": 0-1, "target_staff_hint": str|null, '
        '"recommended_action": str}. '
        "Confidence ≥ 0.6. Never name individuals in 'detail' — use role descriptors."
    ),
    "knowledge": (
        "You are a knowledge-gap analyst for a company. "
        "Identify topics staff repeatedly ask about that should be documented, "
        "decisions never recorded, or strategies poorly communicated. "
        "Output a JSON list: "
        '{"title": str, "detail": str, "confidence": 0-1, '
        '"recommended_action": str}. '
        "Confidence ≥ 0.6 only."
    ),
}


def run_hunt(
    company_id: str,
    mode: str,
    db_client,
    signals: dict | None = None,
) -> list[str]:
    """
    Run one hunt mode for a company.

    Args:
        company_id: Company UUID.
        mode: One of 'threat', 'waste', 'opportunity', 'performance', 'knowledge'.
        db_client: Supabase client.
        signals: Pre-fetched signal data dict (if None, we fetch defaults here).

    Returns list of created finding IDs.
    """
    if mode not in _HUNT_MODES:
        raise ValueError(f"Unknown hunt mode: {mode}")

    signal_text = _gather_signals(company_id, mode, db_client, signals or {})
    if not signal_text.strip():
        logger.info("company=%s mode=%s: no signals — skipping.", company_id, mode)
        return []

    findings_raw = _run_llm_reasoning(mode, signal_text)
    return _persist_findings(company_id, mode, findings_raw, db_client)


def run_all_hunts(company_id: str, db_client) -> dict[str, list[str]]:
    """Run all 5 hunt modes. Called by the scheduled Inngest job."""
    results = {}
    for mode in _HUNT_MODES:
        finding_ids = run_hunt(company_id, mode, db_client)
        results[mode] = finding_ids
        logger.info("company=%s mode=%s: %d findings.", company_id, mode, len(finding_ids))
    return results


# ── Signal gathering ──────────────────────────────────────────────────────────

def _gather_signals(
    company_id: str,
    mode: str,
    db_client,
    extra: dict,
) -> str:
    """Fetch signals relevant to this hunt mode from DB + vector store."""
    parts: list[str] = []

    # Interaction signals (last 7 days)
    cutoff = (datetime.now(timezone.utc) - timedelta(days=7)).isoformat()
    interactions = (
        db_client
        .table("interactions")
        .select("role, user_message, sentiment, session_hour")
        .eq("company_id", company_id)
        .gte("created_at", cutoff)
        .order("created_at", desc=True)
        .limit(100)
        .execute()
    ).data or []

    if interactions:
        parts.append("RECENT INTERACTIONS (last 7 days):")
        for row in interactions[:30]:  # cap to avoid token overflow
            parts.append(
                f"  [{row['role']}] sentiment={row['sentiment']} hour={row['session_hour']}: "
                f"{row['user_message'][:120]}"
            )

    # Open hunt findings (context — what we already know)
    existing = (
        db_client
        .table("cb_hunt_findings")
        .select("mode, title, detail")
        .eq("company_id", company_id)
        .eq("mode", mode)
        .neq("status", "dismissed")
        .order("created_at", desc=True)
        .limit(5)
        .execute()
    ).data or []

    if existing:
        parts.append(f"\nEXISTING {mode.upper()} FINDINGS (for context, avoid duplicating):")
        for f in existing:
            parts.append(f"  - {f['title']}: {f['detail'][:120]}")

    # Any extra signals passed in (tool data from CRM, finance, HR, etc.)
    for key, value in extra.items():
        if value:
            parts.append(f"\n{key.upper()} DATA:\n{str(value)[:500]}")

    return "\n".join(parts)


# ── LLM reasoning ─────────────────────────────────────────────────────────────

def _run_llm_reasoning(mode: str, signal_text: str) -> list[dict]:
    """Run Claude on the signals and parse the findings JSON."""
    import json

    client = anthropic.Anthropic(api_key=settings.anthropic_api_key)
    system = _MODE_SYSTEM_PROMPTS[mode]
    user = f"Analyse these signals and return findings as JSON:\n\n{signal_text}"

    try:
        resp = client.messages.create(
            model=settings.fallback_model,
            max_tokens=1024,
            system=system,
            messages=[{"role": "user", "content": user}],
        )
        text = resp.content[0].text.strip()
        # Extract JSON array
        import re
        match = re.search(r"\[.*\]", text, re.DOTALL)
        if match:
            return json.loads(match.group())
        return []
    except Exception as exc:
        logger.warning("Hunt LLM reasoning failed (mode=%s): %s", mode, exc)
        return []


# ── Persistence ───────────────────────────────────────────────────────────────

def _persist_findings(
    company_id: str,
    mode: str,
    findings_raw: list[dict],
    db_client,
) -> list[str]:
    """Write valid findings to cb_hunt_findings. Returns list of inserted IDs."""
    ids = []
    for f in findings_raw:
        if not isinstance(f, dict):
            continue
        confidence = float(f.get("confidence", 0))
        if confidence < 0.6:
            continue

        # Deduplicate: skip if a very similar title exists
        title = str(f.get("title", ""))[:200]
        exists = (
            db_client
            .table("cb_hunt_findings")
            .select("id")
            .eq("company_id", company_id)
            .eq("mode", mode)
            .ilike("title", f"%{title[:30]}%")
            .neq("status", "dismissed")
            .execute()
        ).data
        if exists:
            continue

        resp = db_client.table("cb_hunt_findings").insert({
            "company_id":  company_id,
            "mode":        mode,
            "title":       title,
            "detail":      str(f.get("detail", ""))[:1000],
            "evidence":    {"raw": f},
            "confidence":  confidence,
            "target_role": f.get("target_role"),
            "status":      "open",
        }).execute()
        if resp.data:
            ids.append(resp.data[0]["id"])
    return ids
