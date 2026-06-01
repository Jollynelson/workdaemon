"""Ingestion: chunking, Notion connector, full pipeline → vectors + graph + terms."""

from __future__ import annotations

import json

from src.brain.activity_feed import ActivityFeed
from src.brain.graph import KnowledgeGraph
from src.brain.memory import MemoryManager, company_ns
from src.brain.router import BrainRouter
from src.ingestion.connectors import NotionConnector
from src.ingestion.pipeline import IngestionPipeline, chunk_text
from src.db import CompanyDB
from tests.conftest import FakeBrainClient, FakePublisher, FakeSupabase
from tests.test_context_graph import FakeEmbedder, FakeGraph, FakeStore

CO = "11111111-1111-1111-1111-111111111111"
FAST = "deepseek-v4-flash"


def test_chunking_overlaps():
    words = " ".join(f"w{i}" for i in range(900))
    chunks = chunk_text(words, size=400, overlap=64)
    assert len(chunks) >= 2
    # overlap: end of chunk0 reappears at start of chunk1
    assert chunks[0].split()[-1] in chunks[1].split()


def test_notion_connector_normalizes_pages():
    conn = NotionConnector("tok", fetch=lambda: [
        {"id": "p1", "title": "Onboarding", "text": "How we onboard clients",
         "last_edited_time": "2026-06-01"}
    ])
    items = list(conn.poll())
    assert items[0]["type"] == "page"
    assert items[0]["metadata"]["page_id"] == "p1"
    assert "onboard" in items[0]["content"]


def test_full_pipeline_chunks_embeds_extracts():
    sb = FakeSupabase()
    db = CompanyDB(CO, client=sb)
    store = FakeStore()
    mem = MemoryManager(CO, FakeEmbedder(), store)
    feed = ActivityFeed(db, publisher=FakePublisher())
    driver = FakeGraph()
    graph = KnowledgeGraph(CO, driver)
    brain = BrainRouter(FakeBrainClient(responses={
        FAST: json.dumps({"people": ["Amara"], "projects": ["Checkout"],
                          "decisions": [], "terms": [{"term": "NPS", "definition": "score"}]})
    }))
    pipe = IngestionPipeline(db, mem, feed, brain=brain, graph=graph)

    conn = NotionConnector("tok", fetch=lambda: [
        {"id": "p1", "title": "Doc", "text": "Amara owns Checkout. " * 50,
         "last_edited_time": "2026-06-01"}
    ])
    res = pipe.ingest_connector(conn)

    assert res.documents == 1 and res.chunks >= 1
    # vectors landed in the company namespace
    assert store.data[company_ns(CO)]
    # entities to graph (Person + Project) and a term to company_terminology
    assert any(n.get("key") == "Amara" for n in driver.nodes)
    assert sb.store.get("company_terminology")
    # ingestion_complete event emitted
    assert any(e["event_type"] == "ingestion_complete" for e in sb.store["activity_events"])


def test_pipeline_works_without_brain_or_graph():
    sb = FakeSupabase()
    db = CompanyDB(CO, client=sb)
    mem = MemoryManager(CO, FakeEmbedder(), FakeStore())
    pipe = IngestionPipeline(db, mem, ActivityFeed(db))
    conn = NotionConnector("tok", fetch=lambda: [{"id": "p", "title": "t", "text": "hello world"}])
    res = pipe.ingest_connector(conn)
    assert res.documents == 1 and res.entities == 0  # no brain → no entities, no crash
