"""Test fakes — let the Brain router, cross-agent, and isolation logic run with
zero external services (no Postgres, Redis, DeepSeek, or OpenAI)."""

from __future__ import annotations

import uuid

import pytest

from src.brain.deepseek_client import BrainResponse, _extract_signal


# ── In-memory Supabase-compatible fake ─────────────────────────────────────────
class _Result:
    def __init__(self, data):
        self.data = data


class _Query:
    def __init__(self, store, table):
        self._store = store
        self._table = table
        self._op = "select"
        self._filters: list[tuple] = []
        self._payload = None
        self._patch = None
        self._limit = None

    def select(self, columns="*"):
        self._op = "select"
        return self

    def insert(self, payload):
        self._op = "insert"
        self._payload = payload
        return self

    def update(self, patch):
        self._op = "update"
        self._patch = patch
        return self

    def eq(self, col, val):
        self._filters.append((col, val))
        return self

    def limit(self, n):
        self._limit = n
        return self

    def order(self, *a, **k):
        return self

    def execute(self):
        rows = self._store.setdefault(self._table, [])
        if self._op == "insert":
            row = dict(self._payload)
            row.setdefault("id", str(uuid.uuid4()))
            rows.append(row)
            return _Result([row])
        match = [r for r in rows if all(r.get(c) == v for c, v in self._filters)]
        if self._op == "update":
            for r in match:
                r.update(self._patch)
            return _Result(match)
        if self._limit is not None:
            match = match[: self._limit]
        return _Result(match)


class FakeSupabase:
    def __init__(self):
        self.store: dict[str, list] = {}

    def table(self, name):
        return _Query(self.store, name)


# ── Fake Brain client (controllable confidence per model) ──────────────────────
class FakeBrainClient:
    def __init__(self, responses: dict[str, str] | None = None):
        self.calls: list[dict] = []
        self._responses = responses or {}

    def complete(self, prompt, *, model, thinking, reasoning_effort, system=None, **kwargs):
        self.calls.append(
            {"model": model, "thinking": thinking, "effort": reasoning_effort, "prompt": prompt}
        )
        text = self._responses.get(model, '{"confidence": 1.0}')
        conf, flagged = _extract_signal(text)
        return BrainResponse(
            text=text, model=model, confidence=conf, flagged_complex=flagged, thinking=thinking
        )


class FakePublisher:
    def __init__(self):
        self.published: list[tuple] = []

    def publish(self, channel, message):
        self.published.append((channel, message))


class FakePush:
    def __init__(self):
        self.delivered: list[tuple] = []

    def deliver(self, staff_id, push):
        self.delivered.append((staff_id, push))
        return push


@pytest.fixture
def fake_db():
    return FakeSupabase()
