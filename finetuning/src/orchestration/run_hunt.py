"""
End-to-end hunt run for a single company: scan → findings → push.

Called by the hunt cron (inngest_functions.py) and by scripts for manual runs.
This is what closes the Hunt → Push loop (spec Sections 10 + 16): the hunt
engine produces findings, and findings above the push threshold are delivered
to the relevant agents' inboxes immediately.
"""

from __future__ import annotations

import logging

import src.db as db
from src.brain.hunter import run_all_hunts
from src.push.delivery import push_finding_to_agents

logger = logging.getLogger(__name__)

# Findings at/above this confidence are auto-pushed; below stay 'open' for review.
AUTO_PUSH_CONFIDENCE = 0.75


def run_hunt_for_company(company_id: str) -> dict:
    """
    Run all 5 hunt modes, then auto-push high-confidence findings.

    Returns {"findings_created": int, "pushes_sent": int, "by_mode": {...}}.
    """
    client = db.db()

    # ── 1. Run all hunt modes ──────────────────────────────────────────────────
    by_mode = run_all_hunts(company_id, client)
    all_ids = [fid for ids in by_mode.values() for fid in ids]
    logger.info("company=%s hunt produced %d findings.", company_id, len(all_ids))

    if not all_ids:
        return {"findings_created": 0, "pushes_sent": 0, "by_mode": by_mode}

    # ── 2. Fetch the freshly created findings ──────────────────────────────────
    resp = (
        client
        .table("cb_hunt_findings")
        .select("*")
        .eq("company_id", company_id)
        .in_("id", all_ids)
        .execute()
    )
    findings = resp.data or []

    # ── 3. Auto-push high-confidence findings ──────────────────────────────────
    pushes_sent = 0
    for finding in findings:
        if finding.get("confidence", 0) >= AUTO_PUSH_CONFIDENCE:
            pushes_sent += push_finding_to_agents(company_id, finding, client)

    logger.info(
        "company=%s hunt complete: %d findings, %d pushes sent.",
        company_id, len(findings), pushes_sent,
    )
    return {
        "findings_created": len(findings),
        "pushes_sent": pushes_sent,
        "by_mode": by_mode,
    }
