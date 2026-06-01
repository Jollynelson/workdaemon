"""Agent factory — spin up / load / offboard a staff member's agent.

Own-runtime version: no Hermes profile, no SSH, no port allocation. spin_up
persists an AgentProfile and seeds the memory namespace; load_for_conversation
rebuilds the system prompt with fresh Brain context; offboard deactivates and
archives the namespace (privacy — keeps company-level learning, stops surfacing
the individual's words).
"""

from __future__ import annotations

from typing import Any, Callable

from src.agents.profiles import AgentProfile
from src.agents.prompts import build_system_prompt
from src.agents.tool_permissions import tools_for
from src.db import CompanyDB


class AgentFactory:
    def __init__(
        self,
        db: CompanyDB,
        company_name: str,
        seed_memory: Callable[[str], None] | None = None,
        context_for_role: Callable[[str, str], str] | None = None,
    ) -> None:
        self._db = db
        self._company_name = company_name
        # injectable so tests don't need pgvector; default no-ops
        self._seed_memory = seed_memory or (lambda ns: None)
        self._context_for_role = context_for_role or (lambda role, dept: "")

    def spin_up(self, staff: dict) -> AgentProfile:
        """Create everything a new staff member's agent needs (one call)."""
        profile = AgentProfile(
            staff_id=staff["id"],
            company_id=self._db.company_id,
            name=staff["name"],
            role=staff["role"],
            department=staff["department"],
            access_level=staff["access_level"],
            permitted_tools=tools_for(staff["access_level"]),
        )
        self._seed_memory(profile.memory_ns)
        row = self._db.insert("agent_profiles", profile.to_row())
        profile.id = row.get("id")
        return profile

    def load_for_conversation(self, staff_id: str) -> tuple[AgentProfile, str]:
        """Load a profile and build its system prompt with fresh context."""
        prow = self._db.select("agent_profiles").eq("staff_id", staff_id).limit(1).execute()
        prows = getattr(prow, "data", None) or []
        if not prows:
            raise ValueError(f"no agent profile for staff {staff_id} in this company")
        staff = self._db.get("staff", staff_id) or {}
        profile = AgentProfile.from_row(prows[0], staff)
        context = self._context_for_role(profile.role, profile.department)
        system_prompt = build_system_prompt(profile, self._company_name, context)
        return profile, system_prompt

    def offboard(self, staff_id: str, archive_namespace: Callable[[str], None] | None = None) -> None:
        prow = self._db.select("agent_profiles").eq("staff_id", staff_id).limit(1).execute()
        prows = getattr(prow, "data", None) or []
        if not prows:
            return
        row = prows[0]
        self._db.update("agent_profiles", row["id"], {"status": "inactive"})
        if archive_namespace:
            archive_namespace(row.get("memory_namespace", ""))
