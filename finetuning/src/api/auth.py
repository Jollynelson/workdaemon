"""
Auth for the public serving API.

Two credential types, both derived from a single server-side master secret
(`SERVE_MASTER_SECRET`, injected via Modal Secret — never sent by clients):

- **Per-company token** = HMAC-SHA256(master, company_id). The WorkDaemon Node
  app stores this as the provider api_key for a workspace and sends it as a
  bearer token to /api/serve/chat. Because it is bound to one company_id, a
  leaked token can only ever reach that one company's model — it cannot be
  used (or forged) for another company without the master secret.

- **Admin (master) token** = the master secret itself. Required by the internal
  ops routes (agents/brain/staff). The Node daemon never holds this.

If `SERVE_MASTER_SECRET` is unset, auth is DISABLED (local dev only) and a
warning is logged. Set it in production.
"""

from __future__ import annotations

import hashlib
import hmac
import logging

from fastapi import Header, HTTPException

from src.config import settings

logger = logging.getLogger(__name__)


def company_token(company_id: str) -> str:
    """Deterministic per-company bearer token. Provision this into the workspace
    provider config (api_key) for the matching company_id."""
    master = settings.serve_master_secret
    return hmac.new(master.encode(), company_id.encode(), hashlib.sha256).hexdigest()


def _bearer(authorization: str | None) -> str | None:
    if authorization and authorization.startswith("Bearer "):
        return authorization.split(" ", 1)[1].strip()
    return None


def require_company(company_id: str, authorization: str | None) -> None:
    """Authenticate + authorize a /api/serve/chat call for `company_id`.

    Accepts only the per-company token (not the master) so a single credential
    can never span tenants. Called from inside the route (company_id is in body).
    """
    master = settings.serve_master_secret
    if not master:
        logger.warning("SERVE_MASTER_SECRET unset — serve auth DISABLED (dev only).")
        return
    token = _bearer(authorization)
    if not token:
        raise HTTPException(status_code=401, detail="Missing bearer token")
    if not hmac.compare_digest(token, company_token(company_id)):
        # Same response whether the token is invalid or for a different company —
        # don't reveal which.
        raise HTTPException(status_code=403, detail="Token not authorized for this company")


async def require_admin(authorization: str | None = Header(default=None)) -> None:
    """FastAPI dependency guarding internal ops routes with the master secret."""
    master = settings.serve_master_secret
    if not master:
        logger.warning("SERVE_MASTER_SECRET unset — admin route auth DISABLED (dev only).")
        return
    token = _bearer(authorization)
    if not token or not hmac.compare_digest(token, master):
        raise HTTPException(status_code=401, detail="Admin authentication required")
