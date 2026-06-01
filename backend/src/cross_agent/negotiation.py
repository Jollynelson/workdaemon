"""Cross-daemon negotiation (workdaemon-cross-daemon-communication.md).

The three scenarios:
  1. Capacity OK → assign smoothly, notify both daemons.
  2. Assignee overloaded → the assigning daemon does NOT silently assign; it
     surfaces a decision (assign anyway / adjust timeline / reassign / split) to
     the human with options the Brain (Flash) generated.
  3. Assignee's daemon pushes back after assignment → ASSIGNMENT_FLAGGED with a
     reason + suggestion, surfaced to the assigner.

Plus proactive AVAILABILITY_UPDATE: a daemon signals HIGH_LOAD before any new
assignment, so other daemons know in advance.

The Brain (Flash) generates counter-proposals; everything is injected, so the
scenarios are fully testable with fakes.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

from src.brain.router import BrainRouter
from src.cross_agent.bus import CrossAgentBus, DaemonEvent
from src.cross_agent.capacity import Workload, assess_workload
from src.cross_agent.task_router import TaskIntent, TaskRouter
from src.db import CompanyDB

ALTERNATIVES_PROMPT = """A manager wants to assign "{title}" to {assignee}, who is
at {load} load ({active} active tasks, {overdue} overdue). Generate 2-4 concrete
options for the manager (assign anyway / adjust timeline / reassign / split).
Return ONLY JSON: {{"options": [{{"label": "...", "detail": "...", "risk": "..."}}]}}
"""


@dataclass
class AssignmentDecision:
    """Surfaced to a human when capacity is at risk (scenario 2)."""

    status: str                       # "assigned" | "decision_required"
    task: dict | None = None
    assignee_id: str | None = None
    workload: Workload | None = None
    options: list[dict] = field(default_factory=list)


class NegotiationEngine:
    def __init__(
        self,
        db: CompanyDB,
        brain: BrainRouter,
        task_router: TaskRouter,
        bus: CrossAgentBus,
        now_iso: str | None = None,
    ) -> None:
        self._db = db
        self._brain = brain
        self._router = task_router
        self._bus = bus
        self._now = now_iso

    # ── Scenario 1 & 2: assigning daemon checks capacity BEFORE executing ──
    def propose_assignment(self, intent: TaskIntent, assignee_id: str,
                           assignee_name: str = "the assignee") -> AssignmentDecision:
        workload = assess_workload(self._db, assignee_id, self._now)
        if workload.acceptable():
            task = self._router.route(TaskIntent(**{**intent.__dict__, "target_id": assignee_id}))
            self._bus.send(DaemonEvent(
                type="TASK_ASSIGNED", from_staff_id=intent.sender_id, to_staff_id=assignee_id,
                content={"task_id": task.get("id"), "title": task.get("title")},
            ))
            return AssignmentDecision(status="assigned", task=task, assignee_id=assignee_id,
                                      workload=workload)

        # Overloaded → surface a decision with Brain-generated options. Do NOT assign.
        options = self._brain.call(
            kind="brain", depth="fast", task_type="analysis",
            prompt=ALTERNATIVES_PROMPT.format(
                title=intent.title or "the task", assignee=assignee_name,
                load=workload.load, active=workload.active_count, overdue=workload.overdue_count),
        ).json() or {}
        return AssignmentDecision(
            status="decision_required", assignee_id=assignee_id, workload=workload,
            options=options.get("options", []),
        )

    # ── Scenario 3: assignee's daemon pushes back after assignment ──
    def flag_assignment(self, task_id: str, reason: str, suggestion: str) -> dict:
        task = self._db.get("tasks", task_id)
        if task is None:
            raise ValueError(f"task {task_id} not found in this company")
        self._db.update("tasks", task_id, {"status": "flagged"})
        return self._bus.send(DaemonEvent(
            type="ASSIGNMENT_FLAGGED",
            from_staff_id=task.get("to_staff_id"),
            to_staff_id=task.get("from_staff_id"),
            content={"task_id": task_id, "flag": "capacity_risk",
                     "reason": reason, "suggestion": suggestion},
        ))

    # ── Proactive: a daemon signals its own availability before anything arrives ──
    def signal_availability(self, staff_id: str) -> dict:
        workload = assess_workload(self._db, staff_id, self._now)
        return self._bus.send(DaemonEvent(
            type="AVAILABILITY_UPDATE", from_staff_id=staff_id, to_staff_id=None,
            content={"status": workload.load,
                     "reason": f"{workload.active_count} active, {workload.overdue_count} overdue"},
        ))
