"""Brain router: tier selection, escalation, technical classification."""

from __future__ import annotations

from src.brain.router import BrainRouter
from src.config import settings
from tests.conftest import FakeBrainClient

FAST = settings.brain_fast_model
DEEP = settings.brain_deep_model


def test_fast_high_confidence_no_escalation():
    client = FakeBrainClient()  # default confidence 1.0
    r = BrainRouter(client)
    resp = r.call(kind="brain", depth="fast", prompt="triage this signal")
    assert len(client.calls) == 1
    assert client.calls[0]["model"] == FAST
    assert client.calls[0]["thinking"] is False
    assert resp.escalated is False


def test_fast_low_confidence_escalates_to_pro():
    client = FakeBrainClient(responses={FAST: '{"confidence": 0.3}'})
    r = BrainRouter(client)
    resp = r.call(kind="brain", depth="fast", prompt="ambiguous churn signal")
    assert [c["model"] for c in client.calls] == [FAST, DEEP]
    assert client.calls[1]["thinking"] is True
    assert resp.escalated is True


def test_fast_flagged_complex_escalates():
    client = FakeBrainClient(responses={FAST: '{"confidence": 0.95, "flagged_complex": true}'})
    r = BrainRouter(client)
    resp = r.call(kind="brain", depth="fast", prompt="subtle cross-tool pattern")
    assert resp.escalated is True
    assert client.calls[-1]["model"] == DEEP


def test_deep_uses_pro_with_thinking():
    client = FakeBrainClient()
    r = BrainRouter(client)
    r.call(kind="brain", depth="deep", prompt="nightly company analysis")
    assert client.calls[0]["model"] == DEEP
    assert client.calls[0]["thinking"] is True
    assert client.calls[0]["effort"] == settings.brain_deep_reasoning_effort


def test_technical_moderate_uses_flash_with_thinking():
    client = FakeBrainClient()
    r = BrainRouter(client)
    r.call(kind="brain", depth="technical", prompt="explain this one function",
           context={"files": ["a.py"]})
    assert client.calls[0]["model"] == FAST
    assert client.calls[0]["thinking"] is True
    assert client.calls[0]["effort"] == settings.brain_technical_reasoning_effort


def test_technical_complex_uses_pro():
    client = FakeBrainClient()
    r = BrainRouter(client)
    # two signals: refactor intent + many files
    r.call(kind="brain", depth="technical", prompt="refactor the auth module",
           context={"files": ["a", "b", "c", "d", "e"]})
    assert client.calls[0]["model"] == DEEP
    assert client.calls[0]["thinking"] is True


def test_classify_technical_complexity_heuristic():
    r = BrainRouter(FakeBrainClient())
    assert r.classify_technical_complexity("read this sheet", {"sheets": ["one"]}) == "moderate"
    assert r.classify_technical_complexity(
        "debug across the repo", {"files": ["a", "b", "c", "d"]}
    ) == "complex"


def test_agent_kind_rejected():
    r = BrainRouter(FakeBrainClient())
    try:
        r.call(kind="agent", depth="fast", prompt="x")
        assert False, "should reject kind=agent"
    except ValueError:
        pass
