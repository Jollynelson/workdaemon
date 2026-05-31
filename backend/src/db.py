"""Postgres (Supabase) access, company-scoped by construction.

`CompanyDB(company_id)` is the isolation backbone: every read is filtered by
company_id and every insert is stamped with it, so a caller cannot reach another
company's rows even by mistake. The FastAPI backend uses the service role; RLS in
the migration is a second backstop. Higher-level modules accept a CompanyDB so
tests can inject an in-memory fake (see tests/conftest.py).
"""

from __future__ import annotations

from functools import lru_cache
from typing import Any

from src.config import settings


@lru_cache(maxsize=1)
def supabase_client() -> Any:
    """Lazily create the shared service-role Supabase client."""
    if not settings.supabase_url or not settings.supabase_service_key:
        raise RuntimeError(
            "Supabase not configured: set NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY"
        )
    from supabase import create_client

    return create_client(settings.supabase_url, settings.supabase_service_key)


class CompanyDB:
    """All operations are scoped to a single company_id."""

    def __init__(self, company_id: str, client: Any | None = None) -> None:
        if not company_id:
            raise ValueError("CompanyDB requires a company_id")
        self.company_id = company_id
        self._client = client if client is not None else supabase_client()

    # ── reads ──────────────────────────────────────────────────────────────────
    def select(self, table: str, columns: str = "*") -> Any:
        """Return a query builder already filtered to this company."""
        return self._client.table(table).select(columns).eq("company_id", self.company_id)

    def get(self, table: str, row_id: str, columns: str = "*") -> dict | None:
        resp = self.select(table, columns).eq("id", row_id).limit(1).execute()
        data = getattr(resp, "data", None) or []
        return data[0] if data else None

    # ── writes (company_id is forced, never trusted from the caller) ────────────
    def insert(self, table: str, row: dict) -> dict:
        payload = {**row, "company_id": self.company_id}
        resp = self._client.table(table).insert(payload).execute()
        data = getattr(resp, "data", None) or []
        return data[0] if data else payload

    def update(self, table: str, row_id: str, patch: dict) -> dict | None:
        resp = (
            self._client.table(table)
            .update(patch)
            .eq("id", row_id)
            .eq("company_id", self.company_id)
            .execute()
        )
        data = getattr(resp, "data", None) or []
        return data[0] if data else None
