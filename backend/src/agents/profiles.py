"""AgentProfile — per-staff agent state, persisted in agent_profiles.

In the own-runtime architecture there is no Hermes profile/port/api_key. A
profile is: which staff member, their access level, permitted tools, and a memory
namespace. The model is shared (DeepSeek Flash); what makes each agent distinct
is the system prompt + memory namespace.
"""

from __future__ import annotations

from dataclasses import dataclass, field


def memory_namespace(staff_id: str, company_id: str) -> str:
    return f"user_{staff_id}_{company_id}"


@dataclass
class AgentProfile:
    staff_id: str
    company_id: str
    name: str
    role: str
    department: str
    access_level: str
    permitted_tools: list[str] = field(default_factory=list)
    memory_ns: str = ""
    trust_score: float = 1.0
    interaction_count: int = 0
    status: str = "active"
    id: str | None = None

    def __post_init__(self) -> None:
        if not self.memory_ns:
            self.memory_ns = memory_namespace(self.staff_id, self.company_id)

    @classmethod
    def from_row(cls, row: dict, staff: dict) -> "AgentProfile":
        """Build from an agent_profiles row joined with its staff row."""
        return cls(
            id=row.get("id"),
            staff_id=row["staff_id"],
            company_id=row["company_id"],
            name=staff.get("name", ""),
            role=staff.get("role", ""),
            department=staff.get("department", ""),
            access_level=staff.get("access_level", "junior"),
            permitted_tools=row.get("permitted_tools", []) or [],
            memory_ns=row.get("memory_namespace", ""),
            trust_score=row.get("trust_score", 1.0),
            interaction_count=row.get("interaction_count", 0),
            status=row.get("status", "active"),
        )

    def to_row(self) -> dict:
        # Own-runtime: no Hermes profile/port/key. Just identity + tools + memory.
        return {
            "staff_id": self.staff_id,
            "memory_namespace": self.memory_ns,
            "permitted_tools": self.permitted_tools,
            "trust_score": self.trust_score,
            "interaction_count": self.interaction_count,
            "status": self.status,
        }
