"""
CRM MCP server — HubSpot adapter (swappable for Salesforce/Pipedrive).

Provides: deal lookup, deal update, pipeline listing.
"""

from __future__ import annotations

import os

import httpx

from src.tools.base_mcp import BaseMCPServer


class CRMMCPServer(BaseMCPServer):
    name = "crm"

    _BASE = "https://api.hubapi.com"

    def _headers(self) -> dict:
        token = os.environ.get("HUBSPOT_ACCESS_TOKEN", "")
        return {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}

    def _dispatch(self, tool_name: str, arguments: dict):

        if tool_name == "crm_lookup":
            client_name = arguments["client"]
            resp = httpx.get(
                f"{self._BASE}/crm/v3/objects/deals/search",
                headers=self._headers(),
                json={
                    "filterGroups": [{"filters": [
                        {"propertyName": "dealname", "operator": "CONTAINS_TOKEN", "value": client_name}
                    ]}],
                    "properties": ["dealname", "dealstage", "amount", "closedate", "hs_lastmodifieddate"],
                    "limit": 10,
                },
                timeout=10.0,
            )
            resp.raise_for_status()
            deals = resp.json().get("results", [])
            return [
                {
                    "name":     d["properties"].get("dealname"),
                    "stage":    d["properties"].get("dealstage"),
                    "amount":   d["properties"].get("amount"),
                    "close":    d["properties"].get("closedate"),
                    "modified": d["properties"].get("hs_lastmodifieddate"),
                }
                for d in deals
            ]

        elif tool_name == "crm_list_deals":
            stage = arguments.get("stage")
            filters = []
            if stage:
                filters.append({"propertyName": "dealstage", "operator": "EQ", "value": stage})
            resp = httpx.post(
                f"{self._BASE}/crm/v3/objects/deals/search",
                headers=self._headers(),
                json={
                    "filterGroups": [{"filters": filters}] if filters else [],
                    "properties": ["dealname", "dealstage", "amount", "closedate"],
                    "limit": 20,
                },
                timeout=10.0,
            )
            resp.raise_for_status()
            return resp.json().get("results", [])

        elif tool_name == "crm_update_deal":
            deal_id = arguments["deal_id"]
            properties = arguments.get("properties", {})
            resp = httpx.patch(
                f"{self._BASE}/crm/v3/objects/deals/{deal_id}",
                headers=self._headers(),
                json={"properties": properties},
                timeout=10.0,
            )
            resp.raise_for_status()
            return {"ok": True, "deal_id": deal_id}

        raise ValueError(f"Unknown CRM tool: {tool_name}")


server = CRMMCPServer()
