"""Daemon character: name, preferred name, persona, and chat-driven self-editing."""

from __future__ import annotations

from src.agents.profiles import AgentProfile
from src.agents.prompts import DEFAULT_PERSONA, build_system_prompt
from src.agents.tool_permissions import can_use
from src.api.deps import update_daemon
from src.api.chat_service import ChatService
from src.db import CompanyDB
from tests.conftest import FakeSupabase

CO = "11111111-1111-1111-1111-111111111111"


def _profile(**kw):
    base = dict(staff_id="s1", company_id=CO, name="Nelson", role="CEO",
                department="Exec", access_level="executive")
    base.update(kw)
    return AgentProfile(**base)


# ── prompt reflects name / preferred name / persona ──
def test_prompt_uses_daemon_name_preferred_name_and_persona():
    sp = build_system_prompt(
        _profile(daemon_name="Atlas", preferred_name="Boss", persona="Be witty and brief."),
        "Beta Tenant", "",
    )
    assert "Atlas" in sp                       # daemon's own name
    assert "Boss" in sp                        # what it calls the user
    assert "Be witty and brief." in sp         # persona
    assert "update_daemon" in sp               # self-management tool documented


def test_prompt_falls_back_to_default_persona_and_offers_a_name():
    sp = build_system_prompt(_profile(), "Beta Tenant", "")
    assert DEFAULT_PERSONA in sp               # character out of the box
    assert "invite them to name you" in sp     # unnamed → offers to be named


# ── self-management is allowed for every role ──
def test_update_daemon_allowed_for_all_roles():
    assert can_use("junior", "update_daemon")
    assert can_use("executive", "update_daemon")


# ── update_daemon persists, appends, and validates ──
def test_update_daemon_persists_appends_and_rejects_empty():
    sb = FakeSupabase()
    db = CompanyDB(CO, client=sb)
    db.insert("agent_profiles", {"staff_id": "s1", "company_id": CO,
                                 "memory_namespace": "ns", "permitted_tools": []})

    out = update_daemon(db, "s1", {"daemon_name": "Atlas", "preferred_name": "Boss",
                                   "persona": "Be witty."})
    assert out == {"daemon_name": "Atlas", "preferred_name": "Boss", "persona": "Be witty."}

    out2 = update_daemon(db, "s1", {"persona_append": "And concise."})
    assert "Be witty." in out2["persona"] and "And concise." in out2["persona"]
    assert out2["daemon_name"] == "Atlas"      # unchanged fields preserved

    assert update_daemon(db, "s1", {})["error"] == "nothing_to_update"


# ── the daemon can rename itself from chat via the update_daemon tool ──
class _ScriptedModel:
    """First turn emits a tool call; second returns a final answer."""
    def __init__(self, scripted):
        self._scripted, self._i = scripted, 0

    def chat(self, messages):
        out = self._scripted[min(self._i, len(self._scripted) - 1)]
        self._i += 1
        return out


def test_chat_tool_lets_daemon_rename_itself():
    from src.agents.factory import AgentFactory
    from src.agents.tools import ToolExecutor
    from src.brain.activity_feed import ActivityFeed
    from src.brain.logger import InteractionLogger

    sb = FakeSupabase()
    db = CompanyDB(CO, client=sb)
    db.insert("staff", {"id": "s1", "name": "Nelson", "role": "CEO",
                        "department": "Exec", "access_level": "executive", "company_id": CO})
    sid = sb.store["staff"][0]["id"]
    AgentFactory(db, "Acme").spin_up({"id": sid, "name": "Nelson", "role": "CEO",
                                      "department": "Exec", "access_level": "executive"})

    model = _ScriptedModel([
        '<tool_call>{"name":"update_daemon","arguments":{"daemon_name":"Atlas","preferred_name":"Boss"}}</tool_call>',
        "Done — I'm Atlas now, Boss.",
    ])
    svc = ChatService(
        factory=AgentFactory(db, "Acme"),
        model=model,
        feed=ActivityFeed(db),
        logger=InteractionLogger(db),
        build_executor=lambda lvl: ToolExecutor(lvl),
        daemon_editor=lambda s, patch: update_daemon(db, s, patch),
    )
    svc.handle_turn(sid, "call yourself Atlas and call me Boss")

    saved = update_daemon(db, sid, {})  # read-only-ish: nothing to update, but row reflects state
    row = sb.store["agent_profiles"][0]
    assert row["daemon_name"] == "Atlas" and row["preferred_name"] == "Boss"
    assert saved["error"] == "nothing_to_update"
