"""Authentication + identity bridge for the FINAL-spec backend.

The existing app authenticates with Supabase Auth tokens and models users as
`profiles` (id == auth user id) belonging to a `workspace`. This backend speaks
`company`/`staff`. We bridge by REUSING UUIDs — no mapping table:

    company_id == workspace_id
    staff_id   == auth user id (== profiles.id)

resolve_identity validates the token, finds the user's profile + workspace, and
AUTO-PROVISIONS the mirroring companies + staff rows on first call (self-healing:
existing users just work). Identity is always derived server-side, so a client
can never act as another company.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass

from fastapi import Header, HTTPException

from src.config import settings
from src.db import supabase_client

logger = logging.getLogger(__name__)

# profiles.permission_level / workspace role → spec access level
_LEVEL_MAP = {0: "junior", 1: "manager", 2: "executive", 3: "executive"}


@dataclass
class Identity:
    user_id: str
    email: str
    company_id: str   # == workspace_id
    staff_id: str     # == auth user id


def _bearer(authorization: str | None) -> str | None:
    if authorization and authorization.startswith("Bearer "):
        return authorization.split(" ", 1)[1].strip()
    return None


def resolve_identity(authorization: str | None = Header(default=None)) -> Identity:
    if not settings.supabase_url or not settings.supabase_service_key:
        logger.warning("Supabase not configured — backend auth DISABLED (dev only).")
        raise HTTPException(status_code=503, detail="auth not configured")

    token = _bearer(authorization)
    if not token:
        raise HTTPException(status_code=401, detail="Missing bearer token")

    sb = supabase_client()
    try:
        user = getattr(sb.auth.get_user(token), "user", None)
    except Exception:
        user = None
    if user is None:
        raise HTTPException(status_code=401, detail="Invalid or expired token")

    uid = getattr(user, "id", None)
    email = getattr(user, "email", "") or ""
    if not uid:
        raise HTTPException(status_code=401, detail="token has no user id")

    # profiles.id == auth user id
    prof = sb.table("profiles").select("*").eq("id", uid).limit(1).execute()
    prows = getattr(prof, "data", None) or []
    if not prows:
        raise HTTPException(status_code=403, detail="no profile for this user")
    profile = prows[0]

    workspace_id = profile.get("workspace_id") or _workspace_from_membership(sb, uid)
    if not workspace_id:
        raise HTTPException(status_code=403, detail="user is not in a workspace yet")

    _ensure_company_and_staff(sb, workspace_id, uid, email, profile)
    return Identity(user_id=uid, email=email, company_id=workspace_id, staff_id=uid)


def _workspace_from_membership(sb, uid: str) -> str | None:
    r = sb.table("workspace_members").select("workspace_id").eq("user_id", uid).limit(1).execute()
    rows = getattr(r, "data", None) or []
    return rows[0]["workspace_id"] if rows else None


def _ensure_company_and_staff(sb, workspace_id: str, uid: str, email: str, profile: dict) -> None:
    """Mirror the existing workspace/profile into companies + staff (idempotent)."""
    # company (id == workspace_id)
    comp = sb.table("companies").select("id").eq("id", workspace_id).limit(1).execute()
    if not (getattr(comp, "data", None) or []):
        ws = sb.table("workspaces").select("name, slug").eq("id", workspace_id).limit(1).execute()
        wrows = getattr(ws, "data", None) or [{}]
        w = wrows[0]
        sb.table("companies").insert({
            "id": workspace_id,
            "name": w.get("name") or "Company",
            "slug": w.get("slug") or f"ws-{workspace_id[:8]}",
        }).execute()

    # staff (id == auth user id)
    st = sb.table("staff").select("id").eq("id", uid).limit(1).execute()
    if not (getattr(st, "data", None) or []):
        level = _LEVEL_MAP.get(profile.get("permission_level", 1), "manager")
        sb.table("staff").insert({
            "id": uid,
            "company_id": workspace_id,
            "name": profile.get("name") or "Teammate",
            "email": email or f"{uid}@workdaemon.local",
            "role": profile.get("title") or profile.get("role") or "Staff",
            "department": profile.get("industry") or "General",
            "access_level": level,
        }).execute()

    # agent profile (so chat can load_for_conversation immediately)
    ap = sb.table("agent_profiles").select("id").eq("staff_id", uid).limit(1).execute()
    if not (getattr(ap, "data", None) or []):
        from src.agents.factory import AgentFactory
        from src.db import CompanyDB

        staff_row = {
            "id": uid,
            "name": profile.get("name") or "Teammate",
            "role": profile.get("title") or profile.get("role") or "Staff",
            "department": profile.get("industry") or "General",
            "access_level": _LEVEL_MAP.get(profile.get("permission_level", 1), "manager"),
        }
        try:
            AgentFactory(CompanyDB(workspace_id, client=sb), "the company").spin_up(staff_row)
        except Exception as exc:  # don't block auth if agent provisioning hiccups
            logger.warning("agent spin_up during provisioning failed: %s", exc)
