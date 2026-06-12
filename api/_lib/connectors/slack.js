import { getAccessToken, getUserToken, getUserTokens } from '../oauth.js';
import { upsertDocuments } from '../ingestion.js';

// ── Ingestion: fold Slack activity into the document store ────────────────────
// Slack messages arrive via the events webhook into `slack_messages` (seeded for
// the demo). This folds them into per-channel documents so the daemon can ground
// answers on conversations via unified retrieval. Reads the local store — no live
// API token needed (works even when only the webhook feed is configured).
// Pull the channels a TOKEN can see (user token → that staff's channels incl.
// private; bot token → channels the bot is in). Private/mpim → scoped to members.
async function _pullViaToken(token, userOf) {
  let convos = [];
  try {
    // Channels + group DMs the token can see. 1:1 DMs ('im') are deliberately
    // EXCLUDED — personal DMs don't belong in the shared company brain.
    convos = (await slackApi(token, 'users.conversations', { types: 'public_channel,private_channel,mpim', exclude_archived: 'true', limit: 100 })).channels || [];
  } catch { return []; }
  const out = [];
  for (const ch of convos) {
    try {
      const msgs = await channelHistory(token, ch.id, { limit: 100 });
      if (!msgs.length) continue;
      const lines = msgs.slice().reverse().map(m => `${m.user || 'user'}: ${m.text}`);

      // Thread replies — pull the top few threaded messages so decisions buried in
      // threads are captured (same visibility as the channel).
      try {
        const threaded = msgs.filter(m => m.reply_count || m.thread_ts).slice(0, 5);
        for (const t of threaded) {
          const replies = await slackApi(token, 'conversations.replies', { channel: ch.id, ts: t.thread_ts || t.ts, limit: 20 })
            .then(d => d.messages || []).catch(() => []);
          for (const rm of replies.slice(1)) if (rm.text) lines.push(`  ↳ ${rm.user || 'user'}: ${rm.text}`);
        }
      } catch {}
      // Pinned messages.
      try {
        const pins = await slackApi(token, 'pins.list', { channel: ch.id }).then(d => d.items || []).catch(() => []);
        for (const p of pins) if (p.message?.text) lines.push(`📌 pinned: ${p.message.text}`);
      } catch {}
      // File titles shared in the channel.
      try {
        const files = await slackApi(token, 'files.list', { channel: ch.id, count: 20 }).then(d => d.files || []).catch(() => []);
        const names = files.map(f => f.title || f.name).filter(Boolean);
        if (names.length) lines.push(`Files: ${names.join(', ')}`);
      } catch {}

      let visibility = 'public', allowed = [], memberNames = [];
      if (ch.is_private || ch.is_mpim) {
        visibility = 'restricted';
        const members = (await slackApi(token, 'conversations.members', { channel: ch.id, limit: 200 }).then(d => d.members).catch(() => [])) || [];
        const mapped = members.map(sid => userOf[sid]).filter(Boolean);
        allowed = mapped.map(m => m.user_id);
        memberNames = mapped.map(m => m.real_name).filter(Boolean);
      }
      out.push({ id: ch.id, name: ch.name || ch.id, visibility, lines, allowed, names: memberNames });
    } catch { /* not_in_channel etc. */ }
  }
  return out;
}

