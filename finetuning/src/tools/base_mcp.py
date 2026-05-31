"""
Shared MCP server scaffolding.

Each tool server subclasses BaseMCPServer and implements call().
The base class handles: request validation, error wrapping, token injection.
"""

from __future__ import annotations

import logging
from abc import ABC, abstractmethod
from typing import Any

logger = logging.getLogger(__name__)


class BaseMCPServer(ABC):
    """Base class for all MCP tool servers."""

    name: str = "base"

    def call(self, tool_name: str, arguments: dict) -> Any:
        """Execute a tool call. Returns a JSON-serialisable result or raises."""
        logger.debug("MCP %s.%s(%s)", self.name, tool_name, list(arguments.keys()))
        try:
            return self._dispatch(tool_name, arguments)
        except Exception as exc:
            logger.warning("MCP %s.%s failed: %s", self.name, tool_name, exc)
            return {"error": str(exc)}

    @abstractmethod
    def _dispatch(self, tool_name: str, arguments: dict) -> Any:
        """Tool-specific dispatch. Raise ValueError for unknown tools."""

    def list_tools(self) -> list[str]:
        """Override to return the list of tool names this server handles."""
        return []
