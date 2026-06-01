"""Chat service: the Brain-visibility pipeline (log + feed + cross-agent route)."""

from __future__ import annotations

from src.agents.factory import AgentFactory
from src.agents.runtime import AgentModel
from src.agents.tools import ToolExecutor
from src.api.chat_service import ChatService
from src.brain.activity_feed import ActivityFeed
from src.brain.logger import Interaction, InteractionLogger
from src.db import CompanyDB
from tests.conftest import FakePublisher, FakeSupabase

CO = "11111111-1111-1111-1111-111111111111"
STAFF = {"id": "s1", "name": "Sam", "role": "Analyst", "department": "Ops",
         "access_level": "manager"}


class OneShotModel(AgentModel):
    def __init__(self, text):
        self._text = text

    def chat(self, messages):
        return self._text


def _service(sb, model):
    db = CompanyDB(CO, client=sb)
    db.insert("staff", {**STAFF, "company_id": CO})
    sid = sb.store["staff"][0]["id"]
    factory = AgentFactory(db, "Acme")
    factory.spin_up({**STAFF, "id": sid})
    svc = ChatService(
        factory=factory,
        model=model,
        feed=ActivityFeed(db, publisher=FakePublisher()),
        logger=InteractionLogger(db),
        build_executor=lambda lvl: ToolExecutor(lvl),
    )
    return db, svc, sid


def test_turn_logs_interaction_and_emits_feed():
    sb = FakeSupabase()
    db, svc, sid = _service(sb, OneShotModel("Here is a substantive helpful answer for you."))
    reply = svc.handle_turn(sid, "hello")

    # response returned
    assert "substantive" in reply.text
    # interaction persisted (Brain visibility)
    assert len(sb.store.get("interactions", [])) == 1
    # activity feed got an agent_interaction event
    events = sb.store.get("activity_events", [])
    assert any(e["event_type"] == "agent_interaction" for e in events)
    # training signal captured for learning loop
    assert len(sb.store.get("training_signals", [])) == 1


def test_logger_trust_score_moves_with_acted_on():
    sb = FakeSupabase()
    db = CompanyDB(CO, client=sb)
    db.insert("staff", {**STAFF, "company_id": CO})
    sid = sb.store["staff"][0]["id"]
    AgentFactory(db, "Acme").spin_up({**STAFF, "id": sid})
    logger = InteractionLogger(db)

    logger.log(Interaction(sid, "Analyst", "q", "a longer agent answer here", suggestion_acted_on=True))
    p = db.select("agent_profiles").eq("staff_id", sid).limit(1).execute().data[0]
    assert p["trust_score"] > 1.0 and p["interaction_count"] == 1

    logger.log(Interaction(sid, "Analyst", "q2", "ignored", suggestion_acted_on=False))
    p = db.select("agent_profiles").eq("staff_id", sid).limit(1).execute().data[0]
    assert p["trust_score"] < 1.02 and p["interaction_count"] == 2


def test_fastapi_app_imports_and_mounts_routes():
    from src.api.main import app

    paths = {r.path for r in app.routes if hasattr(r, "path")}
    assert "/api/chat" in paths
    assert "/api/tasks" in paths
    assert "/health" in paths
    assert "/ws/{company_id}/{staff_id}" in paths
