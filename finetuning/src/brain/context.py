"""
Brain context layer — assemble the context block injected into every agent prompt.

Two entry points:
  get_role_context(role, department) → used at conversation start
  get_for_query(query, staff_id)     → used mid-conversation for query-specific retrieval

Facts come from retrieval (RAG). Behavior comes from fine-tuning.
This module is pure retrieval — it never writes.
"""

from __future__ import annotations

import logging
from datetime import datetime, timezone

from src import brain  # noqa: F401 — avoids circular on package import
from src.brain import memory
from src.model.naming import company_namespace, role_namespace

logger = logging.getLogger(__name__)


def get_role_context(
    company_id: str,
    role: str,
    department: str,
    top_k_company: int = 8,
    top_k_role: int = 4,
) -> str:
    """
    Assemble a role-appropriate context block for the conversation start.
    Called by agents/factory.py at the beginning of every conversation.
    """
    query = f"{role} {department} responsibilities priorities current focus"

    company_docs = memory.get_company_context(company_id, query, top_k=top_k_company)
    role_docs    = memory.get_role_context(company_id, role, query, top_k=top_k_role)

    parts: list[str] = []

    if company_docs:
        parts.append("### Company Knowledge")
        for d in company_docs:
            parts.append(d["content"][:600])

    if role_docs:
        parts.append(f"### {role} Role Context")
        for d in role_docs:
            parts.append(d["content"][:400])

    now = datetime.now(timezone.utc).strftime("%H:%M UTC")
    parts.insert(0, f"### Live Context — {now}")

    return "\n\n".join(parts)


def get_for_query(
    company_id: str,
    query: str,
    staff_id: str,
    top_k_company: int = 8,
    top_k_personal: int = 4,
) -> dict:
    """
    Retrieve context specifically relevant to what the staff member just asked.
    Returns {"company": str, "personal": str} for prompt injection.
    """
    company_docs  = memory.get_company_context(company_id, query, top_k=top_k_company)
    personal_docs = memory.get_personal_context(company_id, staff_id, query, top_k=top_k_personal)

    def _fmt(docs: list[dict]) -> str:
        return "\n\n".join(d["content"][:600] for d in docs) if docs else ""

    return {
        "company":  _fmt(company_docs),
        "personal": _fmt(personal_docs),
    }


def format_context_block(company_ctx: str, personal_ctx: str) -> str:
    """Format retrieval results into the context block for the system prompt."""
    lines = []
    if company_ctx:
        lines.append(f"COMPANY KNOWLEDGE:\n{company_ctx}")
    if personal_ctx:
        lines.append(f"YOUR CONTEXT:\n{personal_ctx}")
    return "\n\n".join(lines)
