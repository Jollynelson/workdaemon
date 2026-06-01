"""Learning loop: select companies with enough unused signals to retrain."""

from __future__ import annotations

import src.orchestration.training_loop as tl
from src.orchestration import scheduler
from tests.conftest import FakeSupabase


def _seed_signals(sb, counts: dict[str, int]):
    rows = []
    for cid, n in counts.items():
        for i in range(n):
            rows.append({"company_id": cid, "kind": "interaction",
                         "prompt": f"q{i}", "target": f"a{i}", "used_in_version": None})
    sb.store["training_signals"] = rows


def test_companies_ready_respects_threshold(monkeypatch):
    sb = FakeSupabase()
    _seed_signals(sb, {"co-a": 60, "co-b": 10, "co-c": 50})
    monkeypatch.setattr(tl, "supabase_client", lambda: sb)
    ready = tl.companies_ready_to_train(min_examples=50)
    assert set(ready) == {"co-a", "co-c"}        # co-b (10) below threshold
    assert "co-b" not in ready


def test_used_signals_are_excluded(monkeypatch):
    sb = FakeSupabase()
    sb.store["training_signals"] = (
        [{"company_id": "co-a", "used_in_version": None}] * 50
        + [{"company_id": "co-a", "used_in_version": 1}] * 100   # already consumed
    )
    monkeypatch.setattr(tl, "supabase_client", lambda: sb)
    # only the 50 unused count
    assert tl.companies_ready_to_train(min_examples=50) == ["co-a"]
    assert tl.companies_ready_to_train(min_examples=51) == []


def test_no_companies_ready_returns_empty(monkeypatch):
    sb = FakeSupabase()
    _seed_signals(sb, {"co-a": 5})
    monkeypatch.setattr(tl, "supabase_client", lambda: sb)
    assert tl.companies_ready_to_train(min_examples=50) == []


def test_training_tick_registered_on_schedule():
    assert "training_cycle" in scheduler.SCHEDULE
    assert "training_cycle" in scheduler.TICKS
    assert set(scheduler.SCHEDULE) == set(scheduler.TICKS)


def test_run_training_cycle_triggers_ready_companies(monkeypatch):
    sb = FakeSupabase()
    _seed_signals(sb, {"co-a": 60, "co-b": 60})
    monkeypatch.setattr(tl, "supabase_client", lambda: sb)
    triggered = []
    monkeypatch.setattr(tl, "trigger_training",
                        lambda cid: triggered.append(cid) or {"company_id": cid, "training": "enqueued"})
    out = tl.run_training_cycle()
    assert set(triggered) == {"co-a", "co-b"}
    assert all(r["training"] == "enqueued" for r in out)
