"""Google Drive + Calendar: connectors, tool registration, permission mapping."""

from __future__ import annotations

from src.agents.tool_permissions import can_use, permission_for
from src.agents.tools import ToolCall, ToolExecutor
from src.ingestion.google_connectors import GoogleDriveConnector, GoogleCalendarConnector
from src.integrations.store import IntegrationStore
from src.integrations.tools import register_company_tools
from src.db import CompanyDB
from tests.conftest import FakeSupabase

CO = "11111111-1111-1111-1111-111111111111"


# ── permission mapping: drive + calendar ride google_drive ──
def test_permission_mapping():
    assert permission_for("gdrive_search") == "google_drive"
    assert permission_for("gcal_upcoming") == "google_drive"
    assert permission_for("notion_search") == "notion"
    assert permission_for("slack_post_message") == "slack"


def test_can_use_accepts_concrete_tool_name():
    # junior is allowed google_drive → both gdrive_ and gcal_ tools resolve
    assert can_use("junior", "gdrive_search") is True
    assert can_use("junior", "gcal_upcoming") is True
    assert can_use("junior", "finance_lookup") is False  # not permitted


# ── connectors normalize ──
def test_gdrive_connector_normalizes():
    conn = GoogleDriveConnector("tok", fetch=lambda: [
        {"id": "f1", "name": "Q3 Plan", "text": "revenue plan", "mimeType": "doc",
         "modifiedTime": "2026-06-01", "owner": "a@co"}])
    items = list(conn.poll())
    assert items[0]["type"] == "file" and items[0]["metadata"]["file_id"] == "f1"
    assert "revenue plan" in items[0]["content"]


def test_gcal_connector_normalizes():
    conn = GoogleCalendarConnector("tok", fetch=lambda: [
        {"id": "e1", "summary": "Board sync", "description": "Q3 review",
         "start": {"dateTime": "2026-06-02T15:00:00Z"},
         "attendees": [{"email": "ceo@co"}]}])
    items = list(conn.poll())
    assert items[0]["type"] == "event" and "Board sync" in items[0]["content"]
    assert items[0]["metadata"]["start"] == "2026-06-02T15:00:00Z"


# ── registration: connected google → tools available, executable ──
def test_google_tools_registered_and_executable():
    store = IntegrationStore(CompanyDB(CO, client=FakeSupabase()))
    store.connect("gdrive", "gtoken")
    store.connect("gcal", "gtoken")
    ex = ToolExecutor("junior")   # junior has google_drive permission
    register_company_tools(ex, CO, store=store)
    assert "gdrive_search" in ex._handlers
    assert "gcal_upcoming" in ex._handlers
    # the executor permission gate ALLOWS them (gdrive_search → google_drive perm).
    # assert via can_use directly (no network call to Google).
    assert can_use(ex._access_level, "gdrive_search") is True
    assert can_use(ex._access_level, "gcal_upcoming") is True
