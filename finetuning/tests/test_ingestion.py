"""Ingestion tests — chunking, normalization, and the Notion connector."""

from __future__ import annotations

from unittest.mock import MagicMock, patch

from src.ingestion.normalize import normalize
from src.ingestion.pipeline import _chunk


# ── Normalization ─────────────────────────────────────────────────────────────

class TestNormalize:
    def test_normalize_produces_standard_format(self):
        doc = normalize(
            raw={"content": "Hello world", "author": "alice@acme.test"},
            source="slack", doc_type="message", company_id="company-a",
        )
        assert doc["source"] == "slack"
        assert doc["type"] == "message"
        assert doc["company_id"] == "company-a"
        assert doc["content"] == "Hello world"
        assert "timestamp" in doc

    def test_normalize_always_carries_company_id(self):
        doc = normalize(raw={"content": "x"}, source="notion", doc_type="page", company_id="company-b")
        assert doc["company_id"] == "company-b"

    def test_normalize_strips_control_chars(self):
        doc = normalize(raw={"content": "a\x00b\x07c"}, source="x", doc_type="y", company_id="c")
        assert "\x00" not in doc["content"]


# ── Chunking ──────────────────────────────────────────────────────────────────

class TestChunking:
    def test_short_text_single_chunk(self):
        chunks = list(_chunk("just a few words here"))
        assert len(chunks) == 1

    def test_long_text_multiple_chunks(self):
        text = " ".join(["word"] * 1000)
        chunks = list(_chunk(text, size=400, overlap=64))
        assert len(chunks) > 1

    def test_chunks_overlap(self):
        words = [f"w{i}" for i in range(500)]
        text = " ".join(words)
        chunks = list(_chunk(text, size=400, overlap=64))
        # Second chunk should start before the first chunk's last word (overlap)
        first_words = chunks[0].split()
        second_words = chunks[1].split()
        assert second_words[0] in first_words


# ── Notion connector ──────────────────────────────────────────────────────────

class TestNotionConnector:
    @patch("src.ingestion.connectors.notion_connector.notion_server")
    @patch("src.ingestion.connectors.base.ingest_batch", return_value=7)
    def test_poll_fetches_normalizes_ingests(self, mock_ingest, mock_notion):
        from src.ingestion.connectors.notion_connector import NotionConnector

        mock_notion.call.side_effect = [
            # notion_search → page stubs
            [{"id": "page-1", "type": "page", "url": "http://n/1"}],
            # notion_get_page → full content
            {"id": "page-1", "title": "Onboarding SOP", "content": "Step one: create account."},
        ]

        connector = NotionConnector("company-a", config={"query": "sop"})
        chunks = connector.poll()

        assert chunks == 7
        # ingest_batch was called with normalized docs for company-a
        called_docs, called_company = mock_ingest.call_args[0]
        assert called_company == "company-a"
        assert called_docs[0]["source"] == "notion"
        assert "Onboarding SOP" in called_docs[0]["content"]

    @patch("src.ingestion.connectors.notion_connector.notion_server")
    @patch("src.ingestion.connectors.base.ingest_batch", return_value=0)
    def test_poll_handles_search_error(self, mock_ingest, mock_notion):
        from src.ingestion.connectors.notion_connector import NotionConnector

        mock_notion.call.return_value = {"error": "auth failed"}
        connector = NotionConnector("company-a")
        chunks = connector.poll()
        assert chunks == 0
