"""Google Drive + Calendar connectors — docs/events → normalized docs for RAG.

Both use a Google OAuth access token (Drive + Calendar share one app). HTTP is
injected for tests. Read-only; built so they can be upgraded to push/webhook later
without touching the pipeline.
"""

from __future__ import annotations

from typing import Any, Iterable


class GoogleDriveConnector:
    source = "gdrive"

    def __init__(self, token: str, fetch: Any | None = None):
        self._token = token
        self._fetch = fetch or self._http_fetch

    def poll(self) -> Iterable[dict]:
        for f in self._fetch():
            yield {
                "type": "file",
                "content": f.get("text", "") or f.get("name", ""),
                "author": f.get("owner"),
                "timestamp": f.get("modifiedTime"),
                "metadata": {"file_id": f.get("id"), "name": f.get("name"),
                             "mime": f.get("mimeType")},
            }

    def _http_fetch(self) -> list[dict]:  # pragma: no cover - needs live Google
        import httpx

        h = {"Authorization": f"Bearer {self._token}"}
        r = httpx.get("https://www.googleapis.com/drive/v3/files",
                      headers=h, params={"pageSize": 50,
                      "fields": "files(id,name,mimeType,modifiedTime,owners)"}, timeout=30)
        r.raise_for_status()
        out = []
        for f in r.json().get("files", []):
            text = f.get("name", "")
            # export Google Docs as plain text for real content
            if f.get("mimeType") == "application/vnd.google-apps.document":
                try:
                    ex = httpx.get(
                        f"https://www.googleapis.com/drive/v3/files/{f['id']}/export",
                        headers=h, params={"mimeType": "text/plain"}, timeout=30)
                    if ex.status_code == 200:
                        text = ex.text[:20000]
                except Exception:
                    pass
            owners = f.get("owners") or [{}]
            out.append({"id": f.get("id"), "name": f.get("name"), "text": text,
                        "mimeType": f.get("mimeType"), "modifiedTime": f.get("modifiedTime"),
                        "owner": owners[0].get("emailAddress")})
        return out


class GoogleCalendarConnector:
    source = "gcal"

    def __init__(self, token: str, fetch: Any | None = None):
        self._token = token
        self._fetch = fetch or self._http_fetch

    def poll(self) -> Iterable[dict]:
        for e in self._fetch():
            start = (e.get("start") or {}).get("dateTime") or (e.get("start") or {}).get("date")
            yield {
                "type": "event",
                "content": f"{e.get('summary','(no title)')} — {e.get('description','')}".strip(),
                "timestamp": start,
                "metadata": {"event_id": e.get("id"), "start": start,
                             "attendees": [a.get("email") for a in e.get("attendees", [])]},
            }

    def _http_fetch(self) -> list[dict]:  # pragma: no cover - needs live Google
        import httpx

        r = httpx.get("https://www.googleapis.com/calendar/v3/calendars/primary/events",
                      headers={"Authorization": f"Bearer {self._token}"},
                      params={"maxResults": 50, "orderBy": "startTime", "singleEvents": "true"},
                      timeout=30)
        r.raise_for_status()
        return r.json().get("items", [])
