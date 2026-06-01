"""Slack connector — channel history → normalized docs for RAG.

HTTP injected for tests. Reads recent messages from the given channels (or all
the bot is in). Built so it can be upgraded to the Events API (streaming) later
without touching the pipeline.
"""

from __future__ import annotations

from typing import Any, Iterable


class SlackConnector:
    source = "slack"

    def __init__(self, token: str, channels: list[str] | None = None, fetch: Any | None = None):
        self._token = token
        self._channels = channels
        self._fetch = fetch or self._http_fetch

    def poll(self) -> Iterable[dict]:
        for msg in self._fetch():
            yield {
                "type": "message",
                "content": msg.get("text", ""),
                "author": msg.get("user"),
                "timestamp": msg.get("ts"),
                "metadata": {"channel": msg.get("channel")},
            }

    def _http_fetch(self) -> list[dict]:  # pragma: no cover - needs live Slack
        import httpx

        headers = {"Authorization": f"Bearer {self._token}"}
        channels = self._channels or self._list_channels(headers)
        out: list[dict] = []
        for ch in channels:
            r = httpx.get("https://slack.com/api/conversations.history",
                          headers=headers, params={"channel": ch, "limit": 100}, timeout=30)
            data = r.json()
            for m in data.get("messages", []):
                if m.get("type") == "message" and m.get("text"):
                    out.append({"text": m["text"], "user": m.get("user"),
                                "ts": m.get("ts"), "channel": ch})
        return out

    def _list_channels(self, headers: dict) -> list[str]:  # pragma: no cover
        import httpx

        r = httpx.get("https://slack.com/api/conversations.list",
                      headers=headers, params={"types": "public_channel", "limit": 50}, timeout=30)
        return [c["id"] for c in r.json().get("channels", [])]
