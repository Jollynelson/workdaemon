"""Ingestion pipeline (FINAL spec §12): normalize → chunk → embed → upsert,
then extract entities → graph + company_terminology, and emit ingestion_complete.

Everything (memory, graph, brain, db) is injected, so the full pipeline runs in
tests without external services.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Iterable

from src.brain.activity_feed import ActivityEvent, ActivityFeed
from src.brain.memory import MemoryManager, company_ns
from src.brain.router import BrainRouter
from src.db import CompanyDB
from src.ingestion.connectors import Connector
from src.ingestion.entity_extractor import extract_entities
from src.ingestion.normalize import Document, normalize

CHUNK_TOKENS = 400      # ~256-512 token target
CHUNK_OVERLAP = 64


def chunk_text(text: str, size: int = CHUNK_TOKENS, overlap: int = CHUNK_OVERLAP) -> list[str]:
    """Word-based chunking (token-approx) with overlap."""
    words = text.split()
    if not words:
        return []
    chunks, start = [], 0
    while start < len(words):
        chunks.append(" ".join(words[start:start + size]))
        if start + size >= len(words):
            break
        start += size - overlap
    return chunks


@dataclass
class IngestResult:
    documents: int
    chunks: int
    entities: int


class IngestionPipeline:
    def __init__(
        self,
        db: CompanyDB,
        memory: MemoryManager,
        feed: ActivityFeed,
        brain: BrainRouter | None = None,
        graph=None,
    ) -> None:
        self._db = db
        self._memory = memory
        self._feed = feed
        self._brain = brain
        self._graph = graph

    def ingest_connector(self, connector: Connector) -> IngestResult:
        docs = (normalize(raw, source=connector.source, company_id=self._db.company_id)
                for raw in connector.poll())
        return self.ingest_documents(docs)

    def ingest_documents(self, docs: Iterable[Document]) -> IngestResult:
        n_docs = n_chunks = n_entities = 0
        ns = company_ns(self._db.company_id)
        for doc in docs:
            n_docs += 1
            for chunk in chunk_text(doc.content):
                self._memory.upsert(ns, chunk, {"source": doc.source, **doc.metadata})
                n_chunks += 1
            n_entities += self._extract_and_store(doc)

        self._feed.emit(ActivityEvent(
            event_type="ingestion_complete",
            payload={"documents": n_docs, "chunks": n_chunks, "entities": n_entities},
        ))
        return IngestResult(documents=n_docs, chunks=n_chunks, entities=n_entities)

    def _extract_and_store(self, doc: Document) -> int:
        ents = extract_entities(self._brain, doc.content)
        count = 0
        if self._graph:
            for person in ents.people:
                self._graph.upsert_entity("Person", person); count += 1
            for proj in ents.projects:
                self._graph.upsert_entity("Project", proj); count += 1
            for dec in ents.decisions:
                self._graph.upsert_entity("Decision", dec); count += 1
        for term in ents.terms:
            self._db.insert("company_terminology",
                            {"term": term.get("term", ""), "definition": term.get("definition", ""),
                             "source": doc.source})
            count += 1
        return count
