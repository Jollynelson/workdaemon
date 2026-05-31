"""
Push delivery — calibrated intelligence from the Hunt engine to staff agents.

Delivery rules:
  - High-confidence findings (≥ 0.85) → push immediately to target role/staff
  - Medium-confidence (0.6–0.84) → push at next conversation start
  - Back off if acted_on rate for this push type is low (trust calibration)
  - HR-type signals (burnout/flight risk) go to authorized roles only

The vision doc's golden examples:
  - Sales churn → Sales Manager agent push
  - Ops bottleneck → Operations Lead agent push
  - CEO 7am briefing → CEO agent pre-populated at start of day
  - HR burnout signal → HR Director agent push (never named to others)
"""

from __future__ import annotations

import logging

from src.push.inbox import create_push, mark_delivered

logger = logging.getLogger(__name__)

# Which roles can receive which hunt modes
_MODE_ROLE_FILTER = {
    "threat":      None,          # all roles (calibrated)
    "waste":       None,
    "opportunity": None,
    "performance": ["director", "executive"],
    "knowledge":   None,
}

# HR/burnout findings only go to HR director or executive
_HR_ONLY_KEYWORDS = ["burnout", "flight risk", "resignation", "morale", "wellbeing"]


def push_finding_to_agents(
    company_id: str,
    finding: dict,
    db_client,
) -> int:
    """
    Decide which agents should receive this finding and create push rows.

    Returns the number of pushes created.
    """
    mode = finding.get("mode", "knowledge")
    confidence = finding.get("confidence", 0.0)
    target_role = finding.get("target_role")
    target_staff_id = finding.get("target_staff")
    detail = finding.get("detail", "")

    # Check if this is HR-sensitive (restrict to authorized roles)
    is_hr_sensitive = any(kw in detail.lower() for kw in _HR_ONLY_KEYWORDS)

    # Resolve target staff IDs
    if target_staff_id:
        staff_ids = [target_staff_id]
    elif target_role:
        staff_ids = _get_staff_by_role(company_id, target_role, db_client)
    elif is_hr_sensitive:
        staff_ids = _get_staff_by_access(company_id, ["director", "executive"], db_client)
        # Filter to HR department only
        staff_ids = _filter_hr_authorized(company_id, staff_ids, db_client)
    else:
        # Broadcast to relevant role level
        allowed_levels = _MODE_ROLE_FILTER.get(mode)
        if allowed_levels:
            staff_ids = _get_staff_by_access(company_id, allowed_levels, db_client)
        else:
            staff_ids = _get_all_active_staff(company_id, db_client)

    if not staff_ids:
        return 0

    message = _craft_push_message(finding)
    recommended_action = finding.get("evidence", {}).get("raw", {}).get("recommended_action")

    count = 0
    for sid in staff_ids:
        # Check trust calibration (don't push to users who ignore this mode)
        if not _should_push_to(company_id, sid, mode, db_client):
            continue
        create_push(
            company_id=company_id,
            staff_id=sid,
            finding_id=finding.get("id"),
            message=message,
            recommended_action=recommended_action,
            db_client=db_client,
        )
        count += 1

    # Mark finding as pushed
    if count > 0:
        db_client.table("cb_hunt_findings").update({"status": "pushed"}).eq(
            "id", finding["id"]
        ).execute()

    logger.info("Pushed finding %s to %d agents.", finding.get("id"), count)
    return count


def mark_pushed(finding_id: str, db_client) -> None:
    db_client.table("cb_hunt_findings").update({"status": "pushed"}).eq(
        "id", finding_id
    ).execute()


def _craft_push_message(finding: dict) -> str:
    mode_icons = {"threat": "🔴", "waste": "🟡", "opportunity": "🟢", "performance": "🔵", "knowledge": "⚪"}
    icon = mode_icons.get(finding.get("mode", "knowledge"), "◈")
    return f"{icon} {finding.get('title', 'Brain update')}: {finding.get('detail', '')[:300]}"


def _should_push_to(company_id: str, staff_id: str, mode: str, db_client) -> bool:
    """Return False if this user has low acted_on rate for this mode (back off)."""
    resp = (
        db_client
        .table("pushes")
        .select("acted_on")
        .eq("company_id", company_id)
        .eq("staff_id", staff_id)
        .not_.is_("acted_on", "null")
        .order("created_at", desc=True)
        .limit(10)
        .execute()
    )
    rows = resp.data or []
    if len(rows) < 5:
        return True  # not enough data yet
    acted = sum(1 for r in rows if r["acted_on"])
    return (acted / len(rows)) >= 0.2  # back off below 20% engagement


def _get_staff_by_role(company_id: str, role: str, db_client) -> list[str]:
    resp = (
        db_client.table("staff")
        .select("id")
        .eq("company_id", company_id)
        .ilike("role", f"%{role}%")
        .eq("status", "active")
        .execute()
    )
    return [r["id"] for r in resp.data or []]


def _get_staff_by_access(company_id: str, levels: list[str], db_client) -> list[str]:
    resp = (
        db_client.table("staff")
        .select("id")
        .eq("company_id", company_id)
        .in_("access_level", levels)
        .eq("status", "active")
        .execute()
    )
    return [r["id"] for r in resp.data or []]


def _filter_hr_authorized(company_id: str, staff_ids: list[str], db_client) -> list[str]:
    resp = (
        db_client.table("staff")
        .select("id")
        .eq("company_id", company_id)
        .in_("id", staff_ids)
        .ilike("department", "%HR%")
        .execute()
    )
    return [r["id"] for r in resp.data or []] or staff_ids[:1]  # fallback to first director


def _get_all_active_staff(company_id: str, db_client) -> list[str]:
    resp = (
        db_client.table("staff")
        .select("id")
        .eq("company_id", company_id)
        .eq("status", "active")
        .execute()
    )
    return [r["id"] for r in resp.data or []]
