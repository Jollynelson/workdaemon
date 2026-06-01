"""The agent runtime loop (own-runtime decision, 2026-06-01).

Replaces the spec's "call the staff member's Hermes API server". One conversation
turn:
  1. system prompt (role-aware, fresh Brain context) + history + user message
  2. call the agent model (DeepSeek Flash) via the OpenAI-compatible client
  3. parse <tool_call> blocks → execute permitted tools → feed results back
  4. loop until the model returns a final answer (no tool calls) or max rounds
  5. return final text + the tools called (for logging + activity feed)

The model client is the same OpenAI-compatible shape used for the Brain; agents
use the FAST model with thinking off. Injected for testability.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

from src.agents.tools import ToolCall, ToolExecutor, parse_tool_calls

MAX_TOOL_ROUNDS = 5


@dataclass
class AgentResult:
    text: str
    tools_called: list[dict] = field(default_factory=list)
    rounds: int = 1


class AgentModel:
    """Minimal protocol: given messages, return assistant text."""

    def chat(self, messages: list[dict]) -> str:  # pragma: no cover - protocol
        raise NotImplementedError


class DeepSeekAgentModel:
    """Agent-tier model: DeepSeek Flash, thinking off, via OpenAI-compatible client."""

    def __init__(self, api_key: str, base_url: str, model: str) -> None:
        self._api_key, self._base_url, self._model = api_key, base_url, model
        self.__client: Any | None = None

    def _client(self) -> Any:
        if self.__client is None:
            from openai import OpenAI

            self.__client = OpenAI(api_key=self._api_key, base_url=self._base_url)
        return self.__client

    def chat(self, messages: list[dict]) -> str:
        from src.resilience import retry_call

        resp = retry_call(
            lambda: self._client().chat.completions.create(
                model=self._model,
                messages=messages,
                max_tokens=4096,
                extra_body={"thinking": {"type": "disabled"}},
            ),
            label=f"agent:{self._model}",
        )
        return resp.choices[0].message.content or ""


def run_turn(
    model: AgentModel,
    executor: ToolExecutor,
    system_prompt: str,
    history: list[dict],
    user_message: str,
) -> AgentResult:
    """Run one full agentic turn (model ↔ tools) and return the final answer."""
    messages = [{"role": "system", "content": system_prompt}, *history,
                {"role": "user", "content": user_message}]
    tools_called: list[dict] = []

    for round_no in range(1, MAX_TOOL_ROUNDS + 1):
        text = model.chat(messages)
        calls = parse_tool_calls(text)
        if not calls:
            return AgentResult(text=text, tools_called=tools_called, rounds=round_no)

        # Execute every requested tool, feed results back as a tool/assistant turn.
        messages.append({"role": "assistant", "content": text})
        results = []
        for call in calls:
            result = executor.execute(call)
            tools_called.append(result)
            results.append(result)
        messages.append({"role": "user", "content": _format_tool_results(results)})

    # Hit the round cap — ask once more for a final answer without tools.
    messages.append({"role": "user",
                     "content": "Provide your final answer now without calling tools."})
    final = model.chat(messages)
    return AgentResult(text=final, tools_called=tools_called, rounds=MAX_TOOL_ROUNDS + 1)


def _format_tool_results(results: list[dict]) -> str:
    import json

    return "<tool_response>\n" + json.dumps(results) + "\n</tool_response>"
