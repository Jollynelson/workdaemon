"""Role → permitted MCP tools (FINAL spec Section 11 permission map).

The agent only ever sees the tools its staff member's access_level allows. This
is the structural enforcement point for "a junior agent cannot call finance/HR".
"""

from __future__ import annotations

# access_level → tool names. Higher levels are supersets, but we list explicitly
# so the map is auditable rather than computed.
ROLE_TOOLS: dict[str, list[str]] = {
    "junior": ["slack", "notion", "google_drive"],
    "manager": ["slack", "notion", "google_drive", "crm", "project"],
    "director": ["slack", "notion", "google_drive", "crm", "finance", "hr", "project"],
    "executive": [
        "slack", "notion", "google_drive", "crm", "finance", "hr", "project",
        "market_feeds", "all_reports", "agent_interaction_logs",
    ],
}

VALID_LEVELS = frozenset(ROLE_TOOLS)


def tools_for(access_level: str) -> list[str]:
    """Permitted tools for an access level. Unknown levels get the safest set."""
    return list(ROLE_TOOLS.get(access_level, ROLE_TOOLS["junior"]))


def can_use(access_level: str, tool: str) -> bool:
    return tool in ROLE_TOOLS.get(access_level, ())
