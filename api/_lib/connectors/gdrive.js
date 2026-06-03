// Google connector — one Google OAuth connection feeds Drive + Gmail + Calendar
// into the document store. Ready; runs once GOOGLE_CLIENT_ID/SECRET are set and a
// workspace connects Google.
import { upsertDocuments } from '../ingestion.js';

async function gget(url, token) {
  const r = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!r.ok) throw new Error(`google ${r.status}`);
  return r.json();
}

// Drive — recent files; Google Docs exported to text.
async function drive(db, workspaceId, token) {
  const q = encodeURIComponent("trashed=false and mimeType!='application/vnd.google-apps.folder'");
  const fields = encodeURIComponent('files(id,name,mimeType,modifiedTime,webViewLink,owners(displayName))');
  const { files } = await gget(`https://www.googleapis.com/drive/v3/files?pageSize=25&orderBy=modifiedTime desc&q=${q}&fields=${fields}`, token);
  const docs = []; let n = 0;
  for (const f of (files || [])) {
    let content = f.name;
    if (f.mimeType === 'application/vnd.google-apps.document' && n < 10) {
      n++;
      try { const ex = await fetch(`https://www.googleapis.com/drive/v3/files/${f.id}/export?mimeType=text/plain`, { headers: { Authorization: `Bearer ${token}` } }); if (ex.ok) content = `${f.name}\n${await ex.text()}`; } catch {}
    }
    docs.push({ external_id: `drive-${f.id}`, doc_type: 'file', title: f.name, content, url: f.webViewLink, author: f.owners?.[0]?.displayName || null, metadata: { mimeType: f.mimeType } });
  }
  return docs;
}

// Gmail — recent message subjects + snippets.
async function gmail(db, workspaceId, token) {
  const list = await gget('https://gmail.googleapis.com/gmail/v1/users/me/messages?maxResults=20', token).catch(() => ({}));
  const docs = [];
  for (const m of (list.messages || []).slice(0, 20)) {
    try {
      const msg = await gget(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${m.id}?format=metadata&metadataHeaders=Subject&metadataHeaders=From`, token);
      const hdr = Object.fromEntries((msg.payload?.headers || []).map(h => [h.name, h.value]));
      docs.push({ external_id: `gmail-${m.id}`, doc_type: 'email', title: hdr.Subject || '(no subject)', content: `${hdr.Subject || ''} — ${msg.snippet || ''}`, author: hdr.From || null, metadata: {} });
    } catch {}
  }
  return docs;
}

// Calendar — upcoming events.
async function calendar(db, workspaceId, token) {
  const now = new Date().toISOString();
  const data = await gget(`https://www.googleapis.com/calendar/v3/calendars/primary/events?maxResults=20&singleEvents=true&orderBy=startTime&timeMin=${now}`, token).catch(() => ({}));
  return (data.items || []).map(e => ({
    external_id: `gcal-${e.id}`, doc_type: 'event', title: e.summary || '(busy)',
    content: `${e.summary || ''} ${e.description || ''} (${e.start?.dateTime || e.start?.date || ''})`,
    url: e.htmlLink, metadata: { start: e.start?.dateTime || e.start?.date },
  }));
}

export async function ingest(db, workspaceId, token) {
  const all = [];
  for (const fn of [drive, gmail, calendar]) {
    try { all.push(...await fn(db, workspaceId, token)); } catch (e) { /* one Google API failing shouldn't sink the others */ }
  }
  return upsertDocuments(db, workspaceId, 'google', all);
}
