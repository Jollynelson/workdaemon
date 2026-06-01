"""Agent layer: tool permissions, runtime loop, factory spin_up/load/offboard."""

from __future__ import annotations

from src.agents.factory import AgentFactory
from src.agents.runtime import AgentModel, run_turn
from src.agents.tool_permissions import can_use, tools_for
from src.agents.tools import ToolExecutor, parse_tool_calls
from src.db import CompanyDB
from tests.conftest import FakeSupabase

CO = "11111111-1111-1111-1111-111111111111"
JUNIOR = {"id": "j1", "name": "Juna", "role": "Analyst", "department": "Ops",
          "access_level": "junior"}
DIRECTOR = {"id": "d1", "name": "Dira", "role": "HR Director", "department": "People",
            "access_level": "director"}


# ── permissions ────────────────────────────────────────────────────────────────
def test_role_tool_maps():
    assert "finance" not in tools_for("junior")
    assert "finance" in tools_for("director")
    assert can_use("director", "hr") is True
    assert can_use("junior", "hr") is False


# ── tool parsing + permission-checked execution ────────────────────────────────
def test_parse_tool_calls():
    text = 'sure <tool_call>{"name": "slack", "arguments": {"q": "x"}}</tool_call> done'
    calls = parse_tool_calls(text)
    assert len(calls) == 1 and calls[0].name == "slack" and calls[0].arguments == {"q": "x"}


def test_executor_blocks_unpermitted_tool():
    ex = ToolExecutor("junior")
    ex.register("finance", lambda args: {"cash": 1})  # even if registered...
    from src.agents.tools import ToolCall

    res = ex.execute(ToolCall("finance", {}))
    assert res["error"] == "permission_denied"


def test_executor_runs_permitted_tool():
    ex = ToolExecutor("director")
    ex.register("finance", lambda args: {"cash": 42})
    from src.agents.tools import ToolCall

    res = ex.execute(ToolCall("finance", {}))
    assert res["result"] == {"cash": 42}


# ── runtime loop (tool round then final answer) ─────────────────────────────────
class ScriptedModel(AgentModel):
    """Returns queued responses in order."""

    def __init__(self, responses):
        self._responses = list(responses)
        self.calls = 0

    def chat(self, messages):
        self.calls += 1
        return self._responses.pop(0)


def test_run_turn_executes_tool_then_answers():
    model = ScriptedModel([
        '<tool_call>{"name": "crm", "arguments": {"client": "Acme"}}</tool_call>',
        "Acme was last contacted 14 days ago.",
    ])
    ex = ToolExecutor("manager")
    ex.register("crm", lambda args: {"last_contact_days": 14, "client": args["client"]})
    result = run_turn(model, ex, "sys", [], "When did we last contact Acme?")
    assert result.rounds == 2
    assert "14 days" in result.text
    assert result.tools_called[0]["result"]["last_contact_days"] == 14


def test_run_turn_no_tools_returns_immediately():
    model = ScriptedModel(["Hello, how can I help?"])
    ex = ToolExecutor("junior")
    result = run_turn(model, ex, "sys", [], "hi")
    assert result.rounds == 1 and result.tools_called == []


# ── factory ──────────────────────────────────────────────────────────────────────
def test_spin_up_persists_profile_with_role_tools():
    db = CompanyDB(CO, client=FakeSupabase())
    seeded = []
    factory = AgentFactory(db, "Acme", seed_memory=lambda ns: seeded.append(ns))
    p = factory.spin_up(DIRECTOR)
    assert p.company_id == CO
    assert "finance" in p.permitted_tools and "hr" in p.permitted_tools
    assert p.memory_ns == f"user_d1_{CO}"
    assert seeded == [p.memory_ns]  # memory namespace seeded


def test_load_for_conversation_builds_prompt_and_offboard():
    sb = FakeSupabase()
    db = CompanyDB(CO, client=sb)
    # staff row must exist for the join
    db.insert("staff", {**DIRECTOR, "company_id": CO})
    # fake staff id must match what we stored
    sid = sb.store["staff"][0]["id"]
    DIRECTOR_ROW = {**DIRECTOR, "id": sid}
    factory = AgentFactory(db, "Acme",
                           context_for_role=lambda role, dept: f"[context for {role}]")
    factory.spin_up(DIRECTOR_ROW)
    profile, prompt = factory.load_for_conversation(sid)
    assert "HR Director" in prompt
    assert "[context for HR Director]" in prompt
    assert "Hermes" not in prompt and "DeepSeek" not in prompt  # never leak infra

    archived = []
    factory.offboard(sid, archive_namespace=lambda ns: archived.append(ns))
    prow = db.select("agent_profiles").eq("staff_id", sid).limit(1).execute()
    assert prow.data[0]["status"] == "inactive"
    assert archived == [profile.memory_ns]
