"""
Company Brain as an MCP server (stage 5).

Exposes WorkDaemon's always-on Brain — hunt findings, cross-staff patterns,
cross-daemon events, company knowledge — as MCP tools, so EVERY staff member's
Hermes agent can PULL company truth on demand. The Brain stays the goal-driven
entity (hunting threats/waste/opportunities/performance/knowledge, online and
in-company, always improving); the agents are its fingertips.

Run it reachable by the Hermes runtime, then on each profile:
    hermes -p <staff> mcp add brain --url <this-server-url> --auth header

Env:
    WORKDAEMON_API_BASE   e.g. https://app.workdaemon.com
    BRAIN_MCP_TOKEN       a workspace-scoped service token /api/brain accepts
    WORKSPACE_ID          the company this Brain server serves

Deps: `pip install "mcp[cli]" httpx`. Endpoints below mirror the existing
/api/brain surface (tab=hunt etc.); add a thin read endpoint if a tool needs one.
Deployable scaffolding — verify against the live /api/brain at deploy time.
"""
import os

import httpx
from mcp.server.fastmcp import FastMCP

API = os.environ.get("WORKDAEMON_API_BASE", "https://app.workdaemon.com").rstrip("/")
TOKEN = os.environ.get("BRAIN_MCP_TOKEN", "")
WORKSPACE_ID = os.environ.get("WORKSPACE_ID", "")

mcp = FastMCP("company-brain")


def _get(path: str, params: dict | None = None) -> dict:
    r = httpx.get(
        f"{API}{path}",
        params=params or {},
        headers={"Authorization": f"Bearer {TOKEN}", "X-Workspace-Id": WORKSPACE_ID},
        timeout=20,
    )
    r.raise_for_status()
    return r.json()


@mcp.tool()
def list_hunt_findings() -> str:
    """Open Company-Brain hunt findings: threats, waste, opportunities,
    performance signals, and knowledge gaps the Brain is tracking right now."""
    return str(_get("/api/brain", {"tab": "hunt"}))


@mcp.tool()
def company_context() -> str:
    """The company's core context the Brain holds (industry, profile, knowledge graph
    summary) — ground answers in this before reasoning."""
    return str(_get("/api/brain"))


@mcp.tool()
def search_knowledge(query: str) -> str:
    """Search the Company Brain's indexed knowledge for facts relevant to `query`,
    with source attribution."""
    return str(_get("/api/brain", {"q": query}))


if __name__ == "__main__":
    mcp.run()
