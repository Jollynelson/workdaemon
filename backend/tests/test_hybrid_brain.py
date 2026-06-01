"""Hybrid brain: per-company trained model when an adapter exists, else fallback."""

from __future__ import annotations

import src.agents.company_model as cm
from src.agents.company_model import CompanyModel, company_token, has_deployed_adapter
from src.api.chat_service import ChatService
from tests.conftest import FakeSupabase
from src.db import CompanyDB

CO = "11111111-1111-1111-1111-111111111111"


class FixedModel:
    def __init__(self, text):
        self.text = text
        self.called = False

    def chat(self, messages):
        self.called = True
        return self.text


# ── adapter presence drives company-model selection ──
def test_has_deployed_adapter_true_when_row_present():
    sb = FakeSupabase()
    db = CompanyDB(CO, client=sb)
    db.insert("model_versions", {"deployed": True, "version": 1})
    assert has_deployed_adapter(CO, db) is True


def test_has_deployed_adapter_false_when_none():
    sb = FakeSupabase()
    assert has_deployed_adapter(CO, CompanyDB(CO, client=sb)) is False


# ── per-company token is deterministic + company-bound ──
def test_company_token_is_bound_to_company(monkeypatch):
    monkeypatch.setattr(cm.settings, "serve_master_secret", "master")
    a = company_token("co-a")
    b = company_token("co-b")
    assert a != b and a == company_token("co-a")


# ── CompanyModel falls back to DeepSeek when serving unset/unreachable ──
def test_company_model_falls_back_without_serving_url(monkeypatch):
    monkeypatch.setattr(cm.settings, "serving_url", "")
    fb = FixedModel("deepseek answer")
    out = CompanyModel(CO, "sys", fb).chat([{"role": "user", "content": "hi"}])
    assert out == "deepseek answer" and fb.called


def test_company_model_falls_back_on_serving_error(monkeypatch):
    monkeypatch.setattr(cm.settings, "serving_url", "http://127.0.0.1:0")  # unreachable
    monkeypatch.setattr(cm.settings, "serve_master_secret", "m")
    fb = FixedModel("deepseek fallback")
    out = CompanyModel(CO, "sys", fb).chat([{"role": "user", "content": "hi"}])
    assert out == "deepseek fallback" and fb.called


# ── ChatService uses build_model per turn ──
def test_chat_service_build_model_selects_per_turn():
    sb = FakeSupabase()
    db = CompanyDB(CO, client=sb)
    db.insert("staff", {"id": "s1", "name": "Sam", "role": "Analyst",
                        "department": "Ops", "access_level": "manager", "company_id": CO})
    sid = sb.store["staff"][0]["id"]
    from src.agents.factory import AgentFactory
    from src.brain.activity_feed import ActivityFeed
    from src.brain.logger import InteractionLogger
    from src.agents.tools import ToolExecutor

    AgentFactory(db, "Acme").spin_up({"id": sid, "name": "Sam", "role": "Analyst",
                                      "department": "Ops", "access_level": "manager"})
    company = FixedModel("from COMPANY model")
    deepseek = FixedModel("from deepseek")
    svc = ChatService(
        factory=AgentFactory(db, "Acme"),
        model=deepseek,
        feed=ActivityFeed(db),
        logger=InteractionLogger(db),
        build_executor=lambda lvl: ToolExecutor(lvl),
        build_model=lambda sysp, fb: company,   # simulate "company has adapter"
    )
    reply = svc.handle_turn(sid, "hi")
    assert reply.text == "from COMPANY model"
    assert company.called and not deepseek.called
