"""
Memory namespace management.

Three namespaces per company:
  company_{company_id}         — shared company knowledge + patterns
  user_{staff_id}_{company_id} — individual staff memory (personal preferences, context)
  role_{role}_{company_id}     — anonymised role-level patterns (new hires start calibrated)

Namespaces are never deleted for active staff; archived on offboarding (not exposed).
"""

from __future__ import annotations

import logging

from src.model.naming import (
    company_namespace,
    role_namespace,
    user_namespace,
)
from src import vectors

logger = logging.getLogger(__name__)

# Role-context seed documents that prime a new staff member's namespace
_ROLE_SEED: dict[str, str] = {
    "junior": (
        "As a junior team member, your agent focuses on task guidance, "
        "finding company knowledge, and navigating onboarding. "
        "You have access to Slack, Notion, and Google Drive."
    ),
    "manager": (
        "As a manager, your agent focuses on team delivery, CRM pipeline, "
        "project health, and blocking issue resolution. "
        "You have access to Slack, Notion, Google Drive, CRM, and project tools."
    ),
    "director": (
        "As a director, your agent focuses on department performance, "
        "cross-team alignment, financial health, and people signals. "
        "You have full access plus Finance and HR."
    ),
    "executive": (
        "As an executive, your agent has full company visibility: "
        "KPIs, threats, opportunities, and strategic alignment across all teams."
    ),
}


def create_namespace(company_id: str, staff_id: str, access_level: str = "junior") -> str:
    """
    Create and seed a personal memory namespace for a new staff member.
    Returns the namespace key.
    """
    ns = user_namespace(staff_id, company_id)
    role_seed = _ROLE_SEED.get(access_level, _ROLE_SEED["junior"])
    vectors.upsert(
        company_id=company_id,
        namespace=ns,
        documents=[{"content": role_seed, "metadata": {"type": "role_seed", "access_level": access_level}}],
    )
    logger.info("Created namespace %s for staff=%s", ns, staff_id)
    return ns


def archive_namespace(company_id: str, staff_id: str) -> None:
    """
    Archive a departed staff member's namespace.

    We do NOT delete — the company model retains learned patterns.
    We delete the *raw personal documents* to comply with privacy (Section 14),
    but the anonymised patterns contributed to company + role namespaces remain.
    """
    ns = user_namespace(staff_id, company_id)
    deleted = vectors.delete_namespace(company_id, ns)
    logger.info("Archived namespace %s (%d docs removed).", ns, deleted)


def upsert_memory(
    company_id: str,
    staff_id: str,
    content: str,
    metadata: dict | None = None,
) -> None:
    """Store a new memory in the staff member's personal namespace."""
    ns = user_namespace(staff_id, company_id)
    vectors.upsert(
        company_id=company_id,
        namespace=ns,
        documents=[{"content": content, "metadata": metadata or {}}],
    )


def upsert_company_pattern(
    company_id: str,
    content: str,
    metadata: dict | None = None,
) -> None:
    """Store a pattern in the company-wide namespace."""
    ns = company_namespace(company_id)
    vectors.upsert(
        company_id=company_id,
        namespace=ns,
        documents=[{"content": content, "metadata": metadata or {}}],
    )


def upsert_role_pattern(
    company_id: str,
    role: str,
    content: str,
    metadata: dict | None = None,
) -> None:
    """Store an anonymised pattern in the role namespace."""
    ns = role_namespace(role, company_id)
    vectors.upsert(
        company_id=company_id,
        namespace=ns,
        documents=[{"content": content, "metadata": metadata or {}}],
    )


def get_personal_context(company_id: str, staff_id: str, query: str, top_k: int = 4) -> list[dict]:
    """Search this staff member's personal memory for query-relevant context."""
    ns = user_namespace(staff_id, company_id)
    return vectors.search(company_id=company_id, namespace=ns, query=query, top_k=top_k)


def get_company_context(company_id: str, query: str, top_k: int = 8) -> list[dict]:
    """Search the company-wide knowledge namespace."""
    ns = company_namespace(company_id)
    return vectors.search(company_id=company_id, namespace=ns, query=query, top_k=top_k)


def get_role_context(company_id: str, role: str, query: str, top_k: int = 4) -> list[dict]:
    """Search the role-level pattern namespace."""
    ns = role_namespace(role, company_id)
    return vectors.search(company_id=company_id, namespace=ns, query=query, top_k=top_k)
