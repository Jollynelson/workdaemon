"""Agent conversation endpoints."""

from __future__ import annotations

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from src.agents.factory import AgentFactory
from src.agents.runtime import run_conversation_turn
from src.db import db
from src.push.inbox import get_pending_pushes, mark_delivered

router = APIRouter()


class ChatRequest(BaseModel):
    user_message: str
    conversation_history: list[dict] = []


@router.post("/{company_id}/{staff_id}/chat")
def chat(company_id: str, staff_id: str, body: ChatRequest):
    """Run one conversation turn for a staff member's agent."""
    client = db()
    resp = client.table("companies").select("name").eq("id", company_id).single().execute()
    if not resp.data:
        raise HTTPException(404, "Company not found")
    factory = AgentFactory(company_id, resp.data["name"], client)

    result = run_conversation_turn(
        company_id=company_id,
        staff_id=staff_id,
        user_message=body.user_message,
        conversation_history=body.conversation_history,
        db_client=client,
        factory=factory,
    )
    return result


@router.get("/{company_id}/{staff_id}/profile")
def get_profile(company_id: str, staff_id: str):
    client = db()
    resp = (
        client.table("agent_profiles")
        .select("*")
        .eq("company_id", company_id)
        .eq("staff_id", staff_id)
        .single()
        .execute()
    )
    if not resp.data:
        raise HTTPException(404, "Profile not found")
    return resp.data


@router.get("/{company_id}/{staff_id}/pushes")
def get_pushes(company_id: str, staff_id: str):
    """Return undelivered push notifications for this agent."""
    client = db()
    pushes = get_pending_pushes(company_id, staff_id, client)
    # Mark all as delivered (they've been fetched)
    for p in pushes:
        mark_delivered(p["id"], client)
    return {"pushes": pushes}
