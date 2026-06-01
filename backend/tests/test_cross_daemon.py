"""Cross-daemon negotiation — the 3 scenarios + capacity + proactive signal."""

from __future__ import annotations

import json

from src.brain.activity_feed import ActivityFeed
from src.brain.router import BrainRouter
from src.cross_agent.bus import CrossAgentBus
from src.cross_agent.capacity import assess_workload
from src.cross_agent.negotiation import NegotiationEngine
from src.cross_agent.task_router import TaskIntent, TaskRouter
from src.db import CompanyDB
from tests.conftest import FakeBrainClient, FakePublisher, FakePush, FakeSupabase

CO = "11111111-1111-1111-1111-111111111111"
AMARA = "amara-pm"
ZOE = "zoe-designer"
FAST = "deepseek-v4-flash"


def _engine(sb, brain_responses=None):
    db = CompanyDB(CO, client=sb)
    feed = ActivityFeed(db, publisher=FakePublisher())
    brain = BrainRouter(FakeBrainClient(responses=brain_responses or {}))
    router = TaskRouter(db, brain, feed, FakePush())
    bus = CrossAgentBus(db, publisher=FakePublisher())
    return db, NegotiationEngine(db, brain, router, bus, now_iso="2026-06-01")


def _give_tasks(db, staff_id, n, status="in_progress"):
    for i in range(n):
        db.insert("tasks", {"to_staff_id": staff_id, "title": f"t{i}", "status": status})


# ── capacity reasoning ──
def test_capacity_discounts_blocked_tasks():
    sb = FakeSupabase()
    db = CompanyDB(CO, client=sb)
    _give_tasks(db, ZOE, 2, status="in_progress")
    _give_tasks(db, ZOE, 3, status="blocked")  # blocked → not active
    w = assess_workload(db, ZOE)
    assert w.open_count == 5 and w.active_count == 2 and w.blocked_count == 3
    assert w.load == "MEDIUM"  # only 2 active


# ── Scenario 1: capacity OK → smooth assign ──
def test_scenario1_smooth_assignment():
    sb = FakeSupabase()
    db, eng = _engine(sb)
    _give_tasks(db, ZOE, 1)  # LOW load
    decision = eng.propose_assignment(
        TaskIntent(sender_id=AMARA, title="Checkout Redesign", priority="high"),
        assignee_id=ZOE, assignee_name="Zoe",
    )
    assert decision.status == "assigned"
    assert decision.task["to_staff_id"] == ZOE
    # TASK_ASSIGNED daemon event emitted
    assert any(e["payload"].get("daemon_event") == "TASK_ASSIGNED"
               for e in sb.store.get("activity_events", []))


# ── Scenario 2: overloaded → decision surfaced, NOT assigned ──
def test_scenario2_overload_surfaces_decision_without_assigning():
    sb = FakeSupabase()
    options = {"options": [
        {"label": "Reassign to Marcus", "detail": "1 open task", "risk": "needs brief"},
        {"label": "Extend to Monday", "detail": "Sprint 23 absorbs", "risk": "later delivery"},
    ]}
    db, eng = _engine(sb, brain_responses={FAST: json.dumps(options)})
    _give_tasks(db, ZOE, 4)  # HIGH load
    decision = eng.propose_assignment(
        TaskIntent(sender_id=AMARA, title="Checkout Redesign"),
        assignee_id=ZOE, assignee_name="Zoe",
    )
    assert decision.status == "decision_required"
    assert decision.workload.load == "HIGH"
    assert len(decision.options) == 2
    # crucially: no task was created
    assert sb.store.get("tasks", []) and all(t["to_staff_id"] == ZOE and t["title"].startswith("t")
                                             for t in sb.store["tasks"])
    assert not any(t.get("title") == "Checkout Redesign" for t in sb.store["tasks"])


# ── Scenario 3: assignee daemon pushes back after assignment ──
def test_scenario3_flag_after_assignment():
    sb = FakeSupabase()
    db, eng = _engine(sb)
    task = db.insert("tasks", {"to_staff_id": ZOE, "from_staff_id": AMARA,
                               "title": "Checkout Redesign", "status": "pending"})
    eng.flag_assignment(task["id"], reason="4 open, 2 blocked, unavailable Thu",
                        suggestion="extend to Monday")
    updated = db.get("tasks", task["id"])
    assert updated["status"] == "flagged"
    ev = [e for e in sb.store["activity_events"]
          if e["payload"].get("daemon_event") == "ASSIGNMENT_FLAGGED"][0]
    assert ev["payload"]["content"]["reason"].startswith("4 open")
    assert ev["payload"]["to_staff_id"] == AMARA  # surfaced to the assigner


# ── proactive availability signal (broadcast) ──
def test_proactive_availability_update_broadcast():
    sb = FakeSupabase()
    db, eng = _engine(sb)
    _give_tasks(db, ZOE, 4)
    eng.signal_availability(ZOE)
    ev = [e for e in sb.store["activity_events"]
          if e["payload"].get("daemon_event") == "AVAILABILITY_UPDATE"][0]
    assert ev["payload"]["content"]["status"] == "HIGH"
    assert ev["payload"]["to_staff_id"] is None  # company-wide broadcast
