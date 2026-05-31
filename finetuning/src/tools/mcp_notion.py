"""Notion MCP server — search, read, create, update pages."""

from __future__ import annotations

from src.config import settings
from src.tools.base_mcp import BaseMCPServer


class NotionMCPServer(BaseMCPServer):
    name = "notion"

    def _get_client(self):
        from notion_client import Client
        return Client(auth=settings.notion_token)

    def _dispatch(self, tool_name: str, arguments: dict):
        client = self._get_client()

        if tool_name == "notion_search":
            query = arguments["query"]
            filter_type = arguments.get("filter_type")
            kwargs = {"query": query}
            if filter_type:
                kwargs["filter"] = {"value": filter_type, "property": "object"}
            results = client.search(**kwargs).get("results", [])
            return [
                {
                    "id": r["id"],
                    "title": _extract_title(r),
                    "type": r.get("object"),
                    "url": r.get("url"),
                }
                for r in results[:20]
            ]

        elif tool_name == "notion_get_page":
            page_id = arguments["page_id"]
            page = client.pages.retrieve(page_id=page_id)
            blocks = client.blocks.children.list(block_id=page_id).get("results", [])
            content = _blocks_to_text(blocks)
            return {"id": page_id, "title": _extract_title(page), "content": content[:3000]}

        elif tool_name == "notion_update_page":
            page_id = arguments["page_id"]
            content = arguments["content"]
            client.blocks.children.append(
                block_id=page_id,
                children=[{"object": "block", "type": "paragraph",
                           "paragraph": {"rich_text": [{"type": "text", "text": {"content": content[:2000]}}]}}],
            )
            return {"ok": True, "page_id": page_id}

        elif tool_name == "notion_create_page":
            parent_id = arguments["parent_id"]
            title = arguments["title"]
            content = arguments.get("content", "")
            page = client.pages.create(
                parent={"page_id": parent_id},
                properties={"title": {"title": [{"type": "text", "text": {"content": title}}]}},
                children=[{"object": "block", "type": "paragraph",
                           "paragraph": {"rich_text": [{"type": "text", "text": {"content": content[:2000]}}]}}],
            )
            return {"ok": True, "page_id": page["id"], "url": page.get("url")}

        raise ValueError(f"Unknown Notion tool: {tool_name}")


def _extract_title(obj: dict) -> str:
    props = obj.get("properties", {})
    for key in ("title", "Name", "Title"):
        if key in props:
            items = props[key].get("title", [])
            return "".join(i.get("plain_text", "") for i in items)
    return "(untitled)"


def _blocks_to_text(blocks: list) -> str:
    lines = []
    for block in blocks:
        bt = block.get("type", "")
        content = block.get(bt, {})
        texts = content.get("rich_text", [])
        text = "".join(t.get("plain_text", "") for t in texts)
        if text:
            lines.append(text)
    return "\n".join(lines)


server = NotionMCPServer()