export async function ingest(db, workspaceId, botToken) {
  const { data: umap } = await db.from('slack_user_map').select('slack_user_id, user_id, real_name').eq('workspace_id', workspaceId);
  const userOf = Object.fromEntries((umap || []).map(u => [u.slack_user_id, u]));

  // Merge channel docs by stable channel id; union member access across whoever read it.
  const byId = {};
  const merge = (parts) => {
    for (const p of parts) {
      const k = `channel-${p.id}`;
      const e = byId[k] ||= { title: `#${p.name} (Slack)`, content: '', visibility: 'public', allowed: new Set(), names: new Set() };
      if (!e.content) e.content = p.lines.join('\n');
      if (p.visibility === 'restricted') { e.visibility = 'restricted'; p.allowed.forEach(a => e.allowed.add(a)); p.names.forEach(n => e.names.add(n)); }
    }
  };

  // 1. Per-staff: each connected staff's OWN token → their channels (incl. private),
  //    each private channel scoped to its members. This is the "connect your own daemon" path.
  for (const { token } of await getUserTokens(db, workspaceId, 'slack')) merge(await _pullViaToken(token, userOf));
  // 2. Workspace bot token → channels the bot is in (public + any it was invited to).
  if (botToken) merge(await _pullViaToken(botToken, userOf));

  // 3. Fallback: webhook-fed / seeded local store (public), keyed by name.
  if (!Object.keys(byId).length) {
    const { data: stored } = await db.from('slack_messages').select('channel_name, slack_user, text').eq('workspace_id', workspaceId).order('created_at', { ascending: true }).limit(400);
    const byName = {};
    for (const m of (stored || [])) (byName[m.channel_name || 'channel'] ||= []).push(`${m.slack_user || 'user'}: ${m.text}`);
    for (const [name, lines] of Object.entries(byName)) byId[`channel-${name}`] = { title: `#${name} (Slack)`, content: lines.join('\n'), visibility: 'public', allowed: new Set(), names: new Set() };
  }

  const docs = Object.entries(byId).map(([eid, e]) => ({
    external_id: eid, doc_type: 'channel', title: e.title, content: e.content,
    visibility: e.visibility, allowed_users: [...e.allowed],
    metadata: { channel: e.title.replace(/^#| \(Slack\)$/g, ''), member_names: [...e.names] },
  }));
  return upsertDocuments(db, workspaceId, 'slack', docs);
}

// ── Slack connector — full read + action toolset (parity with Zapier's Slack) ──
// Most calls use the workspace BOT token; search/status/profile need the USER token.

async function slackApi(token, method, params = {}, { json = false } = {}) {
  const headers = { authorization: `Bearer ${token}` };
  let body;
  if (json) { headers['content-type'] = 'application/json; charset=utf-8'; body = JSON.stringify(params); }
  else {
    headers['content-type'] = 'application/x-www-form-urlencoded';
    const flat = {};
    for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null) flat[k] = typeof v === 'object' ? JSON.stringify(v) : String(v);
    body = new URLSearchParams(flat);
  }
  // Retry on rate-limit (429 → honour Retry-After) and transient 5xx, with backoff.
  for (let attempt = 0; ; attempt++) {
    const r = await fetch(`https://slack.com/api/${method}`, { method: 'POST', headers, body });
    if ((r.status === 429 || r.status >= 500) && attempt < 4) {
      const retryAfter = Number(r.headers.get('retry-after')) || (2 ** attempt);  // seconds
      await new Promise(res => setTimeout(res, Math.min(retryAfter, 30) * 1000));
      continue;
    }
    const d = await r.json();
    if (!d.ok) {
      // Slack can also signal rate-limit in the body — back off and retry.
      if (d.error === 'ratelimited' && attempt < 4) { await new Promise(res => setTimeout(res, (2 ** attempt) * 1000)); continue; }
      throw new Error(`slack ${method}: ${d.error}`);
    }
    return d;
  }
}

// ── Reads (bot token) ─────────────────────────────────────────────────────────
export const getConversation        = (t, channel)            => slackApi(t, 'conversations.info', { channel }).then(d => d.channel);
export const getConversationMembers  = (t, channel)            => slackApi(t, 'conversations.members', { channel, limit: 200 }).then(d => d.members);
export const getMessagePermalink     = (t, channel, ts)        => slackApi(t, 'chat.getPermalink', { channel, message_ts: ts }).then(d => d.permalink);
export const getMessageReactions     = (t, channel, ts)        => slackApi(t, 'reactions.get', { channel, timestamp: ts }).then(d => d.message);
export const retrieveThreadMessages  = (t, channel, ts, n = 50)=> slackApi(t, 'conversations.replies', { channel, ts, limit: n }).then(d => d.messages || []);
export const findUserByEmail         = (t, email)              => slackApi(t, 'users.lookupByEmail', { email }).then(d => d.user);
export const findUserById            = (t, user)               => slackApi(t, 'users.info', { user }).then(d => d.user);

export async function getMessage(t, channel, ts) {
  const d = await slackApi(t, 'conversations.history', { channel, latest: ts, oldest: ts, inclusive: 1, limit: 1 });
  return (d.messages || [])[0] || null;
}
export const getMessageByTimestamp = getMessage;

export async function listChannels(t, { limit = 200 } = {}) {
  const d = await slackApi(t, 'conversations.list', { types: 'public_channel', exclude_archived: 'true', limit });
  return (d.channels || []).map(c => ({ id: c.id, name: c.name, members: c.num_members, topic: c.topic?.value || '' }));
}
export async function findPublicChannel(t, { id, name }) {
  if (id) return getConversation(t, id);
  const all = await listChannels(t, { limit: 1000 });
  return all.find(c => c.name === String(name).replace(/^#/, '')) || null;
}
export async function channelHistory(t, channel, { limit = 30 } = {}) {
  const d = await slackApi(t, 'conversations.history', { channel, limit });
  return (d.messages || []).filter(m => m.type === 'message' && m.text).map(m => ({ ts: m.ts, user: m.user, text: m.text }));
}
export async function findUserByName(t, realName) {
  const d = await slackApi(t, 'users.list', { limit: 1000 });
  const q = String(realName).toLowerCase();
  return (d.members || []).find(u => (u.real_name || '').toLowerCase() === q || (u.profile?.real_name || '').toLowerCase() === q) || null;
}
export async function findUserByUsername(t, username) {
  const d = await slackApi(t, 'users.list', { limit: 1000 });
  const q = String(username).replace(/^@/, '').toLowerCase();
  return (d.members || []).find(u => (u.name || '').toLowerCase() === q) || null;
}

// ── Search (USER token) ───────────────────────────────────────────────────────
export const findMessage = (userToken, query, n = 20) =>
  slackApi(userToken, 'search.messages', { query, count: n }).then(d => d.messages?.matches || []);

// ── Actions (bot token) ───────────────────────────────────────────────────────
export async function sendChannelMessage(t, { channel, text, blocks, thread_ts, post_at }) {
  if (post_at) return slackApi(t, 'chat.scheduleMessage', { channel, text, blocks, thread_ts, post_at }, { json: true });
  return slackApi(t, 'chat.postMessage', { channel, text, blocks, thread_ts }, { json: true });
}
export async function sendDirectMessage(t, { user, text, blocks, post_at }) {
  const open = await slackApi(t, 'conversations.open', { users: user });
  return sendChannelMessage(t, { channel: open.channel.id, text, blocks, post_at });
}
export const editMessage             = (t, { channel, ts, text, blocks }) => slackApi(t, 'chat.update', { channel, ts, text, blocks }, { json: true });
export const deleteMessage           = (t, { channel, ts })               => slackApi(t, 'chat.delete', { channel, ts });
export const cancelScheduledMessage  = (t, { channel, scheduled_message_id }) => slackApi(t, 'chat.deleteScheduledMessage', { channel, scheduled_message_id });
export const addReaction             = (t, { channel, ts, name })         => slackApi(t, 'reactions.add', { channel, timestamp: ts, name });
export const createChannel           = (t, { name, is_private = false })  => slackApi(t, 'conversations.create', { name, is_private }).then(d => d.channel);
export const createPrivateChannel    = (t, { name })                      => createChannel(t, { name, is_private: true });
export const archiveConversation     = (t, channel)                       => slackApi(t, 'conversations.archive', { channel });
export const inviteUserToChannel     = (t, { channel, users })            => slackApi(t, 'conversations.invite', { channel, users: Array.isArray(users) ? users.join(',') : users });
export const removeUserFromChannel   = (t, { channel, user })             => slackApi(t, 'conversations.kick', { channel, user });
export const setChannelTopic         = (t, { channel, topic })            => slackApi(t, 'conversations.setTopic', { channel, topic });
export const createCanvas            = (t, { title, content })            => slackApi(t, 'canvases.create', { title, document_content: { type: 'markdown', markdown: content } }, { json: true });
export const editCanvas              = (t, { canvas_id, changes })        => slackApi(t, 'canvases.edit', { canvas_id, changes }, { json: true });

// ── Actions (USER token) ──────────────────────────────────────────────────────
export const updateProfile = (userToken, { name, title }) => slackApi(userToken, 'users.profile.set', { profile: { real_name: name, title } }, { json: true });
export const setStatus     = (userToken, { text, emoji }) => slackApi(userToken, 'users.profile.set', { profile: { status_text: text || '', status_emoji: emoji || '' } }, { json: true });

// ── Raw escape hatch ──────────────────────────────────────────────────────────
export const apiRequest = (t, method, params = {}) => slackApi(t, method, params);

// ── Tool registry + dispatcher (for the daemon to call tools by name) ─────────
// kind: which token the tool needs. read/action: for permission gating.
export const SLACK_TOOLS = {
  get_conversation:        { kind: 'bot',  type: 'read',   run: (t, a) => getConversation(t, a.channel) },
  get_conversation_members:{ kind: 'bot',  type: 'read',   run: (t, a) => getConversationMembers(t, a.channel) },
  get_message:             { kind: 'bot',  type: 'read',   run: (t, a) => getMessage(t, a.channel, a.ts) },
  get_message_permalink:   { kind: 'bot',  type: 'read',   run: (t, a) => getMessagePermalink(t, a.channel, a.ts) },
  get_message_reactions:   { kind: 'bot',  type: 'read',   run: (t, a) => getMessageReactions(t, a.channel, a.ts) },
  retrieve_thread:         { kind: 'bot',  type: 'read',   run: (t, a) => retrieveThreadMessages(t, a.channel, a.ts) },
  list_channels:           { kind: 'bot',  type: 'read',   run: (t)    => listChannels(t) },
  find_public_channel:     { kind: 'bot',  type: 'read',   run: (t, a) => findPublicChannel(t, a) },
  channel_history:         { kind: 'bot',  type: 'read',   run: (t, a) => channelHistory(t, a.channel) },
  find_user_by_email:      { kind: 'bot',  type: 'read',   run: (t, a) => findUserByEmail(t, a.email) },
  find_user_by_id:         { kind: 'bot',  type: 'read',   run: (t, a) => findUserById(t, a.user) },
  find_user_by_name:       { kind: 'bot',  type: 'read',   run: (t, a) => findUserByName(t, a.name) },
  find_user_by_username:   { kind: 'bot',  type: 'read',   run: (t, a) => findUserByUsername(t, a.username) },
  find_message:            { kind: 'user', type: 'read',   run: (t, a) => findMessage(t, a.query) },
  send_channel_message:    { kind: 'bot',  type: 'action', run: (t, a) => sendChannelMessage(t, a) },
  send_direct_message:     { kind: 'bot',  type: 'action', run: (t, a) => sendDirectMessage(t, a) },
  edit_message:            { kind: 'bot',  type: 'action', run: (t, a) => editMessage(t, a) },
  delete_message:          { kind: 'bot',  type: 'action', run: (t, a) => deleteMessage(t, a) },
  cancel_scheduled_message:{ kind: 'bot',  type: 'action', run: (t, a) => cancelScheduledMessage(t, a) },
  add_reaction:            { kind: 'bot',  type: 'action', run: (t, a) => addReaction(t, a) },
  create_channel:          { kind: 'bot',  type: 'action', run: (t, a) => createChannel(t, a) },
  create_private_channel:  { kind: 'bot',  type: 'action', run: (t, a) => createPrivateChannel(t, a) },
  archive_conversation:    { kind: 'bot',  type: 'action', run: (t, a) => archiveConversation(t, a.channel) },
  invite_user_to_channel:  { kind: 'bot',  type: 'action', run: (t, a) => inviteUserToChannel(t, a) },
  remove_user_from_channel:{ kind: 'bot',  type: 'action', run: (t, a) => removeUserFromChannel(t, a) },
  set_channel_topic:       { kind: 'bot',  type: 'action', run: (t, a) => setChannelTopic(t, a) },
  create_canvas:           { kind: 'bot',  type: 'action', run: (t, a) => createCanvas(t, a) },
  edit_canvas:             { kind: 'bot',  type: 'action', run: (t, a) => editCanvas(t, a) },
  update_profile:          { kind: 'user', type: 'action', run: (t, a) => updateProfile(t, a) },
  set_status:              { kind: 'user', type: 'action', run: (t, a) => setStatus(t, a) },
  api_request:             { kind: 'bot',  type: 'action', run: (t, a) => apiRequest(t, a.method, a.params || {}) },
};

// Run a Slack tool by name with the right token loaded from the workspace.
export async function runSlackTool(db, workspaceId, tool, args = {}) {
  const def = SLACK_TOOLS[tool];
  if (!def) throw new Error(`unknown slack tool: ${tool}`);
  const token = await getAccessToken(db, workspaceId, 'slack', def.kind);
  if (!token) throw new Error(def.kind === 'user'
    ? 'Slack user token not available — reconnect Slack granting user scopes.'
    : 'Slack not connected for this workspace.');
  return def.run(token, args);
}

// Convenience for the daemon: load the workspace bot token and run a read.
export async function withSlack(db, workspaceId, fn) {
  const token = await getAccessToken(db, workspaceId, 'slack', 'bot');
  if (!token) return null;
  return fn(token);
}

// ── Per-staff daemon surface — acts AS one staff member via THEIR OWN token ───
// The SHARED Brain never ingests personal DMs (see ingest() above — `im` is
// excluded on purpose). But a staff member's OWN daemon legitimately can: these
// run with that staff's connected user token, so they act AS them and CAN see
// their 1:1 DMs. The raw token is loaded server-side and never leaves the
// building — the gateway only ever holds a short-lived signed capability.

// Pull recent activity across the user's channels + group DMs + 1:1 DMs, acting
// as them. This is what answers "pull my recent Slack activity" — DMs included,
// because it's the user looking at their own Slack through their own daemon.
export async function pullRecentForUser(userToken, { perChannel = 15, maxChannels = 25 } = {}) {
  let convos;
  try {
    convos = (await slackApi(userToken, 'users.conversations', {
      types: 'public_channel,private_channel,mpim,im', exclude_archived: 'true', limit: 100,
    })).channels || [];
  } catch (e) { return { error: 'slack_error', message: e.message, channels: [] }; }
  const out = [];
  for (const ch of convos.slice(0, maxChannels)) {
    try {
      const msgs = await channelHistory(userToken, ch.id, { limit: perChannel });
      if (!msgs.length) continue;
      let label;
      if (ch.is_im) {
        const u = await findUserById(userToken, ch.user).catch(() => null);
        label = `DM with ${u?.real_name || u?.name || ch.user}`;
      } else {
        label = `#${ch.name || ch.id}${ch.is_private ? ' (private)' : ''}${ch.is_mpim ? ' (group DM)' : ''}`;
      }
      out.push({
        id: ch.id, label, is_dm: !!(ch.is_im || ch.is_mpim),
        messages: msgs.slice().reverse().map(m => `${m.user || 'user'}: ${m.text}`),
      });
    } catch { /* not_in_channel / cant_dm_bot etc. */ }
  }
  return { channels: out };
}

// Tools the per-staff daemon may call — ALL executed with the staff's USER
// token, so reads include their DMs and actions post AS them. (`runSlackTool`
// above stays the workspace-token path; this is the per-user "act as them" path.)
export const USER_SLACK_TOOLS = {
  recent_activity:      { type: 'read',   run: (t, a) => pullRecentForUser(t, a || {}) },
  channel_history:      { type: 'read',   run: (t, a) => channelHistory(t, a.channel, { limit: a.limit || 30 }) },
  list_channels:        { type: 'read',   run: (t)    => listChannels(t) },
  find_message:         { type: 'read',   run: (t, a) => findMessage(t, a.query, a.count || 20) },
  find_user_by_name:    { type: 'read',   run: (t, a) => findUserByName(t, a.name) },
  send_channel_message: { type: 'action', run: (t, a) => sendChannelMessage(t, a) },
  send_direct_message:  { type: 'action', run: (t, a) => sendDirectMessage(t, a) },
};

// Run a per-staff Slack tool with the requesting staff's OWN token. Returns a
// shaped result the daemon can read; a missing/under-scoped token is a graceful
// "reconnect" message, never a thrown 500.
export async function runUserSlackTool(db, workspaceId, userId, tool, args = {}) {
  const def = USER_SLACK_TOOLS[tool];
  if (!def) return { error: 'unknown_tool', message: `unknown slack tool: ${tool}` };
  const token = await getUserToken(db, workspaceId, userId, 'slack');
  if (!token) return {
    error: 'no_user_token',
    message: 'You haven’t connected your own Slack (or it lacks user scopes). Open Integrations → Connect Slack and grant message-history + chat scopes so your daemon can act as you.',
  };
  try {
    return { ok: true, result: await def.run(token, args) };
  } catch (e) {
    // invalid_auth here means the user token is revoked/expired → prompt reconnect.
    const reconnect = /invalid_auth|token_revoked|account_inactive/.test(e.message);
    return { error: reconnect ? 'reconnect_slack' : 'slack_error', message: e.message };
  }
}
