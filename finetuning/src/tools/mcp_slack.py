"""Slack MCP server — read + send via Slack Web API."""

from __future__ import annotations

from src.config import settings
from src.tools.base_mcp import BaseMCPServer


class SlackMCPServer(BaseMCPServer):
    name = "slack"

    def _get_client(self):
        from slack_sdk import WebClient
        return WebClient(token=settings.slack_bot_token)

    def _dispatch(self, tool_name: str, arguments: dict):
        client = self._get_client()

        if tool_name == "slack_search":
            query = arguments["query"]
            result = client.search_messages(query=query, count=20)
            messages = result.get("messages", {}).get("matches", [])
            return [
                {
                    "text": m.get("text", "")[:300],
                    "user": m.get("username", "unknown"),
                    "channel": m.get("channel", {}).get("name", ""),
                    "timestamp": m.get("ts", ""),
                }
                for m in messages
            ]

        elif tool_name == "slack_get_channel_history":
            channel = arguments["channel"]
            limit = int(arguments.get("limit", 50))
            result = client.conversations_history(channel=channel, limit=limit)
            msgs = result.get("messages", [])
            return [
                {"text": m.get("text", "")[:300], "user": m.get("user", ""), "ts": m.get("ts", "")}
                for m in msgs
            ]

        elif tool_name == "slack_send_message":
            client.chat_postMessage(
                channel=arguments["channel"],
                text=arguments["message"],
            )
            return {"ok": True, "channel": arguments["channel"]}

        raise ValueError(f"Unknown Slack tool: {tool_name}")


server = SlackMCPServer()
