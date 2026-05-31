"""Cross-agent task routing + output→input handoff."""

from __future__ import annotations

from src.brain.activity_feed import ActivityFeed
from src.brain.router import BrainRouter
from src.cross_agent.handoff import HandoffCoordinator
from src.cross_agent.task_router import TaskIntent, TaskRouter
from src.db import CompanyDB
from tests.conftest import FakeBrainClient, FakePublisher, FakePush, FakeSupabase

CO = "11111111-1111-1111-1111-111111111111"
PM = "aaaa1111-0000-0000-0000-000000000001"
DESIGNER = "bbbb2222-0000-0000-0000-000000000002"
DEV = "cccc3333-0000-0000-0000-000000000003"


def _wire():
    sb = FakeSupabase()
    db = CompanyDB(CO, client=sb)
    feed = ActivityFeed(db, publisher=FakePublisher())
    brain = BrainRouter(FakeBrainClient())
    push = FakePush()
    router = TaskRouter(db, brain, feed, push)
    handoff = HandoffCoordinator(db, feed, router)
    return sb, db, feed, push, router, handoff


def test_explicit_task_assignment_creates_task_push_and_event():
    sb, db, feed, push, router, _ = _wire()
    task = router.route(
        TaskIntent(sender_id=PM, target_id=DESIGNER, title="Checkout Redesign",
                   priority="high", sender_name="Amara")
    )
    # task row created, company-scoped, addressed to designer
    assert task["company_id"] == CO
    assert task["to_staff_id"] == DESIGNER
    assert task["status"] == "pending"
    assert task["priority"] == "high"
    # push delivered to designer
    assert push.delivered and push.delivered[0][0] == DESIGNER
    assert push.delivered[0][1]["kind"] == "task_assignment"
    # task_created event emitted
    events = sb.store.get("activity_events", [])
    assert any(e["event_type"] == "task_created" for e in events)


def test_handoff_routes_output_as_next_brief():
    sb, db, feed, push, router, handoff = _wire()
    # designer task that should flow to dev on completion
    first = db.insert(
        "tasks",
        {"title": "Checkout Redesign", "to_staff_id": DESIGNER, "from_staff_id": PM,
         "next_agent_id": DEV, "status": "in_progress"},
    )
    nxt = handoff.complete_and_hand_off(first["id"], output="Design spec v2 ready", artifacts=["fig"])

    # original marked handed_off, output saved
    updated = db.get("tasks", first["id"])
    assert updated["status"] == "handed_off"
    assert updated["output"] == "Design spec v2 ready"
    # next task created for dev, with the output as its brief
    assert nxt["to_staff_id"] == DEV
    assert "Design spec v2 ready" in nxt["brief"]
    # handoff event emitted
    events = sb.store.get("activity_events", [])
    assert any(e["event_type"] == "cross_agent_handoff" for e in events)


def test_brain_resolved_assignment_uses_router_json():
    sb = FakeSupabase()
    db = CompanyDB(CO, client=sb)
    feed = ActivityFeed(db)
    brain = BrainRouter(
        FakeBrainClient(responses={
            "deepseek-v4-flash": f'{{"assignee_id": "{DEV}", "title": "Fix bug",'
                                 f' "priority": "urgent", "confidence": 0.9}}'
        })
    )
    router = TaskRouter(db, brain, feed, FakePush())
    task = router.route(TaskIntent(sender_id=PM, brief_context="someone fix BUG-119"))
    assert task["to_staff_id"] == DEV
    assert task["priority"] == "urgent"
    assert task["routed_by_brain"] is True
