"""Chat route — the single entry point for staff↔agent messages.

Identity is derived server-side from the Supabase token (auth.resolve_identity),
so a caller can only chat as themselves, within their own company.
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from src.api.auth import Identity, resolve_identity
from src.api.blocks import parse_blocks
from src.api.deps import chat_service

router = APIRouter()


class ChatRequest(BaseModel):
    message: str
    history: list[dict] = []


@router.post("/chat")
def chat(body: ChatRequest, ident: Identity = Depends(resolve_identity)):
    try:
        svc = chat_service(ident.company_id)
        reply = svc.handle_turn(ident.staff_id, body.message, body.history)
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))
    parsed = parse_blocks(reply.text)
    return {
        # Rich structured output for the webapp (blocks + suggestions)…
        "blocks": parsed["blocks"],
        "suggestions": parsed["suggestions"],
        # …plus plain text + metadata for non-rich clients.
        "text": reply.text,
        "tools_called": [t.get("tool") for t in reply.tools_called],
        "interaction_id": reply.interaction_id,
        "routed_task_id": reply.routed_task_id,
    }
