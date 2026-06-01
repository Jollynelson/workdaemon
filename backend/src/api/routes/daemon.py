"""Daemon identity route — read/update the caller's daemon name, preferred name,
and persona ("soul"). Powers onboarding + the Settings "Your Daemon" section.

Identity is derived server-side from the token, so a caller only ever edits their
own daemon, within their own company. The chat `update_daemon` tool shares the same
persistence helper (deps.update_daemon)."""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from src.api.auth import Identity, resolve_identity
from src.api.deps import company_db, update_daemon

router = APIRouter()


class DaemonPatch(BaseModel):
    daemon_name: str | None = None
    preferred_name: str | None = None
    persona: str | None = None


def _read(db, staff_id: str) -> dict:
    resp = (
        db.select("agent_profiles", "daemon_name,preferred_name,persona")
        .eq("staff_id", staff_id)
        .limit(1)
        .execute()
    )
    rows = getattr(resp, "data", None) or []
    if not rows:
        return {"daemon_name": None, "preferred_name": None, "persona": None}
    r = rows[0]
    return {
        "daemon_name": r.get("daemon_name"),
        "preferred_name": r.get("preferred_name"),
        "persona": r.get("persona"),
    }


@router.get("/daemon")
def get_daemon(ident: Identity = Depends(resolve_identity)):
    return _read(company_db(ident.company_id), ident.staff_id)


@router.patch("/daemon")
def patch_daemon(body: DaemonPatch, ident: Identity = Depends(resolve_identity)):
    db = company_db(ident.company_id)
    result = update_daemon(db, ident.staff_id, body.model_dump(exclude_none=True))
    if result.get("error") == "no_profile":
        raise HTTPException(status_code=404, detail="no daemon profile for this user")
    return _read(db, ident.staff_id)
