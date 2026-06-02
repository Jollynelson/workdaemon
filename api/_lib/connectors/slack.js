import { getAccessToken } from '../oauth.js';

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
  const r = await fetch(`https://slack.com/api/${method}`, { method: 'POST', headers, body });
  const d = await r.json();
  if (!d.ok) throw new Error(`slack ${method}: ${d.error}`);
  return d;
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
export const addReminder             = (t, { text, time, user })          => slackApi(t, 'reminders.add', { text, time, user });
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
  add_reminder:            { kind: 'bot',  type: 'action', run: (t, a) => addReminder(t, a) },
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
