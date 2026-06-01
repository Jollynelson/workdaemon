"""Real MCP-style tool handlers for Notion + Slack, per company.

Each company connects its OWN Notion/Slack workspace (OAuth) → we store that
company's access token encrypted. These handlers use THAT company's token to read
(always) and write (drafted-for-confirm unless autonomy granted). The agent
runtime registers only the tools the staff member's role permits.

Read vs write:
- read tools (search/get/list) run immediately.
- write tools (post/create/update) are gated: by default they DRAFT the action and
  return it for human confirmation rather than executing. Set autonomy=True (per
  company policy) to let them execute directly.
"""

from __future__ import annotations

from typing import Any, Callable

import httpx

from src.db import CompanyDB
from src.integrations.store import IntegrationStore


# ── Notion ──────────────────────────────────────────────────────────────────────
def _notion_handlers(token: str, autonomy: bool) -> dict[str, Callable[[dict], Any]]:
    h = {"Authorization": f"Bearer {token}", "Notion-Version": "2022-06-28",
         "Content-Type": "application/json"}

    def search(args: dict) -> Any:
        r = httpx.post("https://api.notion.com/v1/search", headers=h,
                       json={"query": args.get("query", "")}, timeout=30)
        r.raise_for_status()
        return [{"id": x.get("id"), "title": _notion_title(x)}
                for x in r.json().get("results", [])[:10]]

    def get_page(args: dict) -> Any:
        pid = args["page_id"]
        r = httpx.get(f"https://api.notion.com/v1/blocks/{pid}/children", headers=h, timeout=30)
        r.raise_for_status()
        return r.json().get("results", [])

    def create_page(args: dict) -> Any:
        if not autonomy:
            return {"drafted": True, "action": "notion_create_page", "args": args,
                    "note": "Confirm to create this Notion page."}
        r = httpx.post("https://api.notion.com/v1/pages", headers=h, json={
            "parent": {"page_id": args["parent_id"]},
            "properties": {"title": [{"text": {"content": args.get("title", "Untitled")}}]},
        }, timeout=30)
        r.raise_for_status()
        return {"created": r.json().get("id")}

    return {"notion_search": search, "notion_get_page": get_page,
            "notion_create_page": create_page}


def _notion_title(result: dict) -> str:
    for v in (result.get("properties") or {}).values():
        if v.get("type") == "title":
            return "".join(t.get("plain_text", "") for t in v.get("title", []))
    return result.get("id", "")


# ── Slack ───────────────────────────────────────────────────────────────────────
def _slack_handlers(token: str, autonomy: bool) -> dict[str, Callable[[dict], Any]]:
    h = {"Authorization": f"Bearer {token}"}

    def search(args: dict) -> Any:
        r = httpx.get("https://slack.com/api/search.messages", headers=h,
                      params={"query": args.get("query", "")}, timeout=30)
        data = r.json()
        return [{"text": m.get("text"), "channel": m.get("channel", {}).get("name")}
                for m in data.get("messages", {}).get("matches", [])[:10]]

    def channel_history(args: dict) -> Any:
        r = httpx.get("https://slack.com/api/conversations.history", headers=h,
                      params={"channel": args["channel"], "limit": args.get("limit", 30)}, timeout=30)
        return [{"text": m.get("text"), "user": m.get("user")}
                for m in r.json().get("messages", [])]

    def post_message(args: dict) -> Any:
        if not autonomy:
            return {"drafted": True, "action": "slack_post_message", "args": args,
                    "note": "Confirm to send this Slack message."}
        r = httpx.post("https://slack.com/api/chat.postMessage",
                       headers={**h, "Content-Type": "application/json"},
                       json={"channel": args["channel"], "text": args["message"]}, timeout=30)
        return {"ok": r.json().get("ok"), "ts": r.json().get("ts")}

    return {"slack_search": search, "slack_get_channel_history": channel_history,
            "slack_post_message": post_message}


# tool-name → which integration provider supplies it
_PROVIDER_TOOLS = {
    "notion": ("notion", _notion_handlers),
    "slack": ("slack", _slack_handlers),
}


def register_company_tools(executor, company_id: str, autonomy: bool = False, store=None) -> None:
    """Register real handlers on the executor for whatever this company has connected
    AND the staff member is permitted to use. Permission is enforced by the executor;
    here we only wire handlers for connected + available providers. `store` is
    injectable for tests."""
    store = store or IntegrationStore(CompanyDB(company_id))
    for provider, (_, build) in _PROVIDER_TOOLS.items():
        integ = store.get(provider)
        if integ is None or not integ.access_token:
            continue
        for tool_name, fn in build(integ.access_token, autonomy).items():
            # only register if the permission map allows this tool family for the role
            base = tool_name.split("_")[0]   # notion_search -> notion
            if _allowed(executor, base):
                executor.register(tool_name, fn)


def _allowed(executor, tool: str) -> bool:
    from src.agents.tool_permissions import can_use
    return can_use(executor._access_level, tool)
