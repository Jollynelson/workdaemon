"""Google Drive MCP server — search and read files."""

from __future__ import annotations

import json

from src.config import settings
from src.tools.base_mcp import BaseMCPServer


class GDriveMCPServer(BaseMCPServer):
    name = "gdrive"

    def _get_service(self):
        from google.oauth2.service_account import Credentials
        from googleapiclient.discovery import build

        key_data = json.loads(settings.google_service_account_key or "{}")
        creds = Credentials.from_service_account_info(
            key_data,
            scopes=["https://www.googleapis.com/auth/drive.readonly"],
        )
        return build("drive", "v3", credentials=creds)

    def _dispatch(self, tool_name: str, arguments: dict):
        service = self._get_service()

        if tool_name == "gdrive_search":
            query = arguments["query"]
            results = service.files().list(
                q=f"fullText contains '{query}' and trashed=false",
                pageSize=20,
                fields="files(id,name,mimeType,webViewLink,modifiedTime)",
            ).execute()
            files = results.get("files", [])
            return [
                {"id": f["id"], "name": f["name"], "type": f.get("mimeType", ""), "url": f.get("webViewLink")}
                for f in files
            ]

        elif tool_name == "gdrive_read_file":
            file_id = arguments["file_id"]
            # Export Google Docs as plain text
            content = service.files().export(
                fileId=file_id, mimeType="text/plain"
            ).execute()
            return {"content": content.decode("utf-8")[:3000] if isinstance(content, bytes) else str(content)[:3000]}

        raise ValueError(f"Unknown GDrive tool: {tool_name}")


server = GDriveMCPServer()
