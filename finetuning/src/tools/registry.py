"""
Tool registry — central permission map and MCP client dispatcher.

TOOL_PERMISSIONS enforces what each access level can call.
get_mcp_client() returns the right MCP server wrapper for a tool name.
The agent runtime checks _is_tool_permitted() before any call.
"""

from __future__ import annotations

TOOL_PERMISSIONS: dict[str, list[str]] = {
    "executive": [
        "slack_search", "slack_send_message", "slack_get_channel_history",
        "notion_search", "notion_get_page", "notion_update_page", "notion_create_page",
        "gdrive_search", "gdrive_read_file",
        "crm_lookup", "crm_update_deal", "crm_list_deals",
        "finance_summary", "finance_invoices", "finance_cashflow",
        "hr_headcount", "hr_performance", "hr_alerts",
    ],
    "director": [
        "slack_search", "slack_send_message", "slack_get_channel_history",
        "notion_search", "notion_get_page", "notion_update_page", "notion_create_page",
        "gdrive_search", "gdrive_read_file",
        "crm_lookup", "crm_update_deal", "crm_list_deals",
        "finance_summary", "finance_invoices",
        "hr_headcount",
    ],
    "manager": [
        "slack_search", "slack_send_message", "slack_get_channel_history",
        "notion_search", "notion_get_page", "notion_update_page", "notion_create_page",
        "gdrive_search", "gdrive_read_file",
        "crm_lookup", "crm_list_deals",
    ],
    "junior": [
        "slack_search", "slack_get_channel_history",
        "notion_search", "notion_get_page",
        "gdrive_search", "gdrive_read_file",
    ],
}

# Map tool name prefix → MCP server module
_TOOL_SERVER_MAP = {
    "slack_":   "src.tools.mcp_slack",
    "notion_":  "src.tools.mcp_notion",
    "gdrive_":  "src.tools.mcp_gdrive",
    "crm_":     "src.tools.mcp_crm",
    "finance_": "src.tools.mcp_finance",
    "hr_":      "src.tools.mcp_finance",  # HR shares finance server for now
}


def get_mcp_client(tool_name: str):
    """Return the MCP server instance that handles this tool."""
    import importlib
    for prefix, module_path in _TOOL_SERVER_MAP.items():
        if tool_name.startswith(prefix):
            mod = importlib.import_module(module_path)
            return mod.server
    raise ValueError(f"No MCP server found for tool: {tool_name}")


def tools_for_access_level(access_level: str) -> list[str]:
    return TOOL_PERMISSIONS.get(access_level, TOOL_PERMISSIONS["junior"])


def is_permitted(tool_name: str, access_level: str) -> bool:
    return tool_name in TOOL_PERMISSIONS.get(access_level, [])
