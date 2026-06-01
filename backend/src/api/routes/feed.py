"""Activity feed + pushes routes — role-gated reads for the webapp."""

from __future__ import annotations

from fastapi import APIRouter

from src.api.deps import company_db

router = APIRouter()

# what each viewer role may see in the feed
_ROLE_VISIBILITY = {
    "executive": {"brain", "executives", "managers", "all"},
    "director": {"executives", "managers", "all"},
    "manager": {"managers", "all"},
    "junior": {"all"},
}


@router.get("/feed/{company_id}")
def activity_feed(company_id: str, viewer_level: str = "junior", limit: int = 50):
    db = company_db(company_id)
    resp = db.select("activity_events").order("created_at", desc=True).limit(limit).execute()
    rows = getattr(resp, "data", None) or []
    allowed = _ROLE_VISIBILITY.get(viewer_level, {"all"})
    visible = [r for r in rows if r.get("visible_to") in allowed]
    return {"events": visible}


@router.get("/pushes/{company_id}/{staff_id}")
def pending_pushes(company_id: str, staff_id: str):
    from src.push.inbox import PushInbox

    return {"pushes": PushInbox(company_db(company_id)).pending_for(staff_id)}
