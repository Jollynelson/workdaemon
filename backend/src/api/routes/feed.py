"""Activity feed + pushes routes — role-gated reads, identity from the token."""

from __future__ import annotations

from fastapi import APIRouter, Depends

from src.api.auth import Identity, resolve_identity
from src.api.deps import company_db

router = APIRouter()

# what each viewer access_level may see in the feed
_ROLE_VISIBILITY = {
    "executive": {"brain", "executives", "managers", "all"},
    "director": {"executives", "managers", "all"},
    "manager": {"managers", "all"},
    "junior": {"all"},
}


def _access_level(db, staff_id: str) -> str:
    row = db.get("staff", staff_id) or {}
    return row.get("access_level", "junior")


@router.get("/feed")
def activity_feed(limit: int = 50, ident: Identity = Depends(resolve_identity)):
    db = company_db(ident.company_id)
    level = _access_level(db, ident.staff_id)
    resp = db.select("activity_events").order("created_at", desc=True).limit(limit).execute()
    rows = getattr(resp, "data", None) or []
    allowed = _ROLE_VISIBILITY.get(level, {"all"})
    return {"events": [r for r in rows if r.get("visible_to") in allowed], "viewer_level": level}


@router.get("/pushes")
def pending_pushes(ident: Identity = Depends(resolve_identity)):
    from src.push.inbox import PushInbox

    return {"pushes": PushInbox(company_db(ident.company_id)).pending_for(ident.staff_id)}
