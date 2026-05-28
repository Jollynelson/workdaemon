// WorkDaemon — MCP Adapter
// Bridges Daemon tool calls → OpenClaw's MCP runtime
//
// OpenClaw handles MCP server connections, auth, and protocol.
// WorkDaemon calls through this adapter — never talks to MCP directly.
//
// Two modes:
//   1. Native MCP  — OpenClaw's MCP client (production)
//   2. Direct API  — fallback when MCP server not available (dev/testing)

import type { MCPCallParams, MCPCallResult } from './types.js';

export class MCPAdapter {
  private mcp_servers: Map<string, string>;  // name → server URL
  private mode: 'mcp' | 'direct';

  constructor() {
    // Register all available MCP servers
    // These come from OpenClaw's connector config
    this.mcp_servers = new Map([
      ['gmail',    'https://gmailmcp.googleapis.com/mcp/v1'],
      ['calendar', 'https://calendarmcp.googleapis.com/mcp/v1'],
      ['notion',   process.env.NOTION_MCP_URL ?? ''],     // Notion MCP if running
      ['slack',    process.env.SLACK_MCP_URL  ?? ''],
    ]);

    // Use native MCP if OpenClaw runtime is available
    // Fall back to direct API calls in dev
    this.mode = process.env.USE_MCP === 'true' ? 'mcp' : 'direct';

    console.log(`[MCP] Mode: ${this.mode}`);
  }

  // ── Call any MCP tool ────────────────────────────────────────────────────
  async call(params: MCPCallParams): Promise<MCPCallResult> {
    if (this.mode === 'mcp') {
      return this.call_via_mcp(params);
    }
    // In direct mode, the individual tool classes handle the call
    // This adapter returns a pass-through signal
    return { ok: true, result: { mode: 'direct' } };
  }

  // ── Call via OpenClaw's MCP runtime ─────────────────────────────────────
  // OpenClaw exposes an internal RPC endpoint for tool calls
  // This is the integration point with the forked OpenClaw codebase
  private async call_via_mcp(params: MCPCallParams): Promise<MCPCallResult> {
    const server_url = this.mcp_servers.get(params.server);

    if (!server_url) {
      console.warn(`[MCP] Server not registered: ${params.server}`);
      return {
        ok:     false,
        result: null,
        error:  `MCP server not found: ${params.server}`,
      };
    }

    try {
      // OpenClaw's MCP client handles auth tokens, OAuth, retries
      // In the forked codebase this calls:
      // openclaw.mcp.call(server_url, params.tool, params.params)
      //
      // For now we POST directly to the MCP endpoint
      const response = await fetch(`${server_url}/tools/${params.tool}`, {
        method:  'POST',
        headers: {
          'Content-Type':  'application/json',
          'Authorization': `Bearer ${process.env.MCP_AUTH_TOKEN ?? ''}`,
        },
        body: JSON.stringify(params.params),
      });

      if (!response.ok) {
        throw new Error(`MCP call failed: ${response.status} ${response.statusText}`);
      }

      const result = await response.json();
      return { ok: true, result };

    } catch (err) {
      console.error(`[MCP] Call failed (${params.server}.${params.tool}):`, err);
      return {
        ok:     false,
        result: null,
        error:  String(err),
      };
    }
  }

  // ── Check if a specific MCP server is available ──────────────────────────
  is_available(server: string): boolean {
    const url = this.mcp_servers.get(server);
    return Boolean(url && url.length > 0);
  }
}
