"""Run ingestion for a company's connected source into live RAG + graph.

Ties: IntegrationStore (decrypted token) → the right Connector → IngestionPipeline
(chunk → embed → pgvector upsert → entity extraction → graph + terminology).
Used by onboarding (first ingest) and the scheduled re-ingest.
"""

from __future__ import annotations

from typing import Any

from src.brain.activity_feed import ActivityFeed
from src.brain.memory import MemoryManager
from src.brain.router import default_router
from src.db import CompanyDB
from src.ingestion.connectors import NotionConnector
from src.ingestion.pipeline import IngestionPipeline
from src.integrations.store import IntegrationStore


def _connector_for(provider: str, token: str, metadata: dict) -> Any:
    if provider == "notion":
        return NotionConnector(token)
    if provider == "slack":
        from src.ingestion.slack_connector import SlackConnector

        return SlackConnector(token, channels=metadata.get("channels"))
    raise ValueError(f"no connector for provider '{provider}'")


def ingest_company_source(company_id: str, provider: str) -> dict:
    """Ingest one connected source for a company into its RAG namespace + graph."""
    db = CompanyDB(company_id)
    store = IntegrationStore(db)
    integ = store.get(provider)
    if integ is None or not integ.access_token:
        return {"company_id": company_id, "provider": provider, "error": "not_connected"}

    # live RAG store + optional graph + brain for entity extraction
    from src.api.deps import _safe_publisher  # reuse the publisher resolver
    from src.brain.vector_store import default_embedder, pgvector_store

    mem = MemoryManager(company_id, default_embedder(), pgvector_store())
    feed = ActivityFeed(db, publisher=_safe_publisher())
    graph = _safe_graph(company_id)

    pipe = IngestionPipeline(db, mem, feed, brain=default_router(), graph=graph)
    connector = _connector_for(provider, integ.access_token, integ.metadata)
    result = pipe.ingest_connector(connector)
    store.mark_ingested(provider)
    return {
        "company_id": company_id, "provider": provider,
        "documents": result.documents, "chunks": result.chunks, "entities": result.entities,
    }


def ingest_all_connected(company_id: str) -> list[dict]:
    store = IntegrationStore(CompanyDB(company_id))
    return [ingest_company_source(company_id, p) for p in store.list_connected()]


def _safe_graph(company_id: str):
    """Knowledge graph if Neo4j is configured, else None (ingestion still stores RAG)."""
    try:
        from src.brain.graph import KnowledgeGraph, neo4j_driver
        from src.config import settings

        if not settings.neo4j_password:
            return None
        return KnowledgeGraph(company_id, neo4j_driver())
    except Exception:
        return None
