"""
Push inbox — Brain-initiated intelligence delivered to staff agents.

Pushes are created by the Hunt engine and delivered when the staff member
next opens their agent. Delivery respects trust calibration: users who
consistently ignore a push type get reduced frequency.
"""

from __future__ import annotations

import logging
from datetime import datetime, timezone

logger = logging.getLogger(__name__)


def create_push(
    company_id: str,
    staff_id: str,
    finding_id: str | None,
    message: str,
    recommended_action: str | None,
    db_client,
) -> str:
    """Insert a push into the pushes table. Returns the push ID."""
    resp = db_client.table("pushes").insert({
        "company_id":        company_id,
        "staff_id":          staff_id,
        "finding_id":        finding_id,
        "message":           message[:500],
        "recommended_action": recommended_action,
    }).execute()
    push_id = resp.data[0]["id"]
    logger.info("Push created %s → staff=%s", push_id, staff_id)
    return push_id


def get_pending_pushes(company_id: str, staff_id: str, db_client) -> list[dict]:
    """Return undelivered pushes for this staff member (newest first, max 5)."""
    resp = (
        db_client
        .table("pushes")
        .select("id, message, recommended_action, finding_id, cb_hunt_findings(mode, title)")
        .eq("company_id", company_id)
        .eq("staff_id", staff_id)
        .is_("delivered_at", "null")
        .order("created_at", desc=True)
        .limit(5)
        .execute()
    )
    return resp.data or []


def mark_delivered(push_id: str, db_client) -> None:
    """Mark a push as delivered to the agent UI."""
    db_client.table("pushes").update({
        "delivered_at": datetime.now(timezone.utc).isoformat()
    }).eq("id", push_id).execute()


def mark_acted_on(push_id: str, acted: bool, db_client) -> None:
    """Record whether the staff member acted on this push (trust calibration)."""
    db_client.table("pushes").update({"acted_on": acted}).eq("id", push_id).execute()
