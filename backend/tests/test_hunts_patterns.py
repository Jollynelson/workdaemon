"""Hunt engine (5 modes + nightly + golden scenarios), pattern detection, push calibration."""

from __future__ import annotations

import json

from src.brain.activity_feed import ActivityFeed
from src.brain.hunter import HUNT_MODES, HuntEngine
from src.brain.patterns import Cluster, PatternDetector
from src.brain.router import BrainRouter
from src.db import CompanyDB
from src.push.delivery import PushCalibrator
from src.push.inbox import PushInbox
from tests.conftest import FakeBrainClient, FakePublisher, FakeSupabase

CO = "11111111-1111-1111-1111-111111111111"
FAST = "deepseek-v4-flash"
DEEP = "deepseek-v4-pro"


def _engine(sb, fast_findings=None, deep_findings=None, push=None):
    db = CompanyDB(CO, client=sb)
    responses = {}
    if fast_findings is not None:
        responses[FAST] = json.dumps({"findings": fast_findings, "confidence": 0.9})
    if deep_findings is not None:
        responses[DEEP] = json.dumps({"findings": deep_findings})
    brain = BrainRouter(FakeBrainClient(responses=responses))
    feed = ActivityFeed(db, publisher=FakePublisher())
    eng = HuntEngine(db, brain, feed, assemble_context=lambda mode: f"[ctx:{mode}]",
                     push=push, resolve_target=lambda role: "exec1" if role else None)
    return db, eng


def test_all_five_hunt_modes_persist_findings():
    sb = FakeSupabase()
    db, eng = _engine(sb, fast_findings=[{"title": "f", "detail": "d", "confidence": 0.5}],
                      deep_findings=[{"title": "f", "detail": "d", "confidence": 0.5}])
    for mode in HUNT_MODES:
        res = eng.run_hunt(mode)
        assert res.findings and res.findings[0]["mode"] == mode
    assert len(sb.store["hunt_findings"]) == len(HUNT_MODES)


def test_threat_hunt_uses_fast_tier():
    sb = FakeSupabase()
    db, eng = _engine(sb, fast_findings=[{"title": "churn", "detail": "x", "confidence": 0.8}])
    res = eng.run_hunt("threat")
    assert res.depth == "fast"
    assert sb.store["hunt_findings"][0]["brain_model"] == FAST


def test_opportunity_hunt_uses_deep_tier():
    sb = FakeSupabase()
    db, eng = _engine(sb, deep_findings=[{"title": "upsell", "detail": "x", "confidence": 0.8}])
    res = eng.run_hunt("opportunity")
    assert res.depth == "deep"
    assert sb.store["hunt_findings"][0]["brain_model"] == DEEP


# ── Golden scenario 1: sales churn-risk flag pushes to the right role ──
def test_golden_sales_churn_pushes_to_target_role():
    sb = FakeSupabase()
    push = PushInbox(CompanyDB(CO, client=sb))
    db, eng = _engine(
        sb,
        fast_findings=[{"title": "Client X churn risk", "detail": "renewal 60d, no contact 14d",
                        "confidence": 0.85, "target_role": "Sales Manager"}],
        push=push,
    )
    eng.run_hunt("threat")
    pushes = sb.store.get("pushes", [])
    assert pushes and pushes[0]["kind"] == "hunt_finding"
    assert "churn" in pushes[0]["message"].lower()


# ── Golden scenario 3: CEO nightly briefing (deep pass) ──
def test_golden_nightly_deep_pass_produces_findings():
    sb = FakeSupabase()
    db, eng = _engine(
        sb,
        deep_findings=[
            {"mode": "threat", "title": "Cash tight in Q3", "detail": "...", "confidence": 0.9,
             "target_role": "CEO"},
            {"mode": "performance", "title": "Process worth replicating", "detail": "...",
             "confidence": 0.8},
        ],
    )
    findings = eng.nightly_deep_pass()
    assert len(findings) == 2
    assert {f["mode"] for f in findings} == {"threat", "performance"}
    assert all(f["depth"] == "deep" for f in findings)


def test_low_confidence_finding_not_pushed():
    sb = FakeSupabase()
    push = PushInbox(CompanyDB(CO, client=sb))
    db, eng = _engine(
        sb,
        fast_findings=[{"title": "weak signal", "detail": "x", "confidence": 0.4,
                        "target_role": "CEO"}],
        push=push,
    )
    eng.run_hunt("threat")
    assert sb.store.get("pushes", []) == []  # below PUSH_THRESHOLD


# ── pattern detection: ≥3 staff required ──
def test_pattern_detected_when_three_staff_cluster():
    sb = FakeSupabase()
    db = CompanyDB(CO, client=sb)
    brain = BrainRouter(FakeBrainClient(responses={
        FAST: json.dumps({"pattern_type": "knowledge_gap", "title": "onboarding template lost",
                          "detail": "6 asks", "confidence": 0.9})
    }))
    feed = ActivityFeed(db, publisher=FakePublisher())
    cluster = Cluster(interaction_ids=["i1", "i2", "i3"], staff_ids=["a", "b", "c"],
                      sample_messages=["where is the onboarding template?"])
    det = PatternDetector(db, brain, feed, cluster_fn=lambda interactions: [cluster])
    created = det.detect()
    assert len(created) == 1
    assert created[0]["pattern_type"] == "knowledge_gap"
    # staff stored but feed event is manager-visibility + anonymized count
    ev = [e for e in sb.store["activity_events"] if e["event_type"] == "pattern_detected"][0]
    assert ev["visible_to"] == "managers"
    assert ev["payload"]["staff_count"] == 3


def test_pattern_skipped_below_three_staff():
    sb = FakeSupabase()
    db = CompanyDB(CO, client=sb)
    brain = BrainRouter(FakeBrainClient())
    feed = ActivityFeed(db)
    cluster = Cluster(interaction_ids=["i1"], staff_ids=["a", "b"], sample_messages=["x"])
    det = PatternDetector(db, brain, feed, cluster_fn=lambda i: [cluster])
    assert det.detect() == []


# ── push calibration backoff ──
def test_push_calibration_backs_off_after_ignores():
    sb = FakeSupabase()
    db = CompanyDB(CO, client=sb)
    cal = PushCalibrator(db)
    # 3 ignored pushes of same kind → back off
    for _ in range(3):
        db.insert("pushes", {"staff_id": "s1", "kind": "hunt_finding", "message": "m",
                             "acted_on": False})
    assert cal.should_deliver("s1", "hunt_finding") is False
    # a different kind is unaffected
    assert cal.should_deliver("s1", "task_assignment") is True
