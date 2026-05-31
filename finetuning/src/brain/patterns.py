"""
Cross-staff systemic pattern detection.

When ≥ 3 distinct staff members ask semantically similar things within 30 days,
this is a company-wide gap — not a personal question. This module detects
those patterns and escalates them as Knowledge or Waste hunt findings.

Privacy: the detection algorithm works on anonymised message summaries stored
in the company vector namespace. The finding record never contains individual
staff IDs or quoted private words.
"""

from __future__ import annotations

import logging
from datetime import datetime, timedelta, timezone

from src import vectors
from src.model.naming import company_namespace

logger = logging.getLogger(__name__)

# Minimum distinct staff members asking about a topic before escalating
PATTERN_THRESHOLD = 3
# How many days back to look for similar questions
PATTERN_WINDOW_DAYS = 30
# Minimum semantic similarity to group two questions together
SIMILARITY_THRESHOLD = 0.78


def check_and_escalate(
    company_id: str,
    user_message: str,
    role: str,
    db_client,
) -> bool:
    """
    Check if this message matches an emerging cross-staff pattern.
    If it tips the threshold, create a Knowledge hunt finding.

    Returns True if a new finding was created.
    """
    try:
        return _check_and_escalate_inner(company_id, user_message, role, db_client)
    except Exception as exc:
        logger.warning("Pattern check failed (non-fatal): %s", exc)
        return False


def _check_and_escalate_inner(
    company_id: str,
    user_message: str,
    role: str,
    db_client,
) -> bool:
    # Search company namespace for semantically similar questions
    ns = company_namespace(company_id)
    similar = vectors.search(
        company_id=company_id,
        namespace=ns,
        query=user_message,
        top_k=20,
    )

    # Filter to "interaction_pattern" docs above similarity threshold
    cutoff = datetime.now(timezone.utc) - timedelta(days=PATTERN_WINDOW_DAYS)
    pattern_matches = [
        r for r in similar
        if r["score"] >= SIMILARITY_THRESHOLD
        and r["metadata"].get("type") == "interaction_pattern"
    ]

    if len(pattern_matches) < PATTERN_THRESHOLD - 1:
        # Not enough similar questions yet
        return False

    # Extract a representative pattern phrase from the top match
    top_match = pattern_matches[0]
    topic = _extract_topic(top_match["content"])

    # Check if a finding for this topic already exists (deduplicate)
    existing = (
        db_client
        .table("cb_hunt_findings")
        .select("id")
        .eq("company_id", company_id)
        .eq("mode", "knowledge")
        .ilike("detail", f"%{topic[:30]}%")
        .neq("status", "dismissed")
        .execute()
    )
    if existing.data:
        return False

    # Create a knowledge hunt finding
    occurrences = len(pattern_matches) + 1  # +1 for the current message
    db_client.table("cb_hunt_findings").insert({
        "company_id": company_id,
        "mode": "knowledge",
        "title": f"Knowledge gap: multiple staff asking about '{topic}'",
        "detail": (
            f"{occurrences} team members have asked similar questions about '{topic}' "
            f"in the last {PATTERN_WINDOW_DAYS} days. This topic may not be well-documented "
            f"or easily discoverable."
        ),
        "evidence": {
            "occurrences": occurrences,
            "sample_roles": list({r["metadata"].get("role", role) for r in pattern_matches[:5]}),
        },
        "confidence": min(0.95, 0.5 + occurrences * 0.08),
        "target_role": None,  # affects all roles equally
        "status": "open",
    }).execute()

    logger.info(
        "company=%s NEW knowledge finding: '%s' (%d occurrences)",
        company_id, topic, occurrences,
    )
    return True


def _extract_topic(content: str) -> str:
    """Extract the core topic phrase from an interaction_pattern document."""
    # Pattern docs look like: "Staff (role) interaction pattern: <question>"
    parts = content.split("interaction pattern:", 1)
    if len(parts) == 2:
        return parts[1].strip()[:80]
    return content[:80]
