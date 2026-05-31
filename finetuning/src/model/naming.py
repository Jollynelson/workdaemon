"""
Canonical naming conventions for every per-company artifact.

All company isolation is rooted here — one function per artifact type,
all keyed by company_id. Call nothing directly; go through these helpers.
"""

from __future__ import annotations

from src.config import settings


# ── Model names ───────────────────────────────────────────────────────────────

def wd_model(company_id: str) -> str:
    """Ollama model name for a company's deployed adapter."""
    return f"wd-{company_id}"


def wd_eval_model(company_id: str) -> str:
    """Temporary Ollama model name used during gate evaluation — never served."""
    return f"wd-{company_id}-eval"


# ── Hugging Face adapter repo ─────────────────────────────────────────────────

def adapter_repo(company_id: str) -> str:
    """Private HF repo where LoRA adapters + GGUFs are versioned."""
    return f"{settings.hf_org}/{company_id}-adapter"


# ── Vector namespaces ─────────────────────────────────────────────────────────

def company_namespace(company_id: str) -> str:
    """Company-wide vector namespace: all ingested docs + interaction patterns."""
    return f"company_{company_id}"


def user_namespace(staff_id: str, company_id: str) -> str:
    """Per-staff personal memory namespace.

    Scoped to company to prevent cross-company user ID collisions.
    """
    return f"user_{staff_id}_{company_id}"


def role_namespace(role: str, company_id: str) -> str:
    """Anonymised role-level namespace for cross-staff pattern learning."""
    safe_role = role.lower().replace(" ", "_").replace("/", "_")
    return f"role_{safe_role}_{company_id}"


# ── Validation ────────────────────────────────────────────────────────────────

def assert_namespace_scoped(namespace: str, company_id: str) -> None:
    """Raise if namespace does not belong to company_id.

    Called defensively before any vector operation to prevent cross-company reads.
    """
    if company_id not in namespace:
        raise PermissionError(
            f"Namespace '{namespace}' does not belong to company '{company_id}'. "
            "Cross-company vector access is forbidden."
        )
