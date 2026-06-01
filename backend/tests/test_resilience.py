"""Retry/backoff: retry transient failures, never client errors."""

from __future__ import annotations

import pytest

from src.resilience import retry_call


def test_succeeds_first_try():
    assert retry_call(lambda: 42) == 42


def test_retries_transient_then_succeeds(monkeypatch):
    import src.resilience as r
    monkeypatch.setattr(r.time, "sleep", lambda s: None)  # no real waiting
    calls = {"n": 0}

    def flaky():
        calls["n"] += 1
        if calls["n"] < 3:
            raise RuntimeError("429 rate limit exceeded")
        return "ok"

    assert retry_call(flaky, attempts=4) == "ok"
    assert calls["n"] == 3


def test_does_not_retry_client_error(monkeypatch):
    import src.resilience as r
    monkeypatch.setattr(r.time, "sleep", lambda s: None)
    calls = {"n": 0}

    def auth_fail():
        calls["n"] += 1
        raise ValueError("401 invalid api key")  # not transient

    with pytest.raises(ValueError):
        retry_call(auth_fail, attempts=4)
    assert calls["n"] == 1  # tried once, no retries


def test_gives_up_after_attempts(monkeypatch):
    import src.resilience as r
    monkeypatch.setattr(r.time, "sleep", lambda s: None)
    calls = {"n": 0}

    def always_timeout():
        calls["n"] += 1
        raise TimeoutError("connection timed out")

    with pytest.raises(TimeoutError):
        retry_call(always_timeout, attempts=3)
    assert calls["n"] == 3


def test_status_code_attribute_classified_transient(monkeypatch):
    import src.resilience as r
    monkeypatch.setattr(r.time, "sleep", lambda s: None)

    class Err(Exception):
        status_code = 503

    calls = {"n": 0}

    def fn():
        calls["n"] += 1
        if calls["n"] < 2:
            raise Err("service unavailable")
        return "recovered"

    assert retry_call(fn, attempts=3) == "recovered"
