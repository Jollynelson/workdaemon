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


# Greeting shape for the two session-boot sentinels (appended to the system prompt).
_SESSION_START_NOTE = """

## Session start (fresh session)
Open with a `boot` block, then a welcome to the user written in YOUR personality/voice (make it interesting and memorable — this is their first impression of you), then 1-2 catch-up blocks from recent activity. End with 3 suggestions.
boot shape: {"type":"boot","title":"DAEMON BOOT SEQUENCE","lines":[{"label":"Identity","status":"ok","detail":"<name> · <role>"},{"label":"Company Brain","status":"ok","detail":"<company> · LINKED"},{"label":"Knowledge graph","status":"pending","detail":"connect tools to activate"},{"label":"Permission","status":"ok","detail":"LEVEL <n>"},{"label":"Memory","status":"ok","detail":"Learning your patterns"}]}"""

_SESSION_RESUME_NOTE = """

## Returning session
The user is RESUMING an existing conversation — their prior messages are in the history above. Do NOT show a boot sequence and do NOT re-introduce yourself. Give a brief 1-2 sentence "welcome back" in YOUR personality/voice that nods to continuity, then surface ONLY what is NEW since last time (pending tasks, recent activity). 2-3 blocks max. End with 3 suggestions."""


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
        recent_activity_fn: Any | None = None,  # () -> list[dict] (activity events)
        daemon_editor: Any | None = None,    # (staff_id, patch: dict) -> dict
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
        # Recent activity-feed events for the [SESSION_START] catch-up briefing.
        self._recent_activity = recent_activity_fn or (lambda: [])
        # Lets the daemon edit its own name/persona when the user asks in chat.
        self._daemon_editor = daemon_editor

    def handle_turn(self, staff_id: str, message: str, history: list[dict] | None = None) -> ChatReply:
        history = history or []
        profile, system_prompt = self._factory.load_for_conversation(staff_id)
        is_session_start = message.strip() == "[SESSION_START]"
        is_session_resume = message.strip() == "[SESSION_RESUME]"
        is_boot = is_session_start or is_session_resume

        # Inject pending task deliveries into the system prompt.
        pending = self._pending_tasks(staff_id)
        if pending:
            system_prompt += "\n\n## Pending tasks assigned to you\n" + _format_tasks(pending)

        # Session-boot turns: [SESSION_START] = fresh (full boot + welcome),
        # [SESSION_RESUME] = returning (brief "welcome back" delta; prior transcript
        # is already in history). Both get the recent-activity digest and are always
        # served by the fast hosted model below — never a cold company GPU.
        if is_boot:
            digest = _format_activity(self._recent_activity())
            if digest:
                system_prompt += "\n\n## Recent activity (for your catch-up briefing)\n" + digest
            system_prompt += _SESSION_START_NOTE if is_session_start else _SESSION_RESUME_NOTE

        executor: ToolExecutor = self._build_executor(profile.access_level)
        # Self-management: let the daemon persist a name/persona change the user
        # asks for in chat (bound to this staff member).
        if self._daemon_editor is not None:
            executor.register(
                "update_daemon",
                lambda args, sid=staff_id: self._daemon_editor(sid, args),
            )
        # Pick the model for this turn: the company's own trained model (hybrid)
        # if build_model is provided, else the fixed default model. The catch-up
        # greeting always uses the fast hosted model directly — never routed to a
        # cold company GPU, so session boot is always instant.
        if is_boot or not self._build_model:
            model = self._model
        else:
            model = self._build_model(system_prompt, self._model)
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


def _format_activity(events: list[dict]) -> str:
    """One line per recent activity event for the catch-up digest."""
    lines = []
    for e in events:
        payload = e.get("payload") or {}
        summary = payload.get("user_message") or payload.get("tool") or payload.get("title") or ""
        lines.append(f"- {e.get('event_type', 'event')}: {str(summary)[:160]}")
    return "\n".join(lines)
