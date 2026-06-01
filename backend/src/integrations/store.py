"""Per-company integration connections — connect, read (decrypted), status."""

from __future__ import annotations

from dataclasses import dataclass

from src.db import CompanyDB
from src.integrations.crypto import decrypt, encrypt


@dataclass
class Integration:
    provider: str
    access_token: str | None     # decrypted plaintext (only in memory)
    metadata: dict
    status: str


class IntegrationStore:
    def __init__(self, db: CompanyDB) -> None:
        self._db = db

    def connect(self, provider: str, access_token: str, metadata: dict | None = None) -> dict:
        """Store (or replace) a company's token for a provider, encrypted."""
        existing = self._row(provider)
        payload = {
            "provider": provider,
            "access_token": encrypt(access_token) if access_token else None,
            "metadata": metadata or {},
            "status": "connected",
            "updated_at": "now()",
        }
        if existing:
            return self._db.update("integrations", existing["id"], payload)
        return self._db.insert("integrations", payload)

    def get(self, provider: str) -> Integration | None:
        row = self._row(provider)
        if not row:
            return None
        tok = row.get("access_token")
        return Integration(
            provider=provider,
            access_token=decrypt(tok) if tok else None,
            metadata=row.get("metadata", {}),
            status=row.get("status", "connected"),
        )

    def list_connected(self) -> list[str]:
        resp = self._db.select("integrations", "provider").eq("status", "connected").execute()
        return [r["provider"] for r in (getattr(resp, "data", None) or [])]

    def mark_ingested(self, provider: str) -> None:
        row = self._row(provider)
        if row:
            self._db.update("integrations", row["id"], {"last_ingested_at": "now()"})

    def _row(self, provider: str) -> dict | None:
        resp = self._db.select("integrations").eq("provider", provider).limit(1).execute()
        rows = getattr(resp, "data", None) or []
        return rows[0] if rows else None
