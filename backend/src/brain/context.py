"""Brain context assembly — RAG for queries, role onboarding, and hunts.

Prefix-stable: the stable company preamble goes first (so DeepSeek prefix-caching
applies to repeated Flash triage + Pro hunts), then the query-specific retrieved
chunks. 1M context is the ceiling, not the default payload — we retrieve the most
relevant slice, not everything.
"""

from __future__ import annotations

from src.brain.memory import MemoryManager, company_ns, user_ns


class BrainContext:
    def __init__(self, company_id: str, company_name: str, memory: MemoryManager) -> None:
        self._company_id = company_id
        self._company_name = company_name
        self._memory = memory

    def _preamble(self) -> str:
        # Stable across calls → prefix-cacheable.
        return f"# Company: {self._company_name} (id {self._company_id})\n"

    def get_for_query(self, query: str, staff_id: str, top_k: int = 8) -> str:
        """Context for a specific staff question: company knowledge + their history."""
        company = self._memory.search(company_ns(self._company_id), query, top_k)
        personal = self._memory.search(user_ns(staff_id, self._company_id), query, max(2, top_k // 2))
        return (
            self._preamble()
            + "\n## Relevant company knowledge\n" + _fmt(company)
            + "\n## Your recent relevant history\n" + _fmt(personal)
        )

    def get_role_context(self, role: str, department: str) -> str:
        """Onboarding context for an agent's system prompt."""
        chunks = self._memory.search(
            company_ns(self._company_id), f"{role} {department} responsibilities priorities", 10
        )
        return self._preamble() + "\n## Role context\n" + _fmt(chunks)

    def get_for_hunt(self, mode: str, top_k: int = 40) -> str:
        """Large but relevant context for a hunt (not the whole company)."""
        chunks = self._memory.search(company_ns(self._company_id), f"{mode} signals risks", top_k)
        return self._preamble() + f"\n## {mode} hunt context\n" + _fmt(chunks)


def _fmt(chunks) -> str:
    if not chunks:
        return "(none)\n"
    return "".join(f"- {c.text}\n" for c in chunks)
