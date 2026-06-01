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


def warm(company_id: str) -> None:
    """Fire-and-forget: ask the serving app to boot this company's GPU model.

    Returns immediately — the serving /warm spawns a background container. Used on
    login (via /api/warm) and whenever a turn finds the GPU cold, so the next turn
    can route to Hermes. Swallows all errors (warming is never on the hot path)."""
    base = settings.serving_url.rstrip("/")
    if not base:
        return
    try:
        httpx.post(
            f"{base}/api/serve/warm",
            headers={"authorization": f"Bearer {company_token(company_id)}"},
            json={"company_id": company_id},
            timeout=5.0,
            follow_redirects=True,
        )
    except Exception:
        pass


class CompanyModel:
    """Calls the company's own model on the serving endpoint — but only when a cheap
    readiness probe says the GPU is already warm. A cold GPU scales from zero in
    ~150s and 303s the sync client, so on cold (or probe failure) we kick a
    background warm and answer instantly with the provided DeepSeek fallback. The
    user never blocks on a cold GPU; the company model phases in once warm."""

    def __init__(self, company_id: str, system_prompt: str, fallback) -> None:
        self._company_id = company_id
        self._system_prompt = system_prompt
        self._fallback = fallback  # an AgentModel (DeepSeek) used when not warm

    def chat(self, messages: list[dict]) -> str:
        base = settings.serving_url.rstrip("/")
        if not base:
            return self._fallback.chat(messages)

        headers = {"authorization": f"Bearer {company_token(self._company_id)}"}

        # Readiness gate — a cheap heartbeat read; never cold-starts the GPU.
        try:
            ready = httpx.get(
                f"{base}/api/serve/ready",
                headers=headers,
                params={"company_id": self._company_id},
                timeout=6.0,
                follow_redirects=True,
            ).json().get("ready", False)
        except Exception:
            ready = False

        if not ready:
            # Kick a background warm so the next turn can use Hermes, answer now.
            warm(self._company_id)
            return self._fallback.chat(messages)

        try:
            r = httpx.post(
                f"{base}/api/serve/chat",
                headers=headers,
                json={
                    "company_id": self._company_id,
                    "system_prompt": self._system_prompt,
                    # serving prepends the system prompt itself; pass the turn messages
                    "messages": [m for m in messages if m.get("role") != "system"],
                },
                timeout=120.0,
                follow_redirects=True,
            )
            r.raise_for_status()
            return r.json().get("content", "") or self._fallback.chat(messages)
        except Exception:
            return self._fallback.chat(messages)
