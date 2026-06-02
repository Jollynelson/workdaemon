import { getAccessToken } from '../oauth.js';

// ── Slack connector — authed Web API calls with a workspace's bot token ───────
async function slackApi(token, method, params = {}) {
  const r = await fetch(`https://slack.com/api/${method}`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(params),
  });
  const d = await r.json();
  if (!d.ok) throw new Error(`slack ${method}: ${d.error}`);
  return d;
}

// List public channels (the first real read — proves the connection works and
// gives the daemon a map of the company's Slack workspace).
export async function listChannels(token, { limit = 100 } = {}) {
  const d = await slackApi(token, 'conversations.list', {
    types: 'public_channel', exclude_archived: 'true', limit: String(limit),
  });
  return (d.channels || []).map(c => ({ id: c.id, name: c.name, members: c.num_members, topic: c.topic?.value || '' }));
}

// Recent messages from a channel (text only) — used to ground daemon answers.
export async function channelHistory(token, channelId, { limit = 30 } = {}) {
  const d = await slackApi(token, 'conversations.history', { channel: channelId, limit: String(limit) });
  return (d.messages || []).filter(m => m.type === 'message' && m.text).map(m => ({ ts: m.ts, user: m.user, text: m.text }));
}

// Convenience: load the workspace's token and run a read in one call.
export async function withSlack(db, workspaceId, fn) {
  const token = await getAccessToken(db, workspaceId, 'slack');
  if (!token) return null;
  return fn(token);
}
