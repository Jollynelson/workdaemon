"""Real Notion/Slack tool handlers: per-company token, read vs gated-write, role perms."""

from __future__ import annotations

from src.agents.tools import ToolCall, ToolExecutor
from src.integrations.tools import _notion_handlers, _slack_handlers, register_company_tools
from src.integrations.store import IntegrationStore
from src.db import CompanyDB
from tests.conftest import FakeSupabase

CO = "11111111-1111-1111-1111-111111111111"


# ── write tools draft-for-confirm unless autonomy ──
def test_notion_create_drafts_without_autonomy():
    h = _notion_handlers("tok", autonomy=False)
    out = h["notion_create_page"]({"parent_id": "p", "title": "X"})
    assert out["drafted"] is True and out["action"] == "notion_create_page"


def test_slack_post_drafts_without_autonomy():
    h = _slack_handlers("tok", autonomy=False)
    out = h["slack_post_message"]({"channel": "C1", "message": "hi"})
    assert out["drafted"] is True


# ── register only connected + role-permitted tools (store injected for tests) ──
def test_register_only_connected_and_permitted():
    store = IntegrationStore(CompanyDB(CO, client=FakeSupabase()))
    store.connect("notion", "ntoken")
    store.connect("slack", "stoken")
    ex = ToolExecutor("director")
    register_company_tools(ex, CO, store=store)
    assert "notion_search" in ex._handlers
    assert "slack_search" in ex._handlers


def test_junior_gets_permitted_connected_tools():
    store = IntegrationStore(CompanyDB(CO, client=FakeSupabase()))
    store.connect("slack", "stoken")
    ex = ToolExecutor("junior")
    register_company_tools(ex, CO, store=store)
    assert "slack_search" in ex._handlers   # junior is allowed slack


def test_unconnected_provider_registers_nothing():
    store = IntegrationStore(CompanyDB(CO, client=FakeSupabase()))
    ex = ToolExecutor("executive")
    register_company_tools(ex, CO, store=store)   # nothing connected
    assert ex._handlers == {}


def test_executor_blocks_tool_when_role_forbids_even_if_registered():
    # finance isn't in our Notion/Slack set, but prove the executor's permission
    # gate still stands for any tool a lower role shouldn't call.
    ex = ToolExecutor("junior")
    ex.register("finance", lambda a: {"x": 1})
    res = ex.execute(ToolCall("finance", {}))
    assert res["error"] == "permission_denied"
