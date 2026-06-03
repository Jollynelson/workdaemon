// Microsoft 365 connector (Graph) — Outlook mail into the document store.
// Ready; runs once MICROSOFT_CLIENT_ID/SECRET are set and a workspace connects.
import { upsertDocuments } from '../ingestion.js';

export async function ingest(db, workspaceId, token) {
  const r = await fetch("https://graph.microsoft.com/v1.0/me/messages?$top=20&$select=subject,bodyPreview,from,webLink,receivedDateTime", {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!r.ok) throw new Error(`msgraph mail http ${r.status}`);
  const d = await r.json();
  const docs = (d.value || []).map(m => ({
    external_id: `msmail-${m.id}`, doc_type: 'email',
    title: m.subject || '(no subject)',
    content: `${m.subject || ''} — ${m.bodyPreview || ''}`,
    url: m.webLink, author: m.from?.emailAddress?.address || null,
    metadata: { received: m.receivedDateTime },
  }));
  return upsertDocuments(db, workspaceId, 'microsoft', docs);
}
