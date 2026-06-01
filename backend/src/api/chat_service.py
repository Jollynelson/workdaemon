"""Chat service — the heart of Brain visibility (FINAL spec Section 7).

Every staff↔agent turn flows through here, so the Brain sees everything:
  1. load profile + fresh system prompt (factory)
  2. inject any pending task deliveries
  3. run the agent turn (own runtime: model ↔ tools)
  4. post_interaction: log → emit activity event → check cross-agent intent

This is transport-agnostic: the FastAPI route, a Telegram bridge, or a test all
call handle_turn(). Collaborators are injected so it runs without live services.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from src.agents.factory import AgentFactory
from src.agents.runtime import AgentModel, run_turn
from src.agents.tools import ToolExecutor
from src.brain.activity_feed import ActivityEvent, ActivityFeed
from src.brain.logger import Interaction, InteractionLogger


@dataclass
class ChatReply:
    text: str
    tools_called: list
    interaction_id: str | None
    routed_task_id: str | None = None


class ChatService:
    def __init__(
        self,
        factory: AgentFactory,
        model: AgentModel,
        feed: ActivityFeed,
        logger: InteractionLogger,
        build_executor: Any,                 # (access_level) -> ToolExecutor
        coordinator: Any | None = None,      # CrossAgentCoordinator (optional)
        pending_tasks_fn: Any | None = None,  # (staff_id) -> list[dict]
        build_model: Any | None = None,      # (system_prompt, fallback) -> AgentModel
    ) -> None:
        self._factory = factory
        self._model = model
        self._feed = feed
        self._logger = logger
        self._build_executor = build_executor
        self._coordinator = coordinator
        self._pending_tasks = pending_tasks_fn or (lambda sid: [])
        # Hybrid: per-turn model selection (e.g. company's own model when it has
        # an adapter). Defaults to the fixed model — backward compatible.
        self._build_model = build_model

    def handle_turn(self, staff_id: str, message: str, history: list[dict] | None = None) -> ChatReply:
        history = history or []
        profile, system_prompt = self._factory.load_for_conversation(staff_id)

        # Inject pending task deliveries into the system prompt.
        pending = self._pending_tasks(staff_id)
        if pending:
            system_prompt += "\n\n## Pending tasks assigned to you\n" + _format_tasks(pending)

        executor: ToolExecutor = self._build_executor(profile.access_level)
        # Pick the model for this turn: the company's own trained model (hybrid)
        # if build_model is provided, else the fixed default model.
        model = self._build_model(system_prompt, self._model) if self._build_model else self._model
        result = run_turn(model, executor, system_prompt, history, message)

        # ── post_interaction: log + feed + cross-agent routing ──
        interaction = self._logger.log(
            Interaction(
                staff_id=staff_id,
                role=profile.role,
                user_message=message,
                agent_response=result.text,
                tools_called=result.tools_called,
            )
        )
        self._feed.emit(
            ActivityEvent(
                event_type="agent_interaction",
                staff_id=staff_id,
                payload={
                    "interaction_id": interaction.get("id"),
                    "user_message": message,
                    "agent_response": result.text,
                    "tools_called": [t.get("tool") for t in result.tools_called],
                    "role": profile.role,
                },
            )
        )
        for t in result.tools_called:
            self._feed.emit(
                ActivityEvent(event_type="tool_called", staff_id=staff_id,
                              payload={"tool": t.get("tool"), "ok": "error" not in t})
            )

        routed_task_id = None
        if self._coordinator:
            routed = self._coordinator.check_and_route(
                agent_response=result.text, sender_id=staff_id, sender_name=profile.name
            )
            if routed:
                routed_task_id = routed.get("id")

        return ChatReply(
            text=result.text,
            tools_called=result.tools_called,
            interaction_id=interaction.get("id"),
            routed_task_id=routed_task_id,
        )


def _format_tasks(tasks: list[dict]) -> str:
    return "\n".join(f"- [{t.get('priority','normal')}] {t.get('title')}: {t.get('brief','')}"
                     for t in tasks)
