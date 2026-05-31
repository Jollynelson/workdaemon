"""Output → input pipeline — FINAL spec Section 9.3.

When a task completes, its output becomes the brief for the next agent in the
chain (A → Brain → B). The handoff routes a new task whose context IS the
completed output, and emits the handoff events.
"""

from __future__ import annotations

from src.brain.activity_feed import ActivityEvent, ActivityFeed
from src.cross_agent.task_router import TaskIntent, TaskRouter
from src.db import CompanyDB


class HandoffCoordinator:
    def __init__(self, db: CompanyDB, feed: ActivityFeed, task_router: TaskRouter) -> None:
        self._db = db
        self._feed = feed
        self._router = task_router

    def complete_and_hand_off(
        self,
        task_id: str,
        output: str,
        artifacts: list | None = None,
    ) -> dict | None:
        artifacts = artifacts or []
        task = self._db.get("tasks", task_id)
        if task is None:
            raise ValueError(f"task {task_id} not found in this company")

        self._db.update(
            "tasks",
            task_id,
            {"status": "completed", "output": output, "output_artifacts": artifacts},
        )
        self._feed.emit(
            ActivityEvent(
                event_type="task_completed",
                staff_id=task.get("to_staff_id"),
                payload={"task_id": task_id, "output_preview": output[:200]},
            )
        )

        next_agent_id = task.get("next_agent_id")
        if not next_agent_id:
            return None

        # Sarah's output IS James's brief.
        next_task = self._router.route(
            TaskIntent(
                sender_id=task.get("to_staff_id"),
                target_id=next_agent_id,
                title=f"[From upstream]: {task.get('title')}",
                brief_context=output,
                artifacts=artifacts,
                priority=task.get("priority", "normal"),
            )
        )
        self._db.update("tasks", task_id, {"status": "handed_off"})
        self._feed.emit(
            ActivityEvent(
                event_type="cross_agent_handoff",
                staff_id=task.get("to_staff_id"),
                payload={
                    "from_staff": task.get("to_staff_id"),
                    "to_staff": next_agent_id,
                    "from_task_id": task_id,
                    "to_task_id": next_task.get("id"),
                },
            )
        )
        return next_task
