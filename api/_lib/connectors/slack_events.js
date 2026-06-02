import crypto from 'node:crypto';
import { getAccessToken } from '../oauth.js';
import { findUserById, sendChannelMessage, channelHistory } from './slack.js';
import { resolveLLM, callLLM } from '../research.js';
import { delimitUntrusted } from '../security.js';

// ── Slack Events API ingestion ────────────────────────────────────────────────
// Slack POSTs each event to our endpoint. We verify the signature over the RAW
// body, ack fast, then (in the background) store messages, route @mentions to the
// right person's inbox, and feed the stream to the brain pulse.

// Read the raw request body (the host route disables Vercel's body parser so the
// bytes are intact for signature verification).
export async function readRawBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
  return Buffer.concat(chunks).toString('utf8');
}

// Verify X-Slack-Signature (HMAC-SHA256 over `v0:timestamp:rawBody`) + replay guard.
export function verifySlackSignature(rawBody, headers) {
  const secret = process.env.SLACK_SIGNING_SECRET;
  if (!secret) return false;
  const ts = headers['x-slack-request-timestamp'];
  const sig = headers['x-slack-signature'];
  if (!ts || !sig) return false;
  if (Math.abs(Date.now() / 1000 - Number(ts)) > 60 * 5) return false; // 5-min replay window
  const expected = 'v0=' + crypto.createHmac('sha256', secret).update(`v0:${ts}:${rawBody}`).digest('hex');
  try { return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(sig)); } catch { return false; }
}

// Find the workspace + bot token for an incoming team_id.
async function resolveWorkspace(db, teamId) {
  const { data } = await db
    .from('workspace_integrations')
    .select('workspace_id, access_token, status')
    .eq('provider', 'slack')
    .filter('metadata->team->>id', 'eq', teamId)
    .limit(1)
    .single();
  return data?.status === 'connected' ? data.workspace_id : null;
}

const MENTION_RE = /<@([A-Z0-9]+)>/g;
function extractMentions(text) {
  const out = new Set();
  let m;
  while ((m = MENTION_RE.exec(text || ''))) out.add(m[1]);
  return [...out];
}

// Resolve a Slack user → WorkDaemon member (by email), cached in slack_user_map.
async function resolveSlackUser(db, workspaceId, slackUserId, botToken) {
  const { data: cached } = await db
    .from('slack_user_map')
    .select('user_id, real_name')
    .eq('workspace_id', workspaceId).eq('slack_user_id', slackUserId).single();
  if (cached) return cached;

  let email = null, realName = null, userId = null;
  try {
    const u = await findUserById(botToken, slackUserId);
    email = u?.profile?.email || null;
    realName = u?.real_name || u?.profile?.real_name || u?.name || null;
  } catch {}
  if (email) {
    // Match a workspace member by their auth email.
    const { data: members } = await db
      .from('workspace_members').select('user_id').eq('workspace_id', workspaceId);
    const ids = (members || []).map(m => m.user_id);
    if (ids.length) {
      const { data: au } = await db.auth.admin.listUsers({ page: 1, perPage: 200 }).catch(() => ({ data: null }));
      const match = au?.users?.find(x => x.email && x.email.toLowerCase() === email.toLowerCase() && ids.includes(x.id));
      userId = match?.id || null;
    }
  }
  await db.from('slack_user_map').upsert({
    workspace_id: workspaceId, slack_user_id: slackUserId, user_id: userId, email, real_name: realName,
    updated_at: new Date().toISOString(),
  }, { onConflict: 'workspace_id,slack_user_id' });
  return { user_id: userId, real_name: realName };
}

