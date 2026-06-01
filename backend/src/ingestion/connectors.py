"""Connector interface + Notion connector (FINAL spec §12).

A connector yields raw items via poll() or on_webhook(). Built so a single tool
can be upgraded to streaming later without touching the pipeline. The Notion
connector's HTTP client is injected so it's testable offline.
"""

from __future__ import annotations

from typing import Any, Iterable, Protocol


class Connector(Protocol):
    source: str

    def poll(self) -> Iterable[dict]: ...


class NotionConnector:
    source = "notion"

    def __init__(self, token: str, fetch: Any | None = None) -> None:
        self._token = token
        # fetch() -> list[raw page dict]; injected for tests, real HTTP in prod
        self._fetch = fetch or self._http_fetch

    def poll(self) -> Iterable[dict]:
        for page in self._fetch():
            yield {
                "type": "page",
                "content": page.get("text", ""),
                "author": page.get("last_edited_by"),
                "timestamp": page.get("last_edited_time"),
                "metadata": {"page_id": page.get("id"), "title": page.get("title")},
            }

    def _http_fetch(self) -> list[dict]:  # pragma: no cover - needs live Notion
        import httpx

        r = httpx.post(
            "https://api.notion.com/v1/search",
            headers={"Authorization": f"Bearer {self._token}",
                     "Notion-Version": "2022-06-28"},
            json={"filter": {"property": "object", "value": "page"}},
            timeout=30,
        )
        r.raise_for_status()
        out = []
        for res in r.json().get("results", []):
            out.append({"id": res.get("id"),
                        "title": _notion_title(res),
                        "text": _notion_title(res),
                        "last_edited_time": res.get("last_edited_time")})
        return out


def _notion_title(result: dict) -> str:
    props = result.get("properties", {})
    for v in props.values():
        if v.get("type") == "title":
            return "".join(t.get("plain_text", "") for t in v.get("title", []))
    return ""
