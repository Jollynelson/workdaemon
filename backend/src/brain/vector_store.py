"""Production embedder + pgvector store (FINAL spec Section 3/12).

Kept separate from memory.py (which holds the protocols + namespacing) so the
live dependencies (openai, supabase/pgvector) are only imported when actually
used. Both satisfy the Embedder / VectorStore protocols in memory.py.
"""

from __future__ import annotations

from typing import Any

from src.brain.memory import Chunk
from src.config import settings


def openai_embedder() -> Any:
    from openai import OpenAI

    client = OpenAI(api_key=settings.openai_api_key)
    model = settings.embedding_model

    class _OpenAIEmbedder:
        def embed(self, text: str) -> list[float]:
            resp = client.embeddings.create(model=model, input=text)
            return resp.data[0].embedding

    return _OpenAIEmbedder()


def pgvector_store() -> Any:
    """pgvector-backed store via Supabase RPC.

    Expects a `match_memory(namespace, query_embedding, match_count)` SQL function
    and a `memory_chunks(namespace, content, embedding, metadata)` table (added in
    a later migration). Until then this raises at call time, so deps.brain_context
    falls back to no-RAG cleanly.
    """
    from src.db import supabase_client

    client = supabase_client()

    class _PgVectorStore:
        def upsert(self, namespace: str, text: str, vector: list[float], metadata: dict) -> None:
            client.table("memory_chunks").insert(
                {"namespace": namespace, "content": text, "embedding": vector,
                 "metadata": metadata}
            ).execute()

        def search(self, namespace: str, vector: list[float], top_k: int) -> list[Chunk]:
            resp = client.rpc(
                "match_memory",
                {"p_namespace": namespace, "query_embedding": vector, "match_count": top_k},
            ).execute()
            rows = getattr(resp, "data", None) or []
            return [Chunk(text=r["content"], metadata=r.get("metadata", {}),
                          score=r.get("similarity", 0.0)) for r in rows]

    return _PgVectorStore()
