"""Authentication for the FINAL-spec backend.

The existing WorkDaemon app authenticates with Supabase Auth tokens (the frontend
sends `Authorization: Bearer <supabase access token>`). This backend validates the
SAME token and derives the caller's identity SERVER-SIDE — the client never asserts
its own company_id/staff_id, which closes the cross-tenant hole.

Resolution: token → Supabase user (id, email) → the staff row whose email matches
→ {company_id, staff_id}. A request may only act within that resolved company.

If SUPABASE isn't configured (local dev), auth is disabled and a warning logged.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass

from fastapi import Header, HTTPException

from src.config import settings
from src.db import supabase_client

logger = logging.getLogger(__name__)


@dataclass
class Identity:
    user_id: str
    email: str
    company_id: str
    staff_id: str


def _bearer(authorization: str | None) -> str | None:
    if authorization and authorization.startswith("Bearer "):
        return authorization.split(" ", 1)[1].strip()
    return None


def resolve_identity(authorization: str | None = Header(default=None)) -> Identity:
    """FastAPI dependency: validate the token and return the caller's Identity.

    Raises 401 if the token is missing/invalid, 403 if the user isn't a known
    staff member of any company.
    """
    if not settings.supabase_url or not settings.supabase_service_key:
        logger.warning("Supabase not configured — backend auth DISABLED (dev only).")
        raise HTTPException(status_code=503, detail="auth not configured")

    token = _bearer(authorization)
    if not token:
        raise HTTPException(status_code=401, detail="Missing bearer token")

    sb = supabase_client()
    try:
        resp = sb.auth.get_user(token)
        user = getattr(resp, "user", None)
    except Exception:
        user = None
    if user is None:
        raise HTTPException(status_code=401, detail="Invalid or expired token")

    email = getattr(user, "email", None)
    uid = getattr(user, "id", None)
    if not email:
        raise HTTPException(status_code=403, detail="user has no email")

    # Resolve the staff row by email → gives company_id + staff_id.
    staff_resp = sb.table("staff").select("id, company_id").eq("email", email).limit(1).execute()
    rows = getattr(staff_resp, "data", None) or []
    if not rows:
        raise HTTPException(status_code=403, detail="user is not a staff member of any company")

    return Identity(user_id=uid or "", email=email,
                    company_id=rows[0]["company_id"], staff_id=rows[0]["id"])