// Handle one Slack message event: store it + route mentions to inboxes.
async function handleMessage(db, workspaceId, ev, eventId) {
  // Skip noise: bot messages, edits/deletes, channel-join, threads broadcasts.
  if (ev.bot_id || ev.subtype) return;
  const text = ev.text || '';
  const mentions = extractMentions(text);

  // Resolve channel name (best-effort cache via the message's channel).
  let channelName = ev.channel;
  const botToken = await getAccessToken(db, workspaceId, 'slack', 'bot');

  await db.from('slack_messages').upsert({
    workspace_id: workspaceId,
    channel_id:   ev.channel,
    channel_name: channelName,
    slack_user:   ev.user || null,
    text,
    ts:           ev.ts,
    thread_ts:    ev.thread_ts || null,
    mentions,
    event_id:     eventId,
  }, { onConflict: 'workspace_id,channel_id,ts', ignoreDuplicates: true });

  // Real-time @mention alerts → the mentioned member's inbox.
  if (mentions.length && botToken) {
    const author = ev.user ? await resolveSlackUser(db, workspaceId, ev.user, botToken).catch(() => null) : null;
    const authorName = author?.real_name || 'a teammate';
    for (const mu of mentions) {
      const target = await resolveSlackUser(db, workspaceId, mu, botToken).catch(() => null);
      if (!target?.user_id) continue; // not a WorkDaemon member
      await db.from('inbox_items').insert({
        workspace_id: workspaceId,
        user_id:      target.user_id,
        type:         'mention',
        source:       'slack',
        title:        `You were mentioned in Slack by ${authorName}`,
        body:         text.slice(0, 600),
        metadata:     { provider: 'slack', channel: ev.channel, ts: ev.ts, author: ev.user || null },
      });
    }
  }
}

// When @workdaemon is mentioned, reply in the thread as the company's daemon.
async function respondToMention(db, workspaceId, ev) {
  const botToken = await getAccessToken(db, workspaceId, 'slack', 'bot');
  if (!botToken) return;
  const text = (ev.text || '').replace(/<@[A-Z0-9]+>/g, '').trim(); // strip the @bot
  if (!text) return;

  const llm = await resolveLLM(workspaceId, db);
  if (!llm) return;

  const { data: ws } = await db.from('workspaces')
    .select('name, industry, location, context').eq('id', workspaceId).single();
  const company = ws?.name || 'the company';

  // Light grounding: a few recent messages from this channel (untrusted → delimited).
  let recent = '';
  try {
    const msgs = await channelHistory(botToken, ev.channel, { limit: 8 });
    if (msgs.length) recent = '\nRecent messages in this channel (context):\n'
      + delimitUntrusted(msgs.reverse().map(m => m.text).join('\n'), 2000);
  } catch {}

  const sys = `You are WorkDaemon, ${company}'s AI work assistant, replying INSIDE a Slack thread. `
    + `Be genuinely helpful and concise (1–5 sentences). Use Slack mrkdwn (*bold*, _italic_, • bullets, \`code\`). `
    + `${ws?.industry ? `${company} is a ${ws.industry} company${ws.location ? ` in ${ws.location}` : ''}. ` : ''}`
    + `You can answer questions and reason over the conversation. If asked to perform an action that changes things `
    + `(posting elsewhere, scheduling, creating channels), say what you'd do and that it needs confirmation in the WorkDaemon app for now. `
    + `Never invent company-internal facts you don't have.`;

  let reply;
  try {
    reply = (await callLLM(llm, sys, `${text}${recent}`, { maxTokens: 600 })).trim();
  } catch (e) { console.error('[slack_events] respond llm error:', e.message); return; }
  if (!reply) return;

  await sendChannelMessage(botToken, { channel: ev.channel, text: reply, thread_ts: ev.thread_ts || ev.ts })
    .catch(e => console.error('[slack_events] post reply error:', e.message));
}

// Entry point — called by the host route after signature verification.
// Returns { challenge } for url_verification, else processes the event.
export async function processSlackEvent(db, payload) {
  if (payload.type === 'url_verification') return { challenge: payload.challenge };
  if (payload.type !== 'event_callback' || !payload.event) return { ok: true };

  const workspaceId = await resolveWorkspace(db, payload.team_id);
  if (!workspaceId) return { ok: true }; // unknown/disconnected team — ack and ignore

  const ev = payload.event;
  try {
    if (ev.type === 'message') {
      await handleMessage(db, workspaceId, ev, payload.event_id);
    } else if (ev.type === 'app_mention') {
      await handleMessage(db, workspaceId, ev, payload.event_id); // store it too
      await respondToMention(db, workspaceId, ev);                // @workdaemon replies in-thread
    }
  } catch (e) {
    console.error('[slack_events] process error:', e.message);
  }
  return { ok: true };
}
