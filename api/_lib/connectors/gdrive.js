// Google connector — one Google OAuth connection feeds Drive + Gmail + Calendar
// into the document store. DEEPENED (roadmap #1 "see the whole company"): bigger
// bounded windows, real bodies (not just names/snippets), and structured event
// metadata (attendees + RSVP). Pure mappers are exported for unit testing; the
// fetch wrappers stay thin. Runs once GOOGLE_CLIENT_ID/SECRET are set + connected.
import { upsertDocuments } from '../ingestion.js';

const DRIVE_FILES   = Number(process.env.GDRIVE_FILE_LIMIT   || 50);
const DRIVE_EXPORTS = Number(process.env.GDRIVE_EXPORT_LIMIT || 18);
const GMAIL_MSGS    = Number(process.env.GMAIL_MSG_LIMIT     || 30);
const CAL_PAST_DAYS   = Number(process.env.CAL_INGEST_PAST_DAYS   || 14);
const CAL_FUTURE_DAYS = Number(process.env.CAL_INGEST_FUTURE_DAYS || 45);

async function gget(url, token) {
  const r = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!r.ok) throw new Error(`google ${r.status}`);
  return r.json();
}

// Google Workspace export targets — which native types we pull TEXT for, and as what.
const EXPORT_MIME = {
  'application/vnd.google-apps.document':     'text/plain',
  'application/vnd.google-apps.spreadsheet':  'text/csv',
  'application/vnd.google-apps.presentation': 'text/plain',
};

// Drive — recent files; native Google Docs/Sheets/Slides exported to text so the
// brain sees the CONTENT, not just the filename.
async function drive(db, workspaceId, token) {
  const q = encodeURIComponent("trashed=false and mimeType!='application/vnd.google-apps.folder'");
  const fields = encodeURIComponent('files(id,name,mimeType,modifiedTime,webViewLink,owners(displayName))');
  const { files } = await gget(`https://www.googleapis.com/drive/v3/files?pageSize=${DRIVE_FILES}&orderBy=modifiedTime desc&q=${q}&fields=${fields}`, token);
  const docs = []; let exported = 0;
  for (const f of (files || [])) {
    let content = f.name;
    const exportAs = EXPORT_MIME[f.mimeType];
    if (exportAs && exported < DRIVE_EXPORTS) {
      exported++;
      try {
        const ex = await fetch(`https://www.googleapis.com/drive/v3/files/${f.id}/export?mimeType=${encodeURIComponent(exportAs)}`, { headers: { Authorization: `Bearer ${token}` } });
        if (ex.ok) content = `${f.name}\n${await ex.text()}`;
      } catch { /* keep the filename */ }
    }
    docs.push({ external_id: `drive-${f.id}`, doc_type: 'file', title: f.name, content, url: f.webViewLink, author: f.owners?.[0]?.displayName || null, metadata: { mimeType: f.mimeType, modifiedTime: f.modifiedTime } });
  }
  return docs;
}

// Decode a Gmail message payload to readable plain text (prefers text/plain;
// falls back to stripped HTML, then the top-level body). Pure + exported.
function b64url(s) {
  try { return Buffer.from(String(s || '').replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8'); } catch { return ''; }
}
export function gmailPlainText(payload) {
  if (!payload) return '';
  const find = (p, mime) => {
    if (!p) return '';
    if (p.mimeType === mime && p.body?.data) return b64url(p.body.data);
    for (const c of (p.parts || [])) { const t = find(c, mime); if (t) return t; }
    return '';
  };
  let txt = find(payload, 'text/plain');
  if (!txt) txt = find(payload, 'text/html').replace(/<[^>]+>/g, ' ');
  if (!txt && payload.body?.data) txt = b64url(payload.body.data);
  return txt.replace(/\s+/g, ' ').trim();
}

// Shape a full Gmail message into a document (subject + from/to + real body).
export function mapGmailMessage(msg) {
  const hdr = Object.fromEntries((msg.payload?.headers || []).map(h => [h.name, h.value]));
  const body = gmailPlainText(msg.payload);
  const subject = hdr.Subject || '(no subject)';
  return {
    external_id: `gmail-${msg.id}`, doc_type: 'email', title: subject,
    content: [subject, body || msg.snippet || ''].filter(Boolean).join('\n').slice(0, 8000),
    author: hdr.From || null,
    metadata: { from: hdr.From || null, to: hdr.To || null, date: hdr.Date || null, thread_id: msg.threadId || null },
  };
}

// Gmail — recent messages WITH bodies (format=full), not just snippets.
async function gmail(db, workspaceId, token) {
  const list = await gget(`https://gmail.googleapis.com/gmail/v1/users/me/messages?maxResults=${GMAIL_MSGS}`, token).catch(() => ({}));
  const docs = [];
  for (const m of (list.messages || []).slice(0, GMAIL_MSGS)) {
    try {
      const msg = await gget(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${m.id}?format=full`, token);
      docs.push(mapGmailMessage(msg));
    } catch { /* skip one bad message */ }
  }
  return docs;
}

// Shape a Google Calendar event into a structured document. Pure + exported.
// Captures attendees + RSVP, organizer, location, and past/upcoming — so the
// company's SCHEDULE becomes durable, queryable brain knowledge.
export function mapGoogleEvent(e, now = Date.now()) {
  const start = e.start?.dateTime || e.start?.date || null;
  const end = e.end?.dateTime || e.end?.date || null;
  const attendees = (e.attendees || []).map(a => ({
    email: a.email || null, name: a.displayName || null,
    response: a.responseStatus || null, organizer: !!a.organizer, optional: !!a.optional,
  }));
  const when = end ? (Date.parse(end) < now ? 'past' : 'upcoming') : 'upcoming';
  const attLine = attendees.length ? `Attendees: ${attendees.map(a => `${a.name || a.email}${a.response ? ` (${a.response})` : ''}`).join(', ')}` : '';
  return {
    external_id: `gcal-${e.id}`, doc_type: 'event',
    title: e.summary || '(busy)',
    content: [e.summary || '', e.description || '', start ? `When: ${start}` : '', e.location ? `Where: ${e.location}` : '', attLine].filter(Boolean).join('\n'),
    url: e.htmlLink || null,
    author: e.organizer?.email || null,
    metadata: { start, end, when, location: e.location || null, organizer: e.organizer?.email || null, attendees, attendee_count: attendees.length, status: e.status || null },
  };
}

// Calendar — a WINDOW of events (recent past + upcoming), structured.
async function calendar(db, workspaceId, token) {
  const timeMin = new Date(Date.now() - CAL_PAST_DAYS * 864e5).toISOString();
  const timeMax = new Date(Date.now() + CAL_FUTURE_DAYS * 864e5).toISOString();
  const data = await gget(`https://www.googleapis.com/calendar/v3/calendars/primary/events?maxResults=100&singleEvents=true&orderBy=startTime&timeMin=${timeMin}&timeMax=${timeMax}`, token).catch(() => ({}));
  const now = Date.now();
  return (data.items || []).map(e => mapGoogleEvent(e, now));
}

export async function ingest(db, workspaceId, token) {
  const all = [];
  for (const fn of [drive, gmail, calendar]) {
    try { all.push(...await fn(db, workspaceId, token)); } catch { /* one Google API failing shouldn't sink the others */ }
  }
  return upsertDocuments(db, workspaceId, 'google', all);
}
