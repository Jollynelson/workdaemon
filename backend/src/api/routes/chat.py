"""Chat route — the single entry point for staff↔agent messages.

Identity is derived server-side from the Supabase token (auth.resolve_identity),
so a caller can only chat as themselves, within their own company.
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from src.api.auth import Identity, resolve_identity
from src.api.blocks import parse_blocks
from src.api.deps import chat_service, company_db

router = APIRouter()

# Synthetic session-boot turns are logged like any interaction; never replay them
# as visible transcript history.
_SESSION_SENTINELS = {"[SESSION_START]", "[SESSION_RESUME]"}


class ChatRequest(BaseModel):
    message: str
    history: list[dict] = []


@router.get("/chat/history")
def chat_history(limit: int = 30, ident: Identity = Depends(resolve_identity)):
    """Recent transcript for the caller, oldest→newest, so the webapp can restore
    the conversation on login instead of starting blank. Synthetic session-boot
    turns ([SESSION_START]/[SESSION_RESUME]) are filtered out."""
    db = company_db(ident.company_id)
    resp = (
        db.select("interactions", "user_message,agent_response,created_at")
        .eq("staff_id", ident.staff_id)
        .order("created_at", desc=True)
        .limit(max(1, min(limit, 100)))
        .execute()
    )
    rows = list(reversed(getattr(resp, "data", None) or []))
    messages: list[dict] = []
    for r in rows:
        um = (r.get("user_message") or "").strip()
        if um in _SESSION_SENTINELS:
            continue  # skip synthetic session-boot turns (don't replay old greetings)
        if um:
            messages.append({"role": "user", "content": r["user_message"]})
        ar = r.get("agent_response")
        if ar:
            messages.append({"role": "assistant", "content": ar})
    return {"messages": messages}


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
