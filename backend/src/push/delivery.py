"""Push delivery + calibration (FINAL spec Section 9/cross-daemon doc).

Calibration honours demonstrated preferences: if a staff member repeatedly
ignores a push kind, back off its frequency for them. Trust comes from the
acted_on history on the pushes table.
"""

from __future__ import annotations

from src.db import CompanyDB

# back off a push kind for a staff member after this many consecutive ignores
IGNORE_BACKOFF_THRESHOLD = 3


class PushCalibrator:
    def __init__(self, db: CompanyDB) -> None:
        self._db = db

    def should_deliver(self, staff_id: str, kind: str) -> bool:
        """False if this staff member has ignored this kind too many times lately."""
        resp = (
            self._db.select("pushes")
            .eq("staff_id", staff_id)
            .eq("kind", kind)
            .order("created_at", desc=True)
            .limit(IGNORE_BACKOFF_THRESHOLD)
            .execute()
        )
        rows = getattr(resp, "data", None) or []
        if len(rows) < IGNORE_BACKOFF_THRESHOLD:
            return True
        # delivered but never acted on across the recent window → back off
        return not all(r.get("acted_on") is False for r in rows)
