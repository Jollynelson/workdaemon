"""Chat route — the single entry point for staff↔agent messages.

Every message flows through here → ChatService → Brain visibility. Auth is left
to the caller's middleware (the existing WorkDaemon JWT layer); this route trusts
the resolved company_id + staff_id.
"""

from __future__ import annotations

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from src.api.deps import chat_service

router = APIRouter()


class ChatRequest(BaseModel):
    company_id: str
    staff_id: str
    message: str
    history: list[dict] = []


@router.post("/chat")
def chat(body: ChatRequest):
    try:
        svc = chat_service(body.company_id)
        reply = svc.handle_turn(body.staff_id, body.message, body.history)
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))
    return {
        "text": reply.text,
        "tools_called": [t.get("tool") for t in reply.tools_called],
        "interaction_id": reply.interaction_id,
        "routed_task_id": reply.routed_task_id,
    }
