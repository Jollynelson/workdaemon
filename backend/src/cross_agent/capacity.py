"""Capacity reasoning (cross-daemon doc — "The Intelligence Stack").

A daemon doesn't just count tasks — it estimates load, discounting tasks that are
blocked (waiting, no active work) and weighting overdue ones. Produces a workload
snapshot + a HIGH/MEDIUM/LOW load level used by pre-assignment checks and the
proactive AVAILABILITY_UPDATE signal.
"""

from __future__ import annotations

from dataclasses import dataclass

from src.db import CompanyDB

HIGH_LOAD_ACTIVE = 4     # active (non-blocked) tasks at/above this → HIGH
MEDIUM_LOAD_ACTIVE = 2

# statuses that are "open" but need no active work right now
_BLOCKED = {"blocked", "flagged"}
_DONE = {"completed", "handed_off"}


@dataclass
class Workload:
    staff_id: str
    open_count: int
    active_count: int     # open minus blocked
    overdue_count: int
    blocked_count: int
    load: str             # HIGH | MEDIUM | LOW

    def acceptable(self) -> bool:
        return self.load != "HIGH"


def assess_workload(db: CompanyDB, staff_id: str, now_iso: str | None = None) -> Workload:
    resp = db.select("tasks").eq("to_staff_id", staff_id).execute()
    rows = getattr(resp, "data", None) or []
    open_rows = [r for r in rows if r.get("status") not in _DONE]
    blocked = [r for r in open_rows if r.get("status") in _BLOCKED]
    active = [r for r in open_rows if r.get("status") not in _BLOCKED]
    overdue = [r for r in open_rows
               if now_iso and r.get("due_at") and str(r["due_at"]) < now_iso]

    n_active = len(active)
    if n_active >= HIGH_LOAD_ACTIVE:
        load = "HIGH"
    elif n_active >= MEDIUM_LOAD_ACTIVE:
        load = "MEDIUM"
    else:
        load = "LOW"

    return Workload(
        staff_id=staff_id,
        open_count=len(open_rows),
        active_count=n_active,
        overdue_count=len(overdue),
        blocked_count=len(blocked),
        load=load,
    )
