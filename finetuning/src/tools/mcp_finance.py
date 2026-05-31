"""
Finance + HR MCP server — QuickBooks-first, HR signals from interactions.

Finance: cash flow, invoice list, expense summary.
HR: headcount, performance signals, wellbeing alerts (aggregated, not individual).
"""

from __future__ import annotations

import os

import httpx

from src.tools.base_mcp import BaseMCPServer


class FinanceMCPServer(BaseMCPServer):
    name = "finance"

    _QB_BASE = "https://sandbox-quickbooks.api.intuit.com/v3/company"

    def _headers(self) -> dict:
        token = os.environ.get("QUICKBOOKS_ACCESS_TOKEN", "")
        realm = os.environ.get("QUICKBOOKS_REALM_ID", "")
        return {
            "Authorization": f"Bearer {token}",
            "Accept": "application/json",
            "X-Realm-Id": realm,
        }

    def _dispatch(self, tool_name: str, arguments: dict):

        if tool_name == "finance_summary":
            realm = os.environ.get("QUICKBOOKS_REALM_ID", "")
            resp = httpx.get(
                f"{self._QB_BASE}/{realm}/reports/ProfitAndLoss",
                headers=self._headers(),
                params={"summarize_column_by": "Month"},
                timeout=15.0,
            )
            resp.raise_for_status()
            return {"report": "ProfitAndLoss", "data": resp.json()}

        elif tool_name == "finance_invoices":
            status = arguments.get("status", "Unpaid")
            realm = os.environ.get("QUICKBOOKS_REALM_ID", "")
            resp = httpx.get(
                f"{self._QB_BASE}/{realm}/query",
                headers=self._headers(),
                params={"query": f"select * from Invoice where Balance > '0' MAXRESULTS 20"},
                timeout=10.0,
            )
            resp.raise_for_status()
            invoices = resp.json().get("QueryResponse", {}).get("Invoice", [])
            return [
                {
                    "id":       inv["Id"],
                    "customer": inv.get("CustomerRef", {}).get("name"),
                    "balance":  inv.get("Balance"),
                    "due":      inv.get("DueDate"),
                }
                for inv in invoices
            ]

        elif tool_name == "finance_cashflow":
            realm = os.environ.get("QUICKBOOKS_REALM_ID", "")
            resp = httpx.get(
                f"{self._QB_BASE}/{realm}/reports/CashFlow",
                headers=self._headers(),
                timeout=15.0,
            )
            resp.raise_for_status()
            return {"report": "CashFlow", "data": resp.json()}

        # ── HR tools (aggregated signals, never raw individual data) ──────────

        elif tool_name == "hr_headcount":
            db_url = os.environ.get("DATABASE_URL", "")
            company_id = arguments.get("company_id", "")
            import psycopg2
            conn = psycopg2.connect(db_url)
            cur = conn.cursor()
            cur.execute(
                "select access_level, count(*) from staff where company_id=%s and status='active' group by 1",
                (company_id,)
            )
            rows = cur.fetchall()
            conn.close()
            return {"headcount": {row[0]: row[1] for row in rows}}

        elif tool_name == "hr_performance":
            return {"note": "Aggregated performance data — connect BambooHR/Workday for live signals."}

        elif tool_name == "hr_alerts":
            return {"note": "HR wellbeing alerts — aggregated patterns from interaction sentiment analysis."}

        raise ValueError(f"Unknown Finance/HR tool: {tool_name}")


server = FinanceMCPServer()
