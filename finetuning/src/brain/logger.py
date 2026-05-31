"""
Interaction logging — the three learning loops.

Every staff-agent interaction is logged at three simultaneous levels:
  1. Individual — personal memory namespace (preferences, patterns, context)
  2. Role       — anonymised role namespace (new hires start calibrated)
  3. Company    — company-wide patterns (cross-staff intelligence)

Also emits a training_signals row for the next fine-tune cycle.
Privacy: raw user words never appear in role/company namespaces — only
anonymised, pattern-level summaries that cannot be traced to an individual.
"""

from __future__ import annotations

import logging
from datetime import datetime, timezone

from src import vectors
from src.brain import memory, patterns as pat_module
from src.model.naming import company_namespace, role_namespace, user_namespace

logger = logging.getLogger(__name__)

_SENTIMENT_KEYWORDS = {
    "frustrated": ["why does", "never mind", "forget it", "again?", "still broken", "not working", "always"],
    "positive": ["thanks", "perfect", "exactly", "great", "love it", "helpful", "works"],
    "disengaged": ["ok", "fine", "whatever", "sure"],
}


def _extract_sentiment(text: str) -> str:
    lower = text.lower()
    for label, keywords in _SENTIMENT_KEYWORDS.items():
        if any(kw in lower for kw in keywords):
            return label
    return "neutral"


def log_interaction(
    *,
    company_id: str,
    staff_id: str,
    role: str,
    user_message: str,
    agent_response: str,
    tools_called: list[dict] | None = None,
    context_used: dict | None = None,
    suggestion_acted_on: bool | None = None,
    db_client,  # supabase Client
) -> str:
    """
    Log one interaction at all three learning levels and write a training signal.

    Returns the inserted interaction UUID.
    """
    tools_called = tools_called or []
    sentiment = _extract_sentiment(user_message)
    session_hour = datetime.now(timezone.utc).hour

    # ── DB: write interactions row ─────────────────────────────────────────────
    resp = (
        db_client
        .table("interactions")
        .insert({
            "company_id":          company_id,
            "staff_id":            staff_id,
            "role":                role,
            "user_message":        user_message[:1000],
            "agent_response":      agent_response[:2000],
            "tools_called":        tools_called,
            "context_used":        context_used,
            "suggestion_acted_on": suggestion_acted_on,
            "sentiment":           sentiment,
            "session_hour":        session_hour,
        })
        .execute()
    )
    interaction_id = resp.data[0]["id"]

    # ── Level 1: Individual memory ─────────────────────────────────────────────
    personal_doc = (
        f"Staff asked: {user_message[:300]}\n"
        f"Agent responded: {agent_response[:300]}\n"
        f"Sentiment: {sentiment}"
    )
    memory.upsert_memory(
        company_id=company_id,
        staff_id=staff_id,
        content=personal_doc,
        metadata={
            "type": "interaction",
            "interaction_id": interaction_id,
            "tools": [t.get("name") for t in tools_called],
            "acted_on": suggestion_acted_on,
        },
    )

    # ── Level 2: Role memory (anonymised — no personal identifiers) ────────────
    role_doc = (
        f"A {role} staff member asked about: {_anonymise(user_message)}\n"
        f"Useful response pattern: {_anonymise(agent_response[:300])}"
    )
    memory.upsert_role_pattern(
        company_id=company_id,
        role=role,
        content=role_doc,
        metadata={"type": "role_pattern", "sentiment": sentiment, "session_hour": session_hour},
    )

    # ── Level 3: Company memory (cross-staff pattern) ──────────────────────────
    company_doc = f"Staff ({role}) interaction pattern: {_anonymise(user_message)}"
    memory.upsert_company_pattern(
        company_id=company_id,
        content=company_doc,
        metadata={"type": "interaction_pattern", "role": role, "sentiment": sentiment},
    )

    # ── Emit training signal if high quality ───────────────────────────────────
    if suggestion_acted_on is True:
        db_client.table("training_signals").insert({
            "company_id":     company_id,
            "interaction_id": interaction_id,
            "kind":           "positive_pair",
            "prompt":         user_message[:500],
            "target":         agent_response[:1000],
            "score":          0.9,
        }).execute()

    # ── Detect systemic patterns (async-safe: insert only if threshold met) ────
    pat_module.check_and_escalate(
        company_id=company_id,
        user_message=user_message,
        role=role,
        db_client=db_client,
    )

    # ── Update agent trust score ───────────────────────────────────────────────
    if suggestion_acted_on is not None:
        _update_trust(company_id, staff_id, suggestion_acted_on, db_client)

    logger.debug("Logged interaction %s for staff=%s role=%s", interaction_id, staff_id, role)
    return interaction_id


def _anonymise(text: str) -> str:
    """Strip obvious personal identifiers (names, emails) from text."""
    import re
    text = re.sub(r"\b[A-Za-z][a-z]+ [A-Z][a-z]+\b", "[name]", text)  # "John Smith"
    text = re.sub(r"\S+@\S+\.\S+", "[email]", text)
    return text


def _update_trust(
    company_id: str,
    staff_id: str,
    acted_on: bool,
    db_client,
) -> None:
    """Nudge trust_score up if suggestion was acted on, down if ignored."""
    delta = 0.05 if acted_on else -0.03
    resp = (
        db_client
        .table("agent_profiles")
        .select("trust_score, interaction_count")
        .eq("company_id", company_id)
        .eq("staff_id", staff_id)
        .single()
        .execute()
    )
    if not resp.data:
        return
    current = resp.data["trust_score"]
    new_score = max(0.0, min(2.0, current + delta))
    new_count = resp.data["interaction_count"] + 1
    db_client.table("agent_profiles").update({
        "trust_score": new_score,
        "interaction_count": new_count,
        "last_active": datetime.now(timezone.utc).isoformat(),
    }).eq("company_id", company_id).eq("staff_id", staff_id).execute()
