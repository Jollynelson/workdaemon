"""Backend auth: token → identity via profiles/workspace, auto-provision, isolation."""

from __future__ import annotations

import pytest
from fastapi import HTTPException

import src.api.auth as auth
from tests.conftest import FakeSupabase

WS = "aaaaaaaa-0000-0000-0000-000000000001"   # workspace == company id
UID = "user-1111"                              # auth user id == staff id


class _User:
    def __init__(self, uid, email):
        self.id, self.email = uid, email


class _AuthResp:
    def __init__(self, user):
        self.user = user


class FakeSupabaseWithAuth(FakeSupabase):
    def __init__(self, token_to_user):
        super().__init__()
        outer = self

        class _Auth:
            def get_user(self, token):
                return _AuthResp(token_to_user.get(token))

        self.auth = _Auth()


def _patch(monkeypatch, sb):
    monkeypatch.setattr(auth, "supabase_client", lambda: sb)
    monkeypatch.setattr(auth.settings, "supabase_url", "https://x.supabase.co")
    monkeypatch.setattr(auth.settings, "supabase_service_key", "svc")


def _seed_profile(sb, uid=UID, ws=WS, **over):
    sb.store["profiles"] = [{"id": uid, "name": "Nelson", "title": "CEO", "role": "ceo",
                             "industry": "SaaS", "permission_level": 2, "workspace_id": ws, **over}]
    sb.store["workspaces"] = [{"id": ws, "name": "Acme", "slug": "acme"}]


def test_valid_token_resolves_and_autoprovisions(monkeypatch):
    sb = FakeSupabaseWithAuth({"good": _User(UID, "nelson@acme.co")})
    _seed_profile(sb)
    _patch(monkeypatch, sb)

    ident = auth.resolve_identity("Bearer good")
    # ids reused: company==workspace, staff==user
    assert ident.company_id == WS and ident.staff_id == UID
    # mirrored rows auto-created
    assert sb.store["companies"][0]["id"] == WS
    assert sb.store["staff"][0]["id"] == UID
    assert sb.store["staff"][0]["access_level"] == "executive"   # permission_level 2
    # agent profile spun up
    assert sb.store["agent_profiles"][0]["staff_id"] == UID


def test_second_call_is_idempotent(monkeypatch):
    sb = FakeSupabaseWithAuth({"good": _User(UID, "nelson@acme.co")})
    _seed_profile(sb)
    _patch(monkeypatch, sb)
    auth.resolve_identity("Bearer good")
    auth.resolve_identity("Bearer good")
    assert len(sb.store["companies"]) == 1   # not duplicated
    assert len(sb.store["staff"]) == 1
    assert len(sb.store["agent_profiles"]) == 1


def test_missing_token_401(monkeypatch):
    _patch(monkeypatch, FakeSupabaseWithAuth({}))
    with pytest.raises(HTTPException) as e:
        auth.resolve_identity(None)
    assert e.value.status_code == 401


def test_invalid_token_401(monkeypatch):
    _patch(monkeypatch, FakeSupabaseWithAuth({}))
    with pytest.raises(HTTPException) as e:
        auth.resolve_identity("Bearer bogus")
    assert e.value.status_code == 401


def test_user_without_profile_403(monkeypatch):
    sb = FakeSupabaseWithAuth({"good": _User("ghost", "ghost@x.co")})
    _seed_profile(sb)  # profile is for UID, not "ghost"
    _patch(monkeypatch, sb)
    with pytest.raises(HTTPException) as e:
        auth.resolve_identity("Bearer good")
    assert e.value.status_code == 403


def test_company_id_cannot_be_spoofed(monkeypatch):
    sb = FakeSupabaseWithAuth({"good": _User(UID, "nelson@acme.co")})
    _seed_profile(sb)
    _patch(monkeypatch, sb)
    ident = auth.resolve_identity("Bearer good")
    assert ident.company_id == WS  # always the user's own workspace, never client input
