"""
Company Brain as an MCP server (stage 5).

Exposes WorkDaemon's always-on Brain — hunt findings, cross-staff patterns,
cross-daemon events, company knowledge — as MCP tools, so EVERY staff member's
Hermes agent can PULL company truth on demand. The Brain stays the goal-driven
entity (hunting threats/waste/opportunities/performance/knowledge, online and
in-company, always improving); the agents are its fingertips.

Runs as a LOCAL stdio subprocess inside the Hermes gateway container (not an
internet-exposed server), wired on the serving profile via:
    hermes mcp add brain --command python --args /root/hermes/brain_mcp.py --auth none
The token never leaves the container; the tool surface is read-only and bound to
ONE workspace server-side, so there is no public attack surface.

Env (from the Modal `hermes-<company>` secret):
    WORKDAEMON_API_BASE   e.g. https://app.workdaemon.com  (the live Vercel API)
    BRAIN_MCP_TOKEN       read-only service token /api/brain?action=mcp accepts.
                          The API binds it to BRAIN_MCP_WORKSPACE_ID — this client
                          never sends a workspace id, so it can only read its own.

Deps: `pip install "mcp[cli]" httpx` (installed into the Modal image).
"""
import os

import httpx
from mcp.server.fastmcp import FastMCP

API = os.environ.get("WORKDAEMON_API_BASE", "https://app.workdaemon.com").rstrip("/")
TOKEN = os.environ.get("BRAIN_MCP_TOKEN", "")

mcp = FastMCP("company-brain")


def _mcp_get(tool: str, params: dict | None = None) -> dict:
    r = httpx.get(
        f"{API}/api/brain",
        params={"action": "mcp", "tool": tool, **(params or {})},
        headers={"Authorization": f"Bearer {TOKEN}"},
        timeout=20,
    )
    r.raise_for_status()
    return r.json()


@mcp.tool()
def list_hunt_findings() -> str:
    """Open Company-Brain hunt findings: threats, waste, opportunities,
    performance signals, and knowledge gaps the Brain is tracking right now."""
    return str(_mcp_get("hunt"))


@mcp.tool()
def company_context() -> str:
    """The company's core context the Brain holds (industry, profile, knowledge graph
    summary) — ground answers in this before reasoning."""
    return str(_mcp_get("context"))


@mcp.tool()
def search_knowledge(query: str) -> str:
    """Search the Company Brain's indexed knowledge for facts relevant to `query`,
    with source attribution."""
    return str(_mcp_get("search", {"q": query}))


if __name__ == "__main__":
    mcp.run()
