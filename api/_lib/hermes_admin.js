// WorkDaemon → Hermes runtime admin (stages 3 + 4). Calls the per-company Modal
// admin endpoint (hermes/modal_app.py) to PROVISION a staff member's Hermes
// profile and CONNECT a tool as an MCP server (the agent then acts on it itself —
// no executor). Entirely INERT unless the workspace has a Hermes integration row,
// so it never affects non-Hermes workspaces.
//
// Workspace Hermes config lives in workspace_integrations (provider='hermes'):
//   access_token = the admin token (encrypted)
//   metadata     = { admin_url, gateway_url, model_provider, model }
import { decryptSecret } from './security.js';
import { getFreshAccessToken } from './oauth.js';

// Minimal SOUL.md stub — the FULL identity/output-contract/tools come from the
// system message api/chat.js sends on every Hermes request, so the on-disk SOUL
// only needs to defer to it.
const SOUL_STUB = 'You are a WorkDaemon daemon — a per-staff agent. On every turn follow the system message (your full identity, output contract, and connected tools) exactly. Output one JSON object and nothing else.';

// oauth provider → MCP server spec. Connecting a tool in WorkDaemon adds the
// matching MCP server to that staff's Hermes profile. `tokenEnv(token)` maps the
// connected OAuth token to the env vars that server expects, so the agent acts
// AS the connecting user within the scopes they granted (the Zapier model).
const MCP_FOR = {
  github:    { name: 'github', command: 'npx', args: ['-y', '@modelcontextprotocol/server-github'], tokenEnv: t => ({ GITHUB_PERSONAL_ACCESS_TOKEN: t }) },
  notion:    { name: 'notion', command: 'npx', args: ['-y', '@notionhq/notion-mcp-server'],          tokenEnv: t => ({ NOTION_TOKEN: t }) },
  slack:     { name: 'slack',  command: 'npx', args: ['-y', '@modelcontextprotocol/server-slack'],   tokenEnv: t => ({ SLACK_BOT_TOKEN: t }) },
  google:    { name: 'gdrive', command: 'npx', args: ['-y', '@modelcontextprotocol/server-gdrive'] },
  atlassian: { name: 'jira',   command: 'npx', args: ['-y', 'mcp-atlassian'] },
};

export async function hermesConfig(db, workspaceId) {
  const { data } = await db.from('workspace_integrations')
    .select('access_token, metadata, status')
    .eq('workspace_id', workspaceId).eq('provider', 'hermes').maybeSingle();
  if (!data || data.status !== 'connected' || !data.access_token) return null;
  const m = data.metadata || {};
  if (!m.admin_url || !/^https:\/\//.test(m.admin_url)) return null;   // https-only
  return {
    adminUrl: m.admin_url,
    token: decryptSecret(data.access_token),
    provider: m.model_provider || 'anthropic',
    model: m.model || 'claude-sonnet-4-6',
  };
}

async function callAdmin(cfg, body) {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), 30000);
  try {
    const r = await fetch(cfg.adminUrl, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: cfg.token, ...body }), signal: ac.signal,
    });
    const d = await r.json().catch(() => ({}));
    if (!r.ok || d.ok === false) throw new Error(d.error || `hermes admin ${r.status}`);
    return d;
  } finally { clearTimeout(t); }
}

// Stage 3 — provision a staff member's Hermes profile (profile + SOUL + model).
export async function provisionStaff(db, workspaceId, { staffId, soulMd } = {}) {
  const cfg = await hermesConfig(db, workspaceId);
  if (!cfg) return { skipped: 'no-hermes' };
  return callAdmin(cfg, {
    action: 'provision', staff_id: staffId, soul_md: soulMd || SOUL_STUB,
    provider: cfg.provider, model: cfg.model,
  });
}

// Stage 4 — connect a tool = add its MCP server to the staff's profile, carrying
// the connecting user's OAuth token so the agent acts within their granted scopes.
export async function connectTool(db, workspaceId, { staffId, provider } = {}) {
  const cfg = await hermesConfig(db, workspaceId);
  if (!cfg) return { skipped: 'no-hermes' };
  const spec = MCP_FOR[provider];
  if (!spec) return { skipped: `no-mcp-for-${provider}` };
  // Forward the freshly-refreshed connected token as the env the MCP server reads.
  let env = null;
  if (spec.tokenEnv) {
    const token = await getFreshAccessToken(db, workspaceId, provider);
    if (!token) return { skipped: `no-token-for-${provider}` };
    env = spec.tokenEnv(token);
  }
  return callAdmin(cfg, {
    action: 'connect', staff_id: staffId,
    name: spec.name, command: spec.command, args: spec.args, url: spec.url || null,
    env, auth: spec.url ? 'oauth' : null,
  });
}
