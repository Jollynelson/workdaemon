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

TWO AUTH MODES (the API binds the workspace from the token either way — the
client NEVER chooses a workspace, so cross-tenant reads are impossible):
  • DEDICATED gateway (Cobalt): a static BRAIN_MCP_TOKEN env bound server-side
    to one workspace. Tools need no token parameter.
  • SHARED gateway (platform default): no env token. The WorkDaemon proxy mints
    a SHORT-LIVED signed token per turn (scope=brain_mcp + workspace_id + exp,
    HMAC) and places it in the agent's system message; the agent passes it as
    each tool's `access_token` parameter. A forged/expired/foreign token gets
    401 from the API. Worst-case leak = ~15 min of read access to the SAME
    workspace the caller already belongs to.

Env (from the Modal `hermes-<company>` secret):
    WORKDAEMON_API_BASE   e.g. https://app.workdaemon.com  (the live Vercel API)
    BRAIN_MCP_TOKEN       optional — dedicated-gateway static token.

Deps: `pip install "mcp[cli]" httpx` (installed into the Modal image).
"""
import os

import httpx
from mcp.server.fastmcp import FastMCP

API = os.environ.get("WORKDAEMON_API_BASE", "https://app.workdaemon.com").rstrip("/")
TOKEN = os.environ.get("BRAIN_MCP_TOKEN", "")

mcp = FastMCP("company-brain")


def _mcp_get(tool: str, params: dict | None = None, access_token: str = "") -> dict:
    token = (access_token or TOKEN).strip()
    if not token:
        return {"error": "no brain access token — pass the BRAIN ACCESS TOKEN from your system message as access_token"}
    r = httpx.get(
        f"{API}/api/brain",
        params={"action": "mcp", "tool": tool, **(params or {})},
        headers={"Authorization": f"Bearer {token}"},
        timeout=20,
    )
    r.raise_for_status()
    return r.json()


@mcp.tool()
def list_hunt_findings(access_token: str = "") -> str:
    """Open Company-Brain hunt findings: threats, waste, opportunities,
    performance signals, and knowledge gaps the Brain is tracking right now.
    `access_token`: the BRAIN ACCESS TOKEN from your system message (omit only
    on a dedicated gateway)."""
    return str(_mcp_get("hunt", access_token=access_token))


@mcp.tool()
def company_context(access_token: str = "") -> str:
    """The company's core context the Brain holds (industry, profile, knowledge graph
    summary) — ground answers in this before reasoning.
    `access_token`: the BRAIN ACCESS TOKEN from your system message (omit only
    on a dedicated gateway)."""
    return str(_mcp_get("context", access_token=access_token))


@mcp.tool()
def search_knowledge(query: str, access_token: str = "") -> str:
    """Search the Company Brain's indexed knowledge for facts relevant to `query`,
    with source attribution.
    `access_token`: the BRAIN ACCESS TOKEN from your system message (omit only
    on a dedicated gateway)."""
    return str(_mcp_get("search", {"q": query}, access_token=access_token))


if __name__ == "__main__":
    mcp.run()
