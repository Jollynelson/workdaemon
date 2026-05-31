"""
Notion connector — the first end-to-end tool (spec Section 16 step 14).

Pulls pages from a Notion workspace, normalizes them, and ingests into the
company's vector store. Reuses the read tools from tools/mcp_notion.py so the
same Notion auth + page-reading logic serves both the agent runtime and ingestion.
"""

from __future__ import annotations

import logging

from src.ingestion.connectors.base import BaseConnector
from src.ingestion.normalize import normalize
from src.tools.mcp_notion import server as notion_server

logger = logging.getLogger(__name__)


class NotionConnector(BaseConnector):
    source = "notion"

    def fetch(self) -> list[dict]:
        """
        Search Notion for pages and fetch their full content.

        config options:
          query: search string (default "" = all pages)
          max_pages: cap on pages per poll (default 50)
        """
        query = self.config.get("query", "")
        max_pages = int(self.config.get("max_pages", 50))

        # Search returns page stubs; fetch full content for each
        stubs = notion_server.call("notion_search", {"query": query})
        if isinstance(stubs, dict) and "error" in stubs:
            logger.warning("Notion search failed: %s", stubs["error"])
            return []

        records: list[dict] = []
        for stub in (stubs or [])[:max_pages]:
            if stub.get("type") != "page":
                continue
            page = notion_server.call("notion_get_page", {"page_id": stub["id"]})
            if isinstance(page, dict) and "error" not in page and page.get("content"):
                records.append({
                    "page_id":   stub["id"],
                    "title":     page.get("title", ""),
                    "content":   page["content"],
                    "url":       stub.get("url", ""),
                })
        logger.info("Notion connector fetched %d pages for company=%s", len(records), self.company_id)
        return records

    def normalize_one(self, raw: dict) -> dict:
        return normalize(
            raw={
                "content":  f"{raw.get('title', '')}\n\n{raw.get('content', '')}",
                "author":   "",
                "page_id":  raw.get("page_id"),
                "title":    raw.get("title"),
                "url":      raw.get("url"),
            },
            source="notion",
            doc_type="page",
            company_id=self.company_id,
        )
