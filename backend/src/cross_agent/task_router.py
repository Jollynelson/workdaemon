"""Cross-agent task routing — FINAL spec Section 9.2.

The Brain (Flash) turns a natural-language assignment intent into a structured
task: assignee, brief, priority, and the output pipeline (who gets it on
completion). It creates the task, emits a task_created event, and delivers a push
to the receiving staff member's inbox.

Pure orchestration — db, brain router, feed, and push inbox are all injected, so
this is fully testable with fakes.
"""

from __future__ import annotations

import json
from dataclasses import dataclass, field
from typing import Any

from src.brain.activity_feed import ActivityEvent, ActivityFeed
from src.brain.router import BrainRouter
from src.db import CompanyDB

TASK_ROUTING_PROMPT = """You are the company Brain routing a task between staff.
Given the request and company context, return ONLY a JSON object:
{{"assignee_id": "<staff uuid>", "title": "...", "priority": "low|normal|high|urgent",
  "next_assignee_id": "<staff uuid or null>", "routing_rationale": "...",
  "confidence": 0.0-1.0}}

Request: {intent}
Company context: {context}
"""


@dataclass
class TaskIntent:
    sender_id: str | None
    target_id: str | None = None          # explicit target, if known
    title: str = ""
    brief_context: str = ""               # free-text context / sender's output
    artifacts: list = field(default_factory=list)
    priority: str | None = None
    sender_name: str = "A teammate"


class PushDeliverer:
    """Minimal protocol the router needs from the push inbox."""

    def deliver(self, staff_id: str, push: dict) -> Any:  # pragma: no cover - protocol
        raise NotImplementedError


class TaskRouter:
    def __init__(
        self,
        db: CompanyDB,
        brain: BrainRouter,
        feed: ActivityFeed,
        push: PushDeliverer,
        context_fn: Any | None = None,
    ) -> None:
        self._db = db
        self._brain = brain
        self._feed = feed
        self._push = push
        # context_fn(intent) -> str ; defaults to the free-text brief context.
        self._context_fn = context_fn or (lambda intent: intent.brief_context)

    def route(self, intent: TaskIntent) -> dict:
        context = self._context_fn(intent)

        # If the caller already resolved the assignee (e.g. an explicit handoff),
        # skip the Brain classification call and use it directly.
        if intent.target_id:
            task_data = {
                "assignee_id": intent.target_id,
                "title": intent.title or "Task",
                "priority": intent.priority or "normal",
                "next_assignee_id": None,
                "routing_rationale": "explicit target",
                "confidence": 1.0,
            }
        else:
            resp = self._brain.call(
                kind="brain",
                depth="fast",
                task_type="triage",
                prompt=TASK_ROUTING_PROMPT.format(intent=intent.title or intent.brief_context,
                                                  context=context),
            )
            task_data = resp.json() or {}
            if not task_data.get("assignee_id"):
                raise ValueError("Brain could not resolve a task assignee")

        brief = self._build_brief(task_data, context, intent)
        task = self._db.insert(
            "tasks",
            {
                "title": task_data.get("title") or intent.title or "Task",
                "brief": brief,
                "from_staff_id": intent.sender_id,
                "to_staff_id": task_data["assignee_id"],
                "priority": task_data.get("priority", "normal"),
                "next_agent_id": task_data.get("next_assignee_id"),
                "status": "pending",
                "routed_by_brain": not bool(intent.target_id),
                "brain_context": {"rationale": task_data.get("routing_rationale")},
                "output_artifacts": intent.artifacts,
            },
        )

        self._feed.emit(
            ActivityEvent(
                event_type="task_created",
                staff_id=intent.sender_id,
                payload={"task_id": task.get("id"), "title": task.get("title"),
                         "to_staff_id": task["to_staff_id"]},
            )
        )

        self._push.deliver(
            task["to_staff_id"],
            {
                "kind": "task_assignment",
                "task_id": task.get("id"),
                "message": f"{intent.sender_name} assigned you: {task.get('title')}",
                "draft_artifact": brief,
            },
        )
        return task

    @staticmethod
    def _build_brief(task_data: dict, context: str, intent: TaskIntent) -> str:
        parts = [f"Task: {task_data.get('title') or intent.title}"]
        if task_data.get("routing_rationale"):
            parts.append(f"Why you: {task_data['routing_rationale']}")
        if context:
            parts.append(f"Context:\n{context}")
        if intent.artifacts:
            parts.append(f"Artifacts: {json.dumps(intent.artifacts)}")
        return "\n\n".join(parts)
