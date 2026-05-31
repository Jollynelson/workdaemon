"""AgentProfile dataclass + persistence helpers."""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime
from typing import Optional


@dataclass
class AgentProfile:
    """
    Everything the agent runtime needs to know about a staff member's agent.
    Created once on spin_up; loaded at the start of every conversation.
    """
    id: str
    company_id: str
    staff_id: str
    staff_name: str
    role: str
    department: str
    access_level: str           # junior | manager | director | executive
    permitted_tools: list[str]
    memory_namespace: str       # user_{staff_id}_{company_id}
    system_prompt: str          # cached; rebuilt with fresh context each convo
    trust_score: float = 1.0
    interaction_count: int = 0
    last_active: Optional[datetime] = None
    status: str = "active"      # active | inactive | archived


def load_profile(company_id: str, staff_id: str, db_client) -> AgentProfile | None:
    """Load an agent profile from DB. Returns None if not found."""
    resp = (
        db_client
        .table("agent_profiles")
        .select("*, staff!inner(name, role, department, access_level)")
        .eq("company_id", company_id)
        .eq("staff_id", staff_id)
        .eq("status", "active")
        .single()
        .execute()
    )
    if not resp.data:
        return None
    row = resp.data
    staff = row["staff"]
    return AgentProfile(
        id=row["id"],
        company_id=company_id,
        staff_id=staff_id,
        staff_name=staff["name"],
        role=staff["role"],
        department=staff["department"],
        access_level=staff["access_level"],
        permitted_tools=row["permitted_tools"] or [],
        memory_namespace=row["memory_namespace"],
        system_prompt=row["system_prompt"] or "",
        trust_score=row["trust_score"],
        interaction_count=row["interaction_count"],
        last_active=row.get("last_active"),
        status=row["status"],
    )


def save_profile(profile: AgentProfile, db_client) -> None:
    """Upsert an agent profile to DB."""
    db_client.table("agent_profiles").upsert({
        "id":               profile.id,
        "company_id":       profile.company_id,
        "staff_id":         profile.staff_id,
        "memory_namespace": profile.memory_namespace,
        "permitted_tools":  profile.permitted_tools,
        "system_prompt":    profile.system_prompt,
        "trust_score":      profile.trust_score,
        "interaction_count": profile.interaction_count,
        "status":           profile.status,
    }, on_conflict="company_id,staff_id").execute()
