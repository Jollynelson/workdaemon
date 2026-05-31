"""
Ingestion pipeline: normalized doc → chunk → embed → upsert into pgvector.

Connector interface:
  Each connector in src/ingestion/connectors/ implements:
    poll(company_id, config) → list[dict]   (normalized docs)
  or registers a webhook handler that calls ingest_document() directly.

This file is the single entry point from connectors into the vector store.
"""

from __future__ import annotations

import logging
import re
from typing import Iterator

from src import vectors
from src.model.naming import company_namespace

logger = logging.getLogger(__name__)

CHUNK_SIZE    = 400   # tokens ≈ words (approx)
CHUNK_OVERLAP = 64


def ingest_document(
    doc: dict,
    company_id: str,
) -> int:
    """
    Process one normalized document: chunk → embed → upsert.

    Returns the number of chunks upserted.
    """
    content = doc.get("content", "").strip()
    if not content or len(content) < 20:
        return 0

    chunks = list(_chunk(content))
    ns = company_namespace(company_id)

    documents = [
        {
            "content":  chunk,
            "metadata": {
                "source":    doc.get("source"),
                "type":      doc.get("type"),
                "author":    doc.get("author"),
                "timestamp": doc.get("timestamp"),
                "company_id": company_id,
                **doc.get("metadata", {}),
            },
        }
        for chunk in chunks
    ]

    vectors.upsert(company_id=company_id, namespace=ns, documents=documents)

    # Extract terminology on the way in
    _extract_terminology(content, doc, company_id)

    logger.debug("Ingested %d chunks from %s/%s", len(chunks), doc.get("source"), doc.get("type"))
    return len(chunks)


def ingest_batch(docs: list[dict], company_id: str) -> int:
    """Ingest multiple normalized documents. Returns total chunks upserted."""
    total = 0
    for doc in docs:
        total += ingest_document(doc, company_id)
    logger.info("Batch ingested %d chunks from %d docs for company=%s", total, len(docs), company_id)
    return total


# ── Chunking ──────────────────────────────────────────────────────────────────

def _chunk(text: str, size: int = CHUNK_SIZE, overlap: int = CHUNK_OVERLAP) -> Iterator[str]:
    """Sliding window chunker — splits on sentence/paragraph boundaries."""
    words = text.split()
    if len(words) <= size:
        yield text
        return

    start = 0
    while start < len(words):
        end = min(start + size, len(words))
        chunk = " ".join(words[start:end])
        yield chunk
        start += size - overlap


# ── Terminology extraction ────────────────────────────────────────────────────

_TERM_PATTERN = re.compile(
    r'(?:we call|our term for|known as|referred to as|abbreviated as)\s+"?([A-Z][A-Za-z\s]+)"?',
    re.IGNORECASE,
)


def _extract_terminology(content: str, doc: dict, company_id: str) -> None:
    """
    Heuristically extract company terminology from ingested text.
    Writes to cb_company_terminology via a background-safe import.
    """
    try:
        from src.db import db
        matches = _TERM_PATTERN.findall(content)
        for term in matches[:5]:  # cap per doc to avoid noise
            term = term.strip()
            if 2 < len(term) < 50:
                db().table("cb_company_terminology").upsert({
                    "company_id": company_id,
                    "term":       term,
                    "definition": f"Term extracted from {doc.get('source','unknown')} document.",
                    "source":     doc.get("source"),
                }, on_conflict="company_id,term").execute()
    except Exception as exc:
        logger.debug("Terminology extraction skipped: %s", exc)
