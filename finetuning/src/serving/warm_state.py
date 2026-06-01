"""Serving warmth heartbeat — the readiness gate for instant chat.

The GPU class scales to zero, so the backend must know whether a company's model
is *already warm* before routing a turn to it (a cold call hangs ~150s and Modal
303s). We don't probe the GPU to find out — that would cold-start it. Instead the
serving app writes a cheap heartbeat to Supabase whenever a company is warmed
(startup preload, an explicit warm(), or any live chat turn), and the readiness
probe (`GET /api/serve/ready`) just reads it.

`is_warm` uses a TTL just under the GPU `scaledown_window` (600s) so a heartbeat
older than ~9min is treated as cold — matching the moment Modal would have
evicted the container.
"""

from __future__ import annotations

import logging
from datetime import datetime, timezone

from supabase import create_client

from src.config import settings

logger = logging.getLogger(__name__)


def _client():
    return create_client(settings.supabase_url, settings.supabase_service_key)


def mark_warm(company_id: str) -> None:
    """Record that `company_id`'s model is resident in VRAM right now."""
    try:
        _client().table("serving_heartbeat").upsert(
            {"company_id": company_id, "warmed_at": datetime.now(timezone.utc).isoformat()}
        ).execute()
    except Exception as exc:  # heartbeat is best-effort — never break the warm path
        logger.warning("mark_warm failed company=%s: %s", company_id, exc)


def is_warm(company_id: str, ttl: int = 540) -> bool:
    """True if `company_id` was warmed within the last `ttl` seconds.

    Reads only Supabase — never touches the GPU, so calling this can't cold-start
    a container.
    """
    try:
        resp = (
            _client()
            .table("serving_heartbeat")
            .select("warmed_at")
            .eq("company_id", company_id)
            .limit(1)
            .execute()
        )
        rows = getattr(resp, "data", None) or []
        if not rows:
            return False
        warmed_at = datetime.fromisoformat(rows[0]["warmed_at"].replace("Z", "+00:00"))
        age = (datetime.now(timezone.utc) - warmed_at).total_seconds()
        return age <= ttl
    except Exception as exc:
        logger.warning("is_warm check failed company=%s: %s", company_id, exc)
        return False
