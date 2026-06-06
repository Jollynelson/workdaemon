// Executable write-actions (FINAL §15 / Master §11 — the daemon ACTING on real
// data, not just reading). Each action names the provider it needs connected, a
// minimum permission level, a runner, and a human description for the confirm/
// audit trail. Reads go anywhere; writes are allow-listed here and gated.
import * as slack from './connectors/slack.js';

const LEVEL_RANK = { junior: 1, manager: 2, director: 3, executive: 4 };

export const ACTIONS = {
  'slack.post': {
    provider: 'slack',
    label: 'Post a Slack message',
    minLevel: 2,                       // L2: assistant — runs only on explicit confirm
    describe: (p) => `Post to ${p?.channel || '(channel)'}: “${(p?.text || '').slice(0, 100)}”`,
    run: async (token, p) => {
      if (!p?.channel || !p?.text) throw new Error('channel and text are required');
      const r = await slack.sendChannelMessage(token, { channel: p.channel, text: p.text });
      return { ts: r?.ts || null, channel: p.channel };
    },
  },
  'slack.react': {
    provider: 'slack',
    label: 'Add a Slack reaction',
    minLevel: 2,
    describe: (p) => `React :${p?.emoji || 'eyes'}: on a message in ${p?.channel || '(channel)'}`,
    run: async (token, p) => {
      if (!p?.channel || !p?.timestamp) throw new Error('channel and timestamp required');
      return slack.addReaction ? slack.addReaction(token, p.channel, p.timestamp, p.emoji || 'eyes') : Promise.reject(new Error('reaction unsupported'));
    },
  },

  // ── Notion (token is long-lived; integration must have insert capability + the
  //    target page shared with it) ──────────────────────────────────────────────
  'notion.create_page': {
    provider: 'notion',
    label: 'Create a Notion page',
    minLevel: 2,
    describe: (p) => `Create Notion page “${(p?.title || '').slice(0, 80)}”`,
    run: async (token, p) => {
      if (!p?.parent_id || !p?.title) throw new Error('parent_id and title are required');
      const r = await fetch('https://api.notion.com/v1/pages', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', 'Notion-Version': '2022-06-28' },
        body: JSON.stringify({
          parent: { page_id: p.parent_id },
          properties: { title: { title: [{ text: { content: String(p.title).slice(0, 200) } }] } },
          children: p.content ? [{ object: 'block', type: 'paragraph', paragraph: { rich_text: [{ type: 'text', text: { content: String(p.content).slice(0, 1900) } }] } }] : [],
        }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.message || `Notion ${r.status}`);
      return { id: d.id, url: d.url };
    },
  },
  'notion.append_text': {
    provider: 'notion',
    label: 'Append text to a Notion page',
    minLevel: 2,
    describe: (p) => `Append to Notion page: “${(p?.text || '').slice(0, 80)}”`,
    run: async (token, p) => {
      if (!p?.page_id || !p?.text) throw new Error('page_id and text are required');
      const r = await fetch(`https://api.notion.com/v1/blocks/${p.page_id}/children`, {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', 'Notion-Version': '2022-06-28' },
        body: JSON.stringify({ children: [{ object: 'block', type: 'paragraph', paragraph: { rich_text: [{ type: 'text', text: { content: String(p.text).slice(0, 1900) } }] } }] }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.message || `Notion ${r.status}`);
      return { ok: true };
    },
  },

  // ── Gmail (needs gmail.send scope) ───────────────────────────────────────────
  'gmail.send': {
    provider: 'google',
    label: 'Send an email (Gmail)',
    minLevel: 2,
    describe: (p) => `Email ${p?.to || '(recipient)'} — “${(p?.subject || '').slice(0, 80)}”`,
    run: async (token, p) => {
      if (!p?.to || !p?.body) throw new Error('to and body are required');
      const headers = [`To: ${p.to}`, p.cc ? `Cc: ${p.cc}` : null, `Subject: ${p.subject || '(no subject)'}`, 'Content-Type: text/plain; charset="UTF-8"'].filter(Boolean).join('\r\n');
      const raw = Buffer.from(`${headers}\r\n\r\n${p.body}`).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
      const r = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ raw }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.error?.message || `Gmail ${r.status}`);
      return { id: d.id, threadId: d.threadId };
    },
  },

  // ── Google Calendar — create an event / invite (needs calendar.events scope) ─
  'gcal.create_event': {
    provider: 'google',
    label: 'Create a calendar event',
    minLevel: 2,
    describe: (p) => `Calendar: “${(p?.title || 'Event').slice(0, 60)}”${p?.start ? ` at ${p.start}` : ''}`,
    run: async (token, p) => {
      if (!p?.title || !p?.start) throw new Error('title and start (ISO datetime) are required');
      const end = p.end || new Date(new Date(p.start).getTime() + (Number(p.duration_min) || 30) * 60000).toISOString();
      const attendees = Array.isArray(p.attendees) ? p.attendees.filter(Boolean).map(e => ({ email: e })) : undefined;
      const r = await fetch('https://www.googleapis.com/calendar/v3/calendars/primary/events?sendUpdates=all', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ summary: p.title, description: p.description || '', start: { dateTime: p.start }, end: { dateTime: end }, attendees }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.error?.message || `Calendar ${r.status}`);
      return { id: d.id, url: d.htmlLink };
    },
  },

  // ── Google Drive — create a Doc (needs drive.file scope) ─────────────────────
  'gdrive.create_doc': {
    provider: 'google',
    label: 'Create a Google Doc',
    minLevel: 2,
    describe: (p) => `Create Google Doc “${(p?.title || 'Untitled').slice(0, 80)}”`,
    run: async (token, p) => {
      const title = p?.title || 'Untitled';
      const content = p?.content || '';
      const boundary = 'wd' + Math.random().toString(36).slice(2);
      const meta = { name: title, mimeType: 'application/vnd.google-apps.document' };
      const body = `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(meta)}\r\n--${boundary}\r\nContent-Type: text/plain; charset=UTF-8\r\n\r\n${content}\r\n--${boundary}--`;
      const r = await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,webViewLink', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': `multipart/related; boundary=${boundary}` },
        body,
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.error?.message || `Drive ${r.status}`);
      return { id: d.id, url: d.webViewLink };
    },
  },
};

export function meetsLevel(accessLevel, minLevel) {
  return (LEVEL_RANK[accessLevel] || 1) >= minLevel;
}
