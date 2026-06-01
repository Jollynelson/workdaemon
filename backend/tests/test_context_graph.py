"""RAG memory/context (prefix-stable, isolation) + knowledge graph scoping."""

from __future__ import annotations

import pytest

from src.brain.context import BrainContext
from src.brain.graph import KnowledgeGraph
from src.brain.memory import Chunk, MemoryManager, company_ns, user_ns

CO = "11111111-1111-1111-1111-111111111111"
OTHER = "22222222-2222-2222-2222-222222222222"


# ── fakes ──
class FakeEmbedder:
    def embed(self, text):
        return [float(len(text))]


class FakeStore:
    def __init__(self):
        self.data: dict[str, list] = {}

    def upsert(self, namespace, text, vector, metadata):
        self.data.setdefault(namespace, []).append((text, metadata))

    def search(self, namespace, vector, top_k):
        return [Chunk(text=t, metadata=m, score=1.0) for t, m in self.data.get(namespace, [])[:top_k]]


class FakeGraph:
    def __init__(self):
        self.calls = []
        self.nodes = []

    def run(self, cypher, params):
        self.calls.append((cypher, params))
        if cypher.startswith("MERGE"):
            self.nodes.append(params)
            return []
        if "RETURN type(r)" in cypher:
            # only neighbors within same company_id
            return [{"rel": "OWNS", "key": "proj1"}] if params["c"] == CO else []
        return []


def _mem(company_id=CO):
    return MemoryManager(company_id, FakeEmbedder(), FakeStore())


def test_memory_namespaces_distinct():
    assert company_ns(CO) == f"company_{CO}"
    assert user_ns("s1", CO) == f"user_s1_{CO}"


def test_memory_rejects_foreign_namespace():
    mem = _mem(CO)
    with pytest.raises(ValueError):
        mem.upsert(company_ns(OTHER), "secret", {})  # other company's namespace


def test_memory_upsert_and_search_roundtrip():
    mem = _mem(CO)
    mem.upsert(company_ns(CO), "Q3 priorities: ship checkout", {"src": "notion"})
    chunks = mem.search(company_ns(CO), "what are priorities", top_k=5)
    assert chunks and "checkout" in chunks[0].text


def test_context_is_prefix_stable_and_includes_sections():
    mem = _mem(CO)
    mem.upsert(company_ns(CO), "company fact A", {})
    mem.upsert(user_ns("s1", CO), "user note B", {})
    ctx = BrainContext(CO, "Acme", mem)
    out = ctx.get_for_query("anything", "s1")
    assert out.startswith(f"# Company: Acme (id {CO})")  # stable preamble first → cacheable
    assert "company fact A" in out and "user note B" in out


def test_graph_scopes_to_company():
    g = KnowledgeGraph(CO, FakeGraph())
    g.upsert_entity("Person", "amara", {"role": "PM"})
    g.relate("amara", "OWNS", "proj1")
    assert g.neighbors("amara") == [{"rel": "OWNS", "key": "proj1"}]
    # a different company sees nothing for the same key
    g_other = KnowledgeGraph(OTHER, g._driver)
    assert g_other.neighbors("amara") == []


def test_graph_rejects_unsafe_identifiers():
    g = KnowledgeGraph(CO, FakeGraph())
    with pytest.raises(ValueError):
        g.upsert_entity("Person; DROP", "x")
