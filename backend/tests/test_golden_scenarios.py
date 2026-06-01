"""The four golden push scenarios (FINAL spec Section 12).

1. Sales churn-risk flag        (threat, fast)   — covered in test_hunts_patterns
2. Ops Step-3 bottleneck        (pattern detect) — covered in test_hunts_patterns
3. CEO nightly briefing         (deep pass)      — covered in test_hunts_patterns
4. HR burnout / flight-risk     (deep, HR-only)  — here, with access gating
"""

from __future__ import annotations

import json

from src.brain.activity_feed import ActivityEvent, ActivityFeed
from src.brain.hunter import HuntEngine
from src.brain.router import BrainRouter
from src.db import CompanyDB
from src.push.inbox import PushInbox
from tests.conftest import FakeBrainClient, FakePublisher, FakeSupabase

CO = "11111111-1111-1111-1111-111111111111"
HR_DIRECTOR = "hr-director-1"
DEV_AT_RISK = "dev-a-1"
PEER = "peer-1"
DEEP = "deepseek-v4-pro"


def _hr_engine(sb, push):
    db = CompanyDB(CO, client=sb)
    # HR burnout is a performance/deep hunt; Pro tier returns the finding.
    client = FakeBrainClient(responses={DEEP: json.dumps({"findings": [{
        "mode": "performance",
        "title": "Burnout & flight-risk: Developer A",
        "detail": "Slack -60% over 3 weeks, Jira completion falling, no PTO in 4 months, "
                  "LinkedIn activity up. Recommend a wellbeing 1:1 this week.",
        "confidence": 0.88,
        "target_role": "HR Director",
    }]})})
    return HuntEngine(
        db, BrainRouter(client), ActivityFeed(db, publisher=FakePublisher()),
        assemble_context=lambda mode: "(hr signals)",
        push=push,
        # only the HR Director resolves as the target for HR findings
        resolve_target=lambda role: HR_DIRECTOR if role == "HR Director" else None,
    )


def test_golden_hr_burnout_routes_to_hr_director_only():
    sb = FakeSupabase()
    push = PushInbox(CompanyDB(CO, client=sb))
    _hr_engine(sb, push).nightly_deep_pass()

    pushes = sb.store.get("pushes", [])
    # exactly one push, to the HR Director
    assert len(pushes) == 1
    assert pushes[0]["staff_id"] == HR_DIRECTOR
    assert "burnout" in pushes[0]["message"].lower() or "flight-risk" in pushes[0]["message"].lower()

    # the at-risk employee and peers are NEVER pushed this signal (privacy / access gate)
    recipients = {p["staff_id"] for p in pushes}
    assert DEV_AT_RISK not in recipients
    assert PEER not in recipients


def test_hr_finding_feed_event_is_manager_visibility_not_all():
    sb = FakeSupabase()
    push = PushInbox(CompanyDB(CO, client=sb))
    _hr_engine(sb, push).nightly_deep_pass()
    # the hunt_finding feed event must not be company-wide visible
    fin_events = [e for e in sb.store.get("activity_events", []) if e["event_type"] == "hunt_finding"]
    assert fin_events and all(e["visible_to"] != "all" for e in fin_events)
