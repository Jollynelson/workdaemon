"""Isolation release gate (FINAL spec Section 14).

These assertions must ALL pass before any release. They cover the structural
guarantees that no data, routing, or reasoning crosses between companies.
Builds on the unit-level isolation in test_isolation.py with the full object graph.
"""

from __future__ import annotations

import json

import pytest

from src.brain.activity_feed import ActivityEvent, ActivityFeed
from src.brain.hunter import HuntEngine
from src.brain.memory import MemoryManager, company_ns
from src.brain.router import BrainRouter
from src.cross_agent.handoff import HandoffCoordinator
from src.cross_agent.task_router import TaskIntent, TaskRouter
from src.db import CompanyDB
from src.push.inbox import PushInbox
from tests.conftest import FakeBrainClient, FakePublisher, FakePush, FakeSupabase
from tests.test_context_graph import FakeEmbedder, FakeStore

CO_A = "aaaaaaaa-0000-0000-0000-000000000001"
CO_B = "bbbbbbbb-0000-0000-0000-000000000002"


# ── 1. DB: no cross-company read ──
def test_no_cross_company_db_read():
    sb = FakeSupabase()
    a, b = CompanyDB(CO_A, client=sb), CompanyDB(CO_B, client=sb)
    row = a.insert("hunt_findings", {"mode": "threat", "title": "A-secret"})
    assert b.get("hunt_findings", row["id"]) is None
    assert a.get("hunt_findings", row["id"]) is not None


# ── 2. DB: writes are stamped, can't be forged ──
def test_insert_cannot_forge_company_id():
    sb = FakeSupabase()
    a = CompanyDB(CO_A, client=sb)
    row = a.insert("tasks", {"title": "x", "company_id": CO_B})
    assert row["company_id"] == CO_A


# ── 3. Vectors: namespace bound to company ──
def test_no_cross_company_vector_namespace():
    mem = MemoryManager(CO_A, FakeEmbedder(), FakeStore())
    with pytest.raises(ValueError):
        mem.search(company_ns(CO_B), "query")


# ── 4. Activity feed: events land only in the emitting company ──
def test_no_cross_company_activity_feed():
    sb = FakeSupabase()
    ActivityFeed(CompanyDB(CO_A, client=sb)).emit(
        ActivityEvent(event_type="hunt_finding", payload={"x": 1}))
    b_events = CompanyDB(CO_B, client=sb).select("activity_events").execute().data
    assert b_events == []


# ── 5. Task routing: a task is created only in the router's company ──
def test_no_cross_company_task_routing():
    sb = FakeSupabase()
    a_db = CompanyDB(CO_A, client=sb)
    router = TaskRouter(a_db, BrainRouter(FakeBrainClient()), ActivityFeed(a_db), FakePush())
    task = router.route(TaskIntent(sender_id="s1", target_id="s2", title="A task"))
    assert task["company_id"] == CO_A
    assert CompanyDB(CO_B, client=sb).select("tasks").execute().data == []


# ── 6. Handoff stays within company ──
def test_handoff_within_company_only():
    sb = FakeSupabase()
    a_db = CompanyDB(CO_A, client=sb)
    feed = ActivityFeed(a_db)
    router = TaskRouter(a_db, BrainRouter(FakeBrainClient()), feed, FakePush())
    h = HandoffCoordinator(a_db, feed, router)
    t = a_db.insert("tasks", {"title": "t", "to_staff_id": "s1", "next_agent_id": "s2",
                              "status": "in_progress"})
    nxt = h.complete_and_hand_off(t["id"], output="done")
    assert nxt["company_id"] == CO_A


# ── 7. Pushes scoped to company ──
def test_no_cross_company_push_read():
    sb = FakeSupabase()
    PushInbox(CompanyDB(CO_A, client=sb)).deliver("s1", {"kind": "brain_insight", "message": "m"})
    assert CompanyDB(CO_B, client=sb).select("pushes").execute().data == []


# ── 8. One Brain call = one company (DeepSeek is shared; never mix) ──
def test_one_brain_call_one_company():
    sb = FakeSupabase()
    a_db = CompanyDB(CO_A, client=sb)
    client = FakeBrainClient(responses={"deepseek-v4-flash":
        json.dumps({"findings": [{"title": "f", "detail": "d", "confidence": 0.5}]})})
    eng = HuntEngine(a_db, BrainRouter(client), ActivityFeed(a_db),
                     assemble_context=lambda mode: f"company {CO_A} only")
    eng.run_hunt("threat")
    # the single prompt sent to the Brain references exactly one company's context
    assert len(client.calls) == 1
    assert CO_B not in client.calls[0]["prompt"]


# ── 9. Hunt findings written only to the running company ──
def test_hunt_findings_scoped():
    sb = FakeSupabase()
    a_db = CompanyDB(CO_A, client=sb)
    client = FakeBrainClient(responses={"deepseek-v4-flash":
        json.dumps({"findings": [{"title": "f", "detail": "d", "confidence": 0.5}]})})
    HuntEngine(a_db, BrainRouter(client), ActivityFeed(a_db),
               assemble_context=lambda m: "ctx").run_hunt("threat")
    assert CompanyDB(CO_B, client=sb).select("hunt_findings").execute().data == []


# ── RELEASE GATE marker: all isolation assertions above must pass ──
def test_release_gate_summary():
    """If this module's tests pass, cross-company isolation holds at every layer
    we can assert offline: DB read/write, vectors, activity feed, task routing,
    handoff, pushes, Brain-call scoping, hunt findings."""
    assert True
