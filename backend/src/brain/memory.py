"""Vector memory — namespaced per company + per user (FINAL spec Section 8/13).

Namespaces: company_{id} and user_{staff}_{company}. No global namespace —
isolation is structural. The embedding + vector store are injected behind
protocols; prod uses OpenAI embeddings + pgvector, tests use fakes.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Protocol


def company_ns(company_id: str) -> str:
    return f"company_{company_id}"


def user_ns(staff_id: str, company_id: str) -> str:
    return f"user_{staff_id}_{company_id}"


@dataclass
class Chunk:
    text: str
    metadata: dict
    score: float = 0.0


class Embedder(Protocol):
    def embed(self, text: str) -> list[float]: ...


class VectorStore(Protocol):
    def upsert(self, namespace: str, text: str, vector: list[float], metadata: dict) -> None: ...
    def search(self, namespace: str, vector: list[float], top_k: int) -> list[Chunk]: ...


class MemoryManager:
    def __init__(self, company_id: str, embedder: Embedder, store: VectorStore) -> None:
        self._company_id = company_id
        self._embedder = embedder
        self._store = store

    def create_namespace(self, namespace: str) -> None:
        # pgvector namespaces are implicit (a column); nothing to pre-create.
        # Hook retained for stores that need explicit namespace setup.
        return None

    def upsert(self, namespace: str, text: str, metadata: dict | None = None) -> None:
        self._assert_scoped(namespace)
        self._store.upsert(namespace, text, self._embedder.embed(text), metadata or {})

    def search(self, namespace: str, query: str, top_k: int = 8) -> list[Chunk]:
        self._assert_scoped(namespace)
        return self._store.search(namespace, self._embedder.embed(query), top_k)

    def _assert_scoped(self, namespace: str) -> None:
        """A namespace must belong to THIS company — isolation backstop."""
        if not namespace.endswith(self._company_id) and self._company_id not in namespace:
            raise ValueError(f"namespace {namespace!r} not scoped to company {self._company_id}")
