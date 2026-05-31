"""Cross-agent intent detection — FINAL spec Section 7 (check_and_route).

After an agent response is produced, the Brain (Flash) checks whether it contains
a cross-agent intent ("assign X to Sarah", "done, pushing to James") and, if so,
routes a task or a handoff. Detection is a fast Brain call returning structured
JSON; the router/handoff do the rest.
"""

from __future__ import annotations

from src.brain.router import BrainRouter
from src.cross_agent.handoff import HandoffCoordinator
from src.cross_agent.task_router import TaskIntent, TaskRouter

INTENT_PROMPT = """Analyze this agent response for a cross-agent action. Return ONLY JSON:
{{"intent": "assign|handoff|none",
  "assignee_name": "<name or null>", "title": "<task title or null>",
  "priority": "low|normal|high|urgent", "confidence": 0.0-1.0}}

Agent response: {response}
"""


class CrossAgentCoordinator:
    def __init__(
        self,
        brain: BrainRouter,
        task_router: TaskRouter,
        handoff: HandoffCoordinator,
        resolve_staff_id: callable,
    ) -> None:
        self._brain = brain
        self._router = task_router
        self._handoff = handoff
        # resolve_staff_id(name) -> staff_id | None (company-scoped lookup)
        self._resolve = resolve_staff_id

    def check_and_route(
        self,
        agent_response: str,
        sender_id: str,
        sender_name: str = "A teammate",
        source_task_id: str | None = None,
    ) -> dict | None:
        resp = self._brain.call(
            kind="brain", depth="fast", task_type="triage",
            prompt=INTENT_PROMPT.format(response=agent_response),
        )
        data = resp.json() or {}
        intent = data.get("intent", "none")
        if intent == "none":
            return None

        assignee_id = self._resolve(data.get("assignee_name")) if data.get("assignee_name") else None

        if intent == "handoff" and source_task_id:
            return self._handoff.complete_and_hand_off(source_task_id, output=agent_response)

        if intent == "assign" and assignee_id:
            return self._router.route(
                TaskIntent(
                    sender_id=sender_id,
                    target_id=assignee_id,
                    title=data.get("title") or "Task",
                    brief_context=agent_response,
                    priority=data.get("priority", "normal"),
                    sender_name=sender_name,
                )
            )
        return None
