// Unified calendar read across connected providers. Live-read (no local table):
// pulls upcoming events from Google Calendar + Microsoft 365 + a Notion database
// with a date property, normalizes them, and returns one merged, sorted list.
// Mounted at GET /api/brain?tab=calendar. Uses the per-workspace OAuth tokens.
import { getFreshAccessToken } from './oauth.js';

const WINDOW_DAYS = 30;
const iso = (d) => new Date(d).toISOString();

function norm(provider, { title, start, end, allDay = false, location = null, url = null, attendees = [] }) {
  return { provider, title: title || '(untitled)', start, end: end || start, allDay, location, url, attendees };
}

// ── Google Calendar ──────────────────────────────────────────────────────────
async function googleEvents(token) {
  const timeMin = iso(Date.now());
  const timeMax = iso(Date.now() + WINDOW_DAYS * 864e5);
  const url = `https://www.googleapis.com/calendar/v3/calendars/primary/events?singleEvents=true&orderBy=startTime&maxResults=50&timeMin=${timeMin}&timeMax=${timeMax}`;
  const r = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!r.ok) throw new Error(`google ${r.status}`);
  const d = await r.json();
  return (d.items || []).map(e => norm('google', {
    title: e.summary, start: e.start?.dateTime || e.start?.date, end: e.end?.dateTime || e.end?.date,
    allDay: !e.start?.dateTime, location: e.location || null, url: e.htmlLink || null,
    attendees: (e.attendees || []).map(a => a.email).filter(Boolean),
  }));
}

// Recently-ENDED Google Calendar events with per-attendee RSVP — the substrate
// for the brain's missed-session detector. Unlike googleEvents (future-only),
// this reads a short PAST window and keeps each attendee's responseStatus so we
// can tell who didn't show. Reads the connected account's primary calendar.
export async function googleRecentEvents(token, { sinceDays = 2 } = {}) {
  const timeMin = iso(Date.now() - sinceDays * 864e5);
  const timeMax = iso(Date.now());
  const url = `https://www.googleapis.com/calendar/v3/calendars/primary/events?singleEvents=true&orderBy=startTime&maxResults=100&timeMin=${timeMin}&timeMax=${timeMax}`;
  const r = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!r.ok) throw new Error(`google ${r.status}`);
  const d = await r.json();
  return (d.items || []).map(e => ({
    id: e.id,
    title: e.summary || '(untitled)',
    start: e.start?.dateTime || e.start?.date || null,
    end: e.end?.dateTime || e.end?.date || null,
    url: e.htmlLink || null,
    organizerEmail: e.organizer?.email || null,
    attendees: (e.attendees || []).map(a => ({
      email: a.email || null,
      displayName: a.displayName || null,
      responseStatus: a.responseStatus || 'needsAction', // accepted|declined|tentative|needsAction
      organizer: !!a.organizer,
      self: !!a.self,
      optional: !!a.optional,
      resource: !!a.resource,
    })),
  }));
}

// ── Microsoft 365 (Graph) ────────────────────────────────────────────────────
async function microsoftEvents(token) {
  const start = iso(Date.now()), end = iso(Date.now() + WINDOW_DAYS * 864e5);
  const url = `https://graph.microsoft.com/v1.0/me/calendarView?startDateTime=${start}&endDateTime=${end}`
    + `&$orderby=start/dateTime&$top=50&$select=subject,start,end,isAllDay,location,webLink,attendees`;
  const r = await fetch(url, { headers: { Authorization: `Bearer ${token}`, Prefer: 'outlook.timezone="UTC"' } });
  if (!r.ok) throw new Error(`microsoft ${r.status}`);
  const d = await r.json();
  return (d.value || []).map(e => norm('microsoft', {
    title: e.subject, start: e.start?.dateTime ? iso(e.start.dateTime + 'Z') : null,
    end: e.end?.dateTime ? iso(e.end.dateTime + 'Z') : null, allDay: !!e.isAllDay,
    location: e.location?.displayName || null, url: e.webLink || null,
    attendees: (e.attendees || []).map(a => a.emailAddress?.address).filter(Boolean),
  })).filter(e => e.start);
}

// ── Notion database as a pseudo-calendar (rows with a Date property) ──────────
// Notion has no Calendar API; the closest real surface is a database whose rows
// carry a Date property. We find the first such database and read its dated rows.
async function notionEvents(token, dbId) {
  const headers = { Authorization: `Bearer ${token}`, 'Notion-Version': '2022-06-28', 'Content-Type': 'application/json' };
  if (!dbId) {
    const s = await fetch('https://api.notion.com/v1/search', {
      method: 'POST', headers, body: JSON.stringify({ filter: { property: 'object', value: 'database' }, page_size: 5 }),
    });
    if (!s.ok) throw new Error(`notion search ${s.status}`);
    const sd = await s.json();
    dbId = (sd.results || [])[0]?.id;
  }
  if (!dbId) return [];
  const q = await fetch(`https://api.notion.com/v1/databases/${dbId}/query`, {
    method: 'POST', headers, body: JSON.stringify({ page_size: 50 }),
  });
  if (!q.ok) throw new Error(`notion query ${q.status}`);
  const qd = await q.json();
  const out = [];
  for (const page of qd.results || []) {
    const props = page.properties || {};
    const dateProp = Object.values(props).find(p => p.type === 'date' && p.date?.start);
    if (!dateProp) continue;
    const titleProp = Object.values(props).find(p => p.type === 'title');
    const title = (titleProp?.title || []).map(t => t.plain_text).join('') || '(untitled)';
    out.push(norm('notion', {
      title, start: dateProp.date.start, end: dateProp.date.end || dateProp.date.start,
      allDay: !String(dateProp.date.start).includes('T'), url: page.url || null,
    }));
  }
  return out;
}

const CALENDAR_PROVIDERS = ['google', 'microsoft', 'notion'];

// Returns { connected: ['google',...], events: [...sorted], errors: {provider:msg} }.
export async function unifiedCalendar(db, workspaceId) {
  const { data: integ } = await db.from('workspace_integrations')
    .select('provider, status, meta').eq('workspace_id', workspaceId).eq('status', 'connected');
  const connected = (integ || []).map(i => i.provider).filter(p => CALENDAR_PROVIDERS.includes(p));
  const metaByProvider = Object.fromEntries((integ || []).map(i => [i.provider, i.meta || {}]));
  const events = [];
  const errors = {};
  await Promise.all(connected.map(async (p) => {
    try {
      const token = await getFreshAccessToken(db, workspaceId, p);
      if (!token) { errors[p] = 'no token'; return; }
      let rows = [];
      if (p === 'google') rows = await googleEvents(token);
      else if (p === 'microsoft') rows = await microsoftEvents(token);
      else if (p === 'notion') rows = await notionEvents(token, metaByProvider.notion?.calendar_database_id);
      events.push(...rows);
    } catch (e) { errors[p] = e.message; }
  }));
  events.sort((a, b) => new Date(a.start) - new Date(b.start));
  return { connected, providers: CALENDAR_PROVIDERS, events, errors };
}
