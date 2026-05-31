"""
Namespaced pgvector wrapper.

All operations take an explicit (company_id, namespace) pair. The namespace
must contain the company_id — enforced via naming.assert_namespace_scoped().
This is the second structural isolation guarantee after db.py's company_id filters.

Embeddings are obtained via OpenAI text-embedding-3-small (1536 dims).
The EMBEDDING_MODEL setting controls which model is used; swapping it requires
a re-index (background job).
"""

from __future__ import annotations

import json
import logging
from typing import Any

from src.config import settings
from src.model.naming import assert_namespace_scoped

logger = logging.getLogger(__name__)

# Heavy deps (psycopg2, openai) are imported lazily inside the functions that
# need them, so this module imports cleanly on machines without them installed
# (matches the deferred-import pattern in train.py and gate.py).

_pg_conn: Any = None
_openai_client: Any = None


def _pg() -> Any:
    global _pg_conn
    import psycopg2
    import psycopg2.extras
    if _pg_conn is None or _pg_conn.closed:
        _pg_conn = psycopg2.connect(settings.postgres_url)
        _pg_conn.autocommit = False
        psycopg2.extras.register_uuid(_pg_conn)
    return _pg_conn


def _embed_client() -> Any:
    global _openai_client
    from openai import OpenAI
    if _openai_client is None:
        _openai_client = OpenAI(api_key=settings.openai_api_key)
    return _openai_client


# ── Embedding ─────────────────────────────────────────────────────────────────

def embed(text: str) -> list[float]:
    """Embed a single string. Truncates to 8000 chars to stay within token limits."""
    text = text[:8000].replace("\n", " ")
    response = _embed_client().embeddings.create(
        input=[text],
        model=settings.embedding_model,
    )
    return response.data[0].embedding


def embed_batch(texts: list[str]) -> list[list[float]]:
    """Embed multiple strings in one API call (max 2048 inputs)."""
    cleaned = [t[:8000].replace("\n", " ") for t in texts]
    response = _embed_client().embeddings.create(
        input=cleaned,
        model=settings.embedding_model,
    )
    return [item.embedding for item in sorted(response.data, key=lambda x: x.index)]


# ── Upsert ────────────────────────────────────────────────────────────────────

def upsert(
    company_id: str,
    namespace: str,
    documents: list[dict],
) -> int:
    """
    Embed and upsert documents into vector_documents.

    Each document dict: {"content": str, "metadata": dict (optional), "id": str (optional)}
    Returns the number of rows inserted.
    """
    assert_namespace_scoped(namespace, company_id)

    if not documents:
        return 0

    texts = [d["content"] for d in documents]
    embeddings = embed_batch(texts)

    conn = _pg()
    cur = conn.cursor()
    count = 0
    for doc, emb in zip(documents, embeddings):
        meta = json.dumps(doc.get("metadata", {}))
        cur.execute(
            """
            insert into vector_documents (company_id, namespace, content, embedding, metadata)
            values (%s, %s, %s, %s::vector, %s::jsonb)
            """,
            (company_id, namespace, doc["content"], emb, meta),
        )
        count += 1
    conn.commit()
    cur.close()
    logger.debug("Upserted %d docs → namespace=%s", count, namespace)
    return count


# ── Search ────────────────────────────────────────────────────────────────────

def search(
    company_id: str,
    namespace: str,
    query: str,
    top_k: int = 8,
) -> list[dict]:
    """
    Semantic search within a namespace.

    Returns list of {"content": str, "metadata": dict, "score": float}.
    Only searches within the given company_id + namespace — never leaks.
    """
    assert_namespace_scoped(namespace, company_id)

    import psycopg2.extras
    query_embedding = embed(query)
    conn = _pg()
    cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
    cur.execute(
        """
        select content, metadata,
               1 - (embedding <=> %s::vector) as score
          from vector_documents
         where company_id = %s
           and namespace  = %s
         order by embedding <=> %s::vector
         limit %s
        """,
        (query_embedding, company_id, namespace, query_embedding, top_k),
    )
    rows = cur.fetchall()
    cur.close()
    return [
        {
            "content":  r["content"],
            "metadata": r["metadata"] or {},
            "score":    float(r["score"]),
        }
        for r in rows
    ]


# ── Namespace management ──────────────────────────────────────────────────────

def delete_namespace(company_id: str, namespace: str) -> int:
    """Delete all vectors in a namespace. Used for offboarding / re-indexing."""
    assert_namespace_scoped(namespace, company_id)
    conn = _pg()
    cur = conn.cursor()
    cur.execute(
        "delete from vector_documents where company_id = %s and namespace = %s",
        (company_id, namespace),
    )
    deleted = cur.rowcount
    conn.commit()
    cur.close()
    logger.info("Deleted %d docs from namespace=%s", deleted, namespace)
    return deleted


def namespace_doc_count(company_id: str, namespace: str) -> int:
    """How many documents are stored in a namespace."""
    assert_namespace_scoped(namespace, company_id)
    conn = _pg()
    cur = conn.cursor()
    cur.execute(
        "select count(*) from vector_documents where company_id = %s and namespace = %s",
        (company_id, namespace),
    )
    (count,) = cur.fetchone()
    cur.close()
    return int(count)
