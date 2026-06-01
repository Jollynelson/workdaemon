"""Orchestration: semantic clustering, fan-out isolation, integrations no-op, schedule."""

from __future__ import annotations

from src.orchestration import integrations, jobs, scheduler


# ── greedy semantic clustering (the pattern-detection input) ──
class StubEmbedder:
    """Maps a keyword to a distinct unit vector so similar messages cluster."""

    def embed(self, text: str):
        t = text.lower()
        if "template" in t:
            return [1.0, 0.0, 0.0]
        if "deploy" in t:
            return [0.0, 1.0, 0.0]
        return [0.0, 0.0, 1.0]


def test_greedy_clusters_need_three_distinct_staff():
    inter = [
        {"id": "i1", "staff_id": "a", "user_message": "where is the onboarding template?"},
        {"id": "i2", "staff_id": "b", "user_message": "can't find the template anywhere"},
        {"id": "i3", "staff_id": "c", "user_message": "which template do we use?"},
        {"id": "i4", "staff_id": "a", "user_message": "deploy is failing"},  # diff topic
    ]
    clusters = jobs._greedy_semantic_clusters(StubEmbedder(), inter, threshold=0.8)
    assert len(clusters) == 1
    assert set(clusters[0].staff_ids) == {"a", "b", "c"}


def test_greedy_skips_cluster_with_too_few_staff():
    inter = [
        {"id": "i1", "staff_id": "a", "user_message": "template?"},
        {"id": "i2", "staff_id": "a", "user_message": "template again"},  # same staff
    ]
    assert jobs._greedy_semantic_clusters(StubEmbedder(), inter) == []


# ── fan-out: isolation (one company per call) + error capture ──
def test_fan_out_runs_each_company_and_captures_errors():
    seen = []

    def job(cid):
        seen.append(cid)
        if cid == "bad":
            raise RuntimeError("boom")
        return {"company_id": cid, "ok": True}

    results = jobs.fan_out(job, company_ids=["c1", "bad", "c2"])
    assert seen == ["c1", "bad", "c2"]                 # every company attempted
    assert results[0]["ok"] is True
    assert "error" in results[1] and "boom" in results[1]["error"]   # error isolated
    assert results[2]["ok"] is True                    # one failure doesn't stop the rest


# ── integrations are no-ops without keys ──
def test_trace_passthrough_without_langsmith_key():
    ran = []
    with integrations.trace("nightly", company="x"):
        ran.append(1)
    assert ran == [1]  # body executed, no error even with no key


def test_web_learning_empty_without_tavily_key():
    assert integrations.web_learning("c1", "market news") == []


def test_self_optimise_skips_without_dspy():
    out = integrations.self_optimise("c1")
    assert "skipped" in out["self_optimise"] or "noop" in out["self_optimise"]


# ── schedule wiring ──
def test_schedule_and_ticks_cover_same_jobs():
    assert set(scheduler.SCHEDULE) == set(scheduler.TICKS)


def test_run_tick_unknown_raises():
    try:
        scheduler.run_tick("nope")
        assert False
    except ValueError:
        pass
