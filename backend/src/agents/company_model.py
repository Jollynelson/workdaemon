"""Per-company trained-model client (hybrid brain).

When a company has a deployed wd-{company_id} adapter, agent chat is served by
that company's OWN fine-tuned Hermes model via the workdaemon-serving endpoint
(/api/serve/chat). Auth is the per-company HMAC token = HMAC(SERVE_MASTER_SECRET,
company_id) — the same scheme the serving app validates.

Satisfies the AgentModel protocol (.chat(messages) -> str), so the runtime uses
it interchangeably with the DeepSeek agent model.
"""

from __future__ import annotations

import hashlib
import hmac

import httpx

from src.config import settings


def company_token(company_id: str) -> str:
    return hmac.new(
        settings.serve_master_secret.encode(), company_id.encode(), hashlib.sha256
    ).hexdigest()


def has_deployed_adapter(company_id: str, db) -> bool:
    """True if this company has a deployed wd-{company_id} adapter."""
    try:
        resp = (
            db.select("model_versions", "id")
            .eq("deployed", True)
            .limit(1)
            .execute()
        )
        return bool(getattr(resp, "data", None))
    except Exception:
        return False


class CompanyModel:
    """Calls the company's own model on the serving endpoint. Falls back to a
    provided DeepSeek model on any serving error so chat never hard-fails."""

    def __init__(self, company_id: str, system_prompt: str, fallback) -> None:
        self._company_id = company_id
        self._system_prompt = system_prompt
        self._fallback = fallback  # an AgentModel (DeepSeek) used on serving failure

    def chat(self, messages: list[dict]) -> str:
        base = settings.serving_url.rstrip("/")
        if not base:
            return self._fallback.chat(messages)
        try:
            r = httpx.post(
                f"{base}/api/serve/chat",
                headers={"authorization": f"Bearer {company_token(self._company_id)}"},
                json={
                    "company_id": self._company_id,
                    "system_prompt": self._system_prompt,
                    # serving prepends the system prompt itself; pass the turn messages
                    "messages": [m for m in messages if m.get("role") != "system"],
                },
                timeout=180.0,
            )
            r.raise_for_status()
            return r.json().get("content", "") or self._fallback.chat(messages)
        except Exception:
            return self._fallback.chat(messages)
