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


# ── Per-staff ACT surface (scope=daemon_act) ─────────────────────────────────
# These act AS the individual staff member chatting, using their OWN connected
# tool token (resolved server-side). They require the DAEMON ACT TOKEN from the
# system message as `act_token` — a DIFFERENT token from the BRAIN ACCESS TOKEN.
# Unlike the read-only company-Brain tools above, these can see the user's 1:1
# DMs and post as them; anything they surface stays PRIVATE to this user's daemon
# and never enters the shared company Brain.
def _act(tool: str, args: dict | None, act_token: str) -> dict:
    token = (act_token or "").strip()
    if not token:
        return {"error": "no act token — pass the DAEMON ACT TOKEN from your system message as act_token"}
    r = httpx.post(
        f"{API}/api/brain",
        params={"action": "daemon_act"},
        json={"tool": tool, "args": args or {}},
        headers={"Authorization": f"Bearer {token}"},
        timeout=30,
    )
    r.raise_for_status()
    return r.json()


@mcp.tool()
def slack_recent_activity(act_token: str = "") -> str:
    """Recent activity across the user's OWN Slack — their channels, group DMs,
    and 1:1 DMs — acting as them. Use this for "pull/summarize my recent Slack".
    `act_token`: the DAEMON ACT TOKEN from your system message."""
    return str(_act("slack_recent_activity", {}, act_token))


@mcp.tool()
def slack_channel_history(channel: str, act_token: str = "", limit: int = 30) -> str:
    """Recent messages in one Slack channel or DM (by id), as the user.
    `act_token`: the DAEMON ACT TOKEN from your system message."""
    return str(_act("slack_channel_history", {"channel": channel, "limit": limit}, act_token))


@mcp.tool()
def slack_find_message(query: str, act_token: str = "") -> str:
    """Search the user's Slack messages (acts as them, their visibility).
    `act_token`: the DAEMON ACT TOKEN from your system message."""
    return str(_act("slack_find_message", {"query": query}, act_token))


@mcp.tool()
def slack_list_channels(act_token: str = "") -> str:
    """List Slack channels the user can see.
    `act_token`: the DAEMON ACT TOKEN from your system message."""
    return str(_act("slack_list_channels", {}, act_token))


@mcp.tool()
def slack_send_channel_message(channel: str, text: str, act_token: str = "") -> str:
    """Post a message to a Slack channel AS the user. Confirm intent first.
    `act_token`: the DAEMON ACT TOKEN from your system message."""
    return str(_act("slack_send_channel_message", {"channel": channel, "text": text}, act_token))


@mcp.tool()
def slack_send_direct_message(user: str, text: str, act_token: str = "") -> str:
    """Send a Slack DM to `user` (id) AS the user. Confirm intent first.
    `act_token`: the DAEMON ACT TOKEN from your system message."""
    return str(_act("slack_send_direct_message", {"user": user, "text": text}, act_token))


@mcp.tool()
def log_commitment(text: str, act_token: str = "", source: str = "dm") -> str:
    """Record a commitment, deadline, or ask the user is involved in (seen in a
    DM or chat) to their PRIVATE daemon memory — e.g. "I asked Sam for the Q3
    numbers by Friday". Private to this user's daemon; never enters the company
    Brain. `act_token`: the DAEMON ACT TOKEN from your system message."""
    return str(_act("log_commitment", {"text": text, "source": source}, act_token))


if __name__ == "__main__":
    mcp.run()
