"""Generic serving endpoint for the WorkDaemon Node app.

Unlike /api/agents/.../chat (which runs the full Python agent runtime and
builds its own system prompt), this endpoint takes a system prompt + messages
already assembled by the daemon and routes them through router.chat() — warm
Hermes-3 → cold-start + Claude fallback → base model. It returns plain content
so api/chat.js's `case 'modal'` can treat it like any other provider.
"""

from __future__ import annotations

from fastapi import APIRouter, Header
from pydantic import BaseModel

from src.api.auth import require_company
from src.model.router import chat as route_chat
from src.serving import warm_state
from src.serving.modal_bridge import get_gpu_warm

router = APIRouter()


class ServeChatRequest(BaseModel):
    company_id: str
    system_prompt: str
    messages: list[dict] = []
    model_version: int | None = None
    temperature: float = 0.3
    max_tokens: int = 2048


class WarmRequest(BaseModel):
    company_id: str
    model_version: int | None = None


@router.post("/chat")
def serve_chat(body: ServeChatRequest, authorization: str | None = Header(default=None)):
    """Route one chat turn to the company's model.

    Requires a per-company bearer token (HMAC-bound to company_id); see auth.py.
    Returns: {"content": str, "tool_calls": list[dict], "model": str, "source": str}
    """
    require_company(body.company_id, authorization)
    return route_chat(
        company_id=body.company_id,
        messages=body.messages,
        system_prompt=body.system_prompt,
        model_version=body.model_version,
        temperature=body.temperature,
        max_tokens=body.max_tokens,
    )


@router.post("/warm")
def serve_warm(body: WarmRequest, authorization: str | None = Header(default=None)):
    """Kick a background GPU cold-start for this company's model (non-blocking).

    Spawns the Modal `warm` Function (boots a container, pins the model in VRAM,
    writes the readiness heartbeat) and returns immediately. The next /ready probe
    flips to true once the heartbeat lands. No-op when no GPU function is bound
    (local dev), where models are already resident in the co-located Ollama."""
    require_company(body.company_id, authorization)
    gpu_warm = get_gpu_warm()
    if gpu_warm is not None:
        try:
            gpu_warm.spawn(company_id=body.company_id, model_version=body.model_version)
        except Exception:
            return {"warming": False}
    return {"warming": True}


@router.get("/ready")
def serve_ready(company_id: str, authorization: str | None = Header(default=None)):
    """Readiness gate: is this company's model warm right now?

    Reads only the Supabase heartbeat — never touches the GPU, so probing can't
    trigger a cold start."""
    require_company(company_id, authorization)
    return {"ready": warm_state.is_warm(company_id)}
