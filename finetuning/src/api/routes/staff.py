"""Staff management endpoints — CRUD for companies, staff, and agent spin-up."""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from src.agents.factory import AgentFactory
from src.db import db

router = APIRouter()


def _factory(company_id: str) -> AgentFactory:
    client = db()
    resp = client.table("companies").select("name").eq("id", company_id).single().execute()
    if not resp.data:
        raise HTTPException(404, "Company not found")
    return AgentFactory(company_id, resp.data["name"], client)


class StaffCreate(BaseModel):
    name: str
    email: str
    role: str
    department: str
    access_level: str = "junior"


class StaffUpdate(BaseModel):
    access_level: str | None = None
    status: str | None = None


@router.post("/{company_id}/staff")
def create_staff(company_id: str, body: StaffCreate):
    """Create a staff member and spin up their agent."""
    client = db()
    resp = client.table("staff").insert({
        "company_id":  company_id,
        "name":        body.name,
        "email":       body.email,
        "role":        body.role,
        "department":  body.department,
        "access_level": body.access_level,
    }).execute()
    if not resp.data:
        raise HTTPException(500, "Failed to create staff")
    staff_row = resp.data[0]

    factory = _factory(company_id)
    profile = factory.spin_up(staff_row)
    return {"staff_id": staff_row["id"], "agent_profile": profile.id}


@router.get("/{company_id}/staff")
def list_staff(company_id: str):
    client = db()
    resp = client.table("staff").select("*").eq("company_id", company_id).execute()
    return resp.data or []


@router.patch("/{company_id}/staff/{staff_id}")
def update_staff(company_id: str, staff_id: str, body: StaffUpdate):
    client = db()
    updates = {k: v for k, v in body.model_dump().items() if v is not None}
    if not updates:
        return {"ok": True}
    client.table("staff").update(updates).eq("id", staff_id).eq("company_id", company_id).execute()
    return {"ok": True}


@router.delete("/{company_id}/staff/{staff_id}")
def offboard_staff(company_id: str, staff_id: str):
    factory = _factory(company_id)
    factory.offboard(staff_id)
    return {"ok": True, "message": "Agent offboarded, namespace archived."}
