"""Integrations: token crypto, encrypt-at-rest store, Slack connector, route mount."""

from __future__ import annotations

from src.db import CompanyDB
from src.integrations.crypto import decrypt, encrypt
from src.integrations.store import IntegrationStore
from src.ingestion.slack_connector import SlackConnector
from tests.conftest import FakeSupabase

CO = "11111111-1111-1111-1111-111111111111"


def test_crypto_roundtrip():
    secret = "xoxb-super-secret-token"
    assert decrypt(encrypt(secret)) == secret
    assert encrypt(secret) != secret  # actually encrypted


def test_store_encrypts_at_rest_and_decrypts_on_read():
    sb = FakeSupabase()
    store = IntegrationStore(CompanyDB(CO, client=sb))
    store.connect("notion", "secret_token_123", {"workspace": "w1"})
    # DB row holds ciphertext, not plaintext
    raw = sb.store["integrations"][0]["access_token"]
    assert raw and raw != "secret_token_123"
    # read returns decrypted
    integ = store.get("notion")
    assert integ.access_token == "secret_token_123"
    assert integ.metadata["workspace"] == "w1"


def test_store_connect_is_idempotent_per_provider():
    sb = FakeSupabase()
    store = IntegrationStore(CompanyDB(CO, client=sb))
    store.connect("notion", "tok1")
    store.connect("notion", "tok2")   # replace, not duplicate
    assert len(sb.store["integrations"]) == 1
    assert store.get("notion").access_token == "tok2"


def test_list_connected():
    sb = FakeSupabase()
    store = IntegrationStore(CompanyDB(CO, client=sb))
    store.connect("notion", "t")
    store.connect("slack", "t")
    assert set(store.list_connected()) == {"notion", "slack"}


def test_slack_connector_normalizes():
    conn = SlackConnector("tok", fetch=lambda: [
        {"text": "deploy is green", "user": "U1", "ts": "123.45", "channel": "C1"}])
    items = list(conn.poll())
    assert items[0]["type"] == "message"
    assert items[0]["content"] == "deploy is green"
    assert items[0]["metadata"]["channel"] == "C1"


def test_integration_routes_mounted():
    from src.api.main import app
    paths = {r.path for r in app.routes if hasattr(r, "path")}
    assert "/api/integrations" in paths
    assert "/api/integrations/connect" in paths
    assert "/api/integrations/ingest" in paths
