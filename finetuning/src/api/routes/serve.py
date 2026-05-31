"""Generic serving endpoint for the WorkDaemon Node app.

Unlike /api/agents/.../chat (which runs the full Python agent runtime and
builds its own system prompt), this endpoint takes a system prompt + messages
already assembled by the daemon and routes them through router.chat() — warm
Hermes-3 → cold-start + Claude fallback → base model. It returns plain content
so api/chat.js's `case 'modal'` can treat it like any other provider.
"""

from __future__ import annotations

from fastapi import APIRouter, Header, HTTPException
from pydantic import BaseModel

from src.config import settings
from src.model.router import chat as route_chat

router = APIRouter()


class ServeChatRequest(BaseModel):
    company_id: str
    system_prompt: str
    messages: list[dict] = []
    model_version: int | None = None
    temperature: float = 0.3
    max_tokens: int = 2048


def _check_auth(authorization: str | None) -> None:
    """Verify the bearer token if SERVE_TOKEN is configured."""
    if not settings.serve_token:
        return  # auth disabled (dev only)
    expected = f"Bearer {settings.serve_token}"
    if authorization != expected:
        raise HTTPException(401, "Invalid or missing serve token")


@router.post("/chat")
def serve_chat(body: ServeChatRequest, authorization: str | None = Header(default=None)):
    """Route one chat turn to the company's model.

    Returns: {"content": str, "tool_calls": list[dict], "model": str, "source": str}
    """
    _check_auth(authorization)
    return route_chat(
        company_id=body.company_id,
        messages=body.messages,
        system_prompt=body.system_prompt,
        model_version=body.model_version,
        temperature=body.temperature,
        max_tokens=body.max_tokens,
    )
