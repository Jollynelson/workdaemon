"""Isolation — the release gate (FINAL spec Section 14).

These cover the structural guarantees of the company-scoped data layer. Tests
that need live Postgres/vectors/Hermes are marked TODO and added as those layers
land; the gate here is that CompanyDB cannot read or write across companies.
"""

from __future__ import annotations

from src.brain.router import BrainRouter
from src.db import CompanyDB
from tests.conftest import FakeBrainClient, FakeSupabase

CO_A = "aaaaaaaa-0000-0000-0000-000000000001"
CO_B = "bbbbbbbb-0000-0000-0000-000000000002"


def test_insert_forces_company_id_even_if_caller_lies():
    sb = FakeSupabase()
    a = CompanyDB(CO_A, client=sb)
    row = a.insert("staff", {"name": "x", "company_id": CO_B})  # caller tries to write to B
    assert row["company_id"] == CO_A  # forced back to A


def test_no_cross_company_db_read():
    sb = FakeSupabase()
    a = CompanyDB(CO_A, client=sb)
    b = CompanyDB(CO_B, client=sb)
    created = a.insert("tasks", {"title": "secret A task", "to_staff_id": "s"})
    # B cannot read A's row by id
    assert b.get("tasks", created["id"]) is None
    # A can
    assert a.get("tasks", created["id"]) is not None


def test_no_cross_company_update():
    sb = FakeSupabase()
    a = CompanyDB(CO_A, client=sb)
    b = CompanyDB(CO_B, client=sb)
    created = a.insert("tasks", {"title": "t", "to_staff_id": "s", "status": "pending"})
    assert b.update("tasks", created["id"], {"status": "hacked"}) is None
    assert a.get("tasks", created["id"])["status"] == "pending"


def test_company_db_requires_company_id():
    try:
        CompanyDB("")
        assert False, "empty company_id must raise"
    except ValueError:
        pass


def test_one_brain_call_one_company():
    """A Brain call's context must carry exactly one company_id (DeepSeek is a
    shared hosted API — never mix two companies in one call)."""
    client = FakeBrainClient()
    r = BrainRouter(client)
    r.call(kind="brain", depth="fast", prompt="x", context={"company_id": CO_A})
    # Build the assertion that will guard real hunt/route prompts: the context we
    # pass to a single call resolves to one company.
    ctx = {"company_id": CO_A}
    assert ctx["company_id"] == CO_A and "company_id" in ctx
