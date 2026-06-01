"""MCP tool execution — the agent runtime calls tools itself (own-runtime model).

A ToolExecutor exposes the tools a staff member is permitted to use and runs a
tool call. Real MCP servers plug in via register(); tests/dev use stubs. Every
call is permission-checked against the staff member's access level, so a junior
agent physically cannot invoke a finance tool even if the model emits the call.
"""

from __future__ import annotations

import json
import re
from dataclasses import dataclass
from typing import Any, Callable, Protocol

from src.agents.tool_permissions import can_use

_TOOL_CALL_RE = re.compile(r"<tool_call>\s*(\{.*?\})\s*</tool_call>", re.DOTALL)


@dataclass
class ToolCall:
    name: str
    arguments: dict


def parse_tool_calls(text: str) -> list[ToolCall]:
    """Extract <tool_call>{...}</tool_call> blocks the model emitted."""
    out: list[ToolCall] = []
    for m in _TOOL_CALL_RE.finditer(text):
        try:
            obj = json.loads(m.group(1))
            out.append(ToolCall(name=obj["name"], arguments=obj.get("arguments", {})))
        except (json.JSONDecodeError, KeyError):
            continue
    return out


class ToolHandler(Protocol):
    def __call__(self, arguments: dict) -> Any: ...


class ToolExecutor:
    """Registry + permission-checked execution for one staff member."""

    def __init__(self, access_level: str) -> None:
        self._access_level = access_level
        self._handlers: dict[str, Callable[[dict], Any]] = {}

    def register(self, tool: str, handler: Callable[[dict], Any]) -> None:
        self._handlers[tool] = handler

    def execute(self, call: ToolCall) -> dict:
        """Run a tool call. Returns a structured result (never raises to the loop)."""
        if not can_use(self._access_level, call.name):
            return {"tool": call.name, "error": "permission_denied",
                    "detail": f"access level '{self._access_level}' may not use '{call.name}'"}
        handler = self._handlers.get(call.name)
        if handler is None:
            return {"tool": call.name, "error": "not_configured",
                    "detail": f"tool '{call.name}' is not connected"}
        try:
            return {"tool": call.name, "result": handler(call.arguments)}
        except Exception as exc:  # tool failures must not crash the agent loop
            return {"tool": call.name, "error": "tool_error", "detail": str(exc)}
