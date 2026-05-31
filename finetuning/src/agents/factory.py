"""
AgentFactory — spin_up, load_for_conversation, offboard.

One call to spin_up() creates everything a staff member needs.
One call to offboard() revokes access but preserves company learnings.
"""

from __future__ import annotations

import logging
import uuid

from src.agents.profiles import AgentProfile, load_profile, save_profile
from src.agents.prompts import build_system_prompt
from src.brain import context as brain_ctx
from src.brain import memory
from src.model.naming import user_namespace
from src.push.inbox import get_pending_pushes
from src.tools.registry import TOOL_PERMISSIONS

logger = logging.getLogger(__name__)


class AgentFactory:

    def __init__(self, company_id: str, company_name: str, db_client):
        self.company_id   = company_id
        self.company_name = company_name
        self.db           = db_client

    def spin_up(self, staff: dict) -> AgentProfile:
        """
        Create a fully configured agent for a new staff member.

        staff dict: {id, name, email, role, department, access_level}
        """
        staff_id     = staff["id"]
        access_level = staff.get("access_level", "junior")

        logger.info("Spinning up agent for %s (%s)", staff["name"], staff["role"])

        # 1. Fetch role context from Brain (RAG)
        brain_context = brain_ctx.get_role_context(
            company_id=self.company_id,
            role=staff["role"],
            department=staff["department"],
        )

        # 2. Build initial system prompt
        system_prompt = build_system_prompt(
            company_name=self.company_name,
            staff_name=staff["name"],
            role=staff["role"],
            department=staff["department"],
            access_level=access_level,
            brain_context=brain_context,
            interaction_count=0,
        )

        # 3. Create personal memory namespace (seeded with role context)
        ns = user_namespace(staff_id, self.company_id)
        memory.create_namespace(self.company_id, staff_id, access_level)

        # 4. Build profile
        profile = AgentProfile(
            id=str(uuid.uuid4()),
            company_id=self.company_id,
            staff_id=staff_id,
            staff_name=staff["name"],
            role=staff["role"],
            department=staff["department"],
            access_level=access_level,
            permitted_tools=TOOL_PERMISSIONS.get(access_level, []),
            memory_namespace=ns,
            system_prompt=system_prompt,
        )

        # 5. Persist to DB
        save_profile(profile, self.db)

        # 6. Register with brain (upsert to agent_profiles)
        self.db.table("agent_profiles").upsert({
            "id":                str(uuid.uuid4()),
            "company_id":        self.company_id,
            "staff_id":          staff_id,
            "memory_namespace":  ns,
            "permitted_tools":   TOOL_PERMISSIONS.get(access_level, []),
            "system_prompt":     system_prompt,
            "trust_score":       1.0,
            "interaction_count": 0,
            "status":            "active",
        }, on_conflict="company_id,staff_id").execute()

        logger.info(
            "Agent ready for %s — namespace=%s tools=%s",
            staff["name"], ns, TOOL_PERMISSIONS.get(access_level, []),
        )
        return profile

    def load_for_conversation(self, staff_id: str) -> AgentProfile:
        """
        Load profile and rebuild system prompt with fresh context.
        Called at the START of every conversation — facts always current.
        """
        profile = load_profile(self.company_id, staff_id, self.db)
        if not profile:
            raise ValueError(f"No active agent profile for staff={staff_id}")

        # Fresh context from RAG (facts, not stale weights)
        brain_context = brain_ctx.get_role_context(
            company_id=self.company_id,
            role=profile.role,
            department=profile.department,
        )

        # Pending pushes to surface
        pending = get_pending_pushes(self.company_id, staff_id, self.db)

        # Rebuild prompt with everything fresh
        profile.system_prompt = build_system_prompt(
            company_name=self.company_name,
            staff_name=profile.staff_name,
            role=profile.role,
            department=profile.department,
            access_level=profile.access_level,
            brain_context=brain_context,
            pending_pushes=pending,
            trust_score=profile.trust_score,
            interaction_count=profile.interaction_count,
        )
        return profile

    def offboard(self, staff_id: str) -> None:
        """
        Deactivate a departing staff member's agent.

        Access is revoked immediately. Memory namespace is ARCHIVED (not deleted)
        so the company model retains anonymised learnings — but the individual's
        raw personal documents are removed per Section 14 privacy rules.
        """
        # Deactivate in DB
        self.db.table("agent_profiles").update({"status": "inactive"}).eq(
            "company_id", self.company_id
        ).eq("staff_id", staff_id).execute()

        self.db.table("staff").update({"status": "inactive"}).eq(
            "id", staff_id
        ).eq("company_id", self.company_id).execute()

        # Archive personal namespace (remove raw docs, keep anonymised patterns)
        memory.archive_namespace(self.company_id, staff_id)

        logger.info(
            "Offboarded staff=%s — access revoked, namespace archived.", staff_id
        )
