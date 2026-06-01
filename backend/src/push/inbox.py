"""Per-staff push inbox (FINAL spec Section 9/12).

Pushes (task assignments, hunt findings, patterns, Brain insights) are persisted
to the pushes table and surfaced to the staff member's agent — at next chat turn
(pending lookup) or in real time via websocket. Implements the PushDeliverer
protocol the cross-agent task router needs.
"""

from __future__ import annotations

from typing import Any

from src.db import CompanyDB


class PushInbox:
    def __init__(self, db: CompanyDB, notifier: Any | None = None) -> None:
        self._db = db
        # notifier(staff_id, push_row) -> None : real-time websocket push (optional)
        self._notifier = notifier

    def deliver(self, staff_id: str, push: dict) -> dict:
        row = self._db.insert(
            "pushes",
            {
                "staff_id": staff_id,
                "kind": push.get("kind", "brain_insight"),
                "message": push.get("message", ""),
                "recommended_action": push.get("recommended_action"),
                "draft_artifact": push.get("draft_artifact"),
                "task_id": push.get("task_id"),
                "finding_id": push.get("finding_id"),
                "pattern_id": push.get("pattern_id"),
            },
        )
        if self._notifier:
            self._notifier(staff_id, row)
        return row

    def pending_for(self, staff_id: str) -> list[dict]:
        """Undelivered pushes for this staff member; marks them delivered."""
        from datetime import datetime, timezone

        resp = (
            self._db.select("pushes")
            .eq("staff_id", staff_id)
            .is_("delivered_at", "null")   # SQL NULL, not the string "None"
            .execute()
        )
        rows = getattr(resp, "data", None) or []
        now = datetime.now(timezone.utc).isoformat()
        for r in rows:
            self._db.update("pushes", r["id"], {"delivered_at": now})
        return rows

    def mark_acted(self, push_id: str, acted: bool) -> None:
        self._db.update("pushes", push_id, {"acted_on": acted})
