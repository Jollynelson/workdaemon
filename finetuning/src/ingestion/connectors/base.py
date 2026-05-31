"""
Base connector interface.

Every tool connector implements either poll() (pull on a schedule) or
registers a webhook handler that calls on_webhook(). Both paths produce
normalized documents and hand them to the ingestion pipeline.

This interface is the seam for Reality Check 3: a connector can be upgraded
from polling to streaming/webhooks without touching the pipeline or any
other connector.
"""

from __future__ import annotations

from abc import ABC, abstractmethod

from src.ingestion.pipeline import ingest_batch


class BaseConnector(ABC):
    """Subclass per tool. Set `source` and implement fetch()."""

    source: str = "base"

    def __init__(self, company_id: str, config: dict | None = None):
        self.company_id = company_id
        self.config = config or {}

    @abstractmethod
    def fetch(self) -> list[dict]:
        """Return raw source records (un-normalized). One dict per document."""

    @abstractmethod
    def normalize_one(self, raw: dict) -> dict:
        """Turn one raw record into a standard normalized document."""

    def poll(self) -> int:
        """
        Pull → normalize → ingest. Returns total chunks ingested.
        Called on a schedule (default 15 min) by the ingestion scheduler.
        """
        raw_records = self.fetch()
        docs = [self.normalize_one(r) for r in raw_records]
        return ingest_batch(docs, self.company_id)

    def on_webhook(self, payload: dict) -> int:
        """
        Handle a single webhook event (for tools that support push).
        Default: normalize + ingest the one record. Override for batching.
        """
        doc = self.normalize_one(payload)
        return ingest_batch([doc], self.company_id)
