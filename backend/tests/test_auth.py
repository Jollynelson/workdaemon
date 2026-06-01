"""Backend auth: server-side identity resolution + tenant isolation."""

from __future__ import annotations

import pytest
from fastapi import HTTPException

import src.api.auth as auth
from tests.conftest import FakeSupabase

CO_A = "aaaaaaaa-0000-0000-0000-000000000001"


class _User:
    def __init__(self, uid, email):
        self.id, self.email = uid, email


class _AuthResp:
    def __init__(self, user):
        self.user = user


class FakeSupabaseWithAuth(FakeSupabase):
    """Adds .auth.get_user so resolve_identity can run offline."""

    def __init__(self, token_to_user):
        super().__init__()
        self._t2u = token_to_user
        outer = self

        class _Auth:
            def get_user(self, token):
                return _AuthResp(outer._t2u.get(token))

        self.auth = _Auth()


def _patch(monkeypatch, sb):
    monkeypatch.setattr(auth, "supabase_client", lambda: sb)
    monkeypatch.setattr(auth.settings, "supabase_url", "https://x.supabase.co")
    monkeypatch.setattr(auth.settings, "supabase_service_key", "svc")


def test_valid_token_resolves_identity_from_staff(monkeypatch):
    sb = FakeSupabaseWithAuth({"good": _User("u1", "sam@acme.co")})
    sb.store["staff"] = [{"id": "s1", "company_id": CO_A, "email": "sam@acme.co"}]
    _patch(monkeypatch, sb)
    ident = auth.resolve_identity("Bearer good")
    assert ident.company_id == CO_A and ident.staff_id == "s1" and ident.email == "sam@acme.co"


def test_missing_token_401(monkeypatch):
    _patch(monkeypatch, FakeSupabaseWithAuth({}))
    with pytest.raises(HTTPException) as e:
        auth.resolve_identity(None)
    assert e.value.status_code == 401


def test_invalid_token_401(monkeypatch):
    _patch(monkeypatch, FakeSupabaseWithAuth({}))  # no token maps to a user
    with pytest.raises(HTTPException) as e:
        auth.resolve_identity("Bearer bogus")
    assert e.value.status_code == 401


def test_user_not_staff_403(monkeypatch):
    sb = FakeSupabaseWithAuth({"good": _User("u1", "stranger@nowhere.co")})
    sb.store["staff"] = [{"id": "s1", "company_id": CO_A, "email": "sam@acme.co"}]
    _patch(monkeypatch, sb)
    with pytest.raises(HTTPException) as e:
        auth.resolve_identity("Bearer good")
    assert e.value.status_code == 403  # valid user, but not a staff member → no access


def test_identity_cannot_be_spoofed_to_other_company(monkeypatch):
    # A user's company is whatever their staff row says — never client-supplied.
    sb = FakeSupabaseWithAuth({"good": _User("u1", "sam@acme.co")})
    sb.store["staff"] = [{"id": "s1", "company_id": CO_A, "email": "sam@acme.co"}]
    _patch(monkeypatch, sb)
    ident = auth.resolve_identity("Bearer good")
    assert ident.company_id == CO_A  # cannot be anything else
