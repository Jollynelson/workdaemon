// Google Drive connector — ingest recent docs (Google Docs exported to text;
// others by title) into the document store. Ready; runs once GOOGLE_CLIENT_ID/
// SECRET are set and a workspace connects Google.
import { upsertDocuments } from '../ingestion.js';

export async function ingest(db, workspaceId, token) {
  const r = await fetch(
    'https://www.googleapis.com/drive/v3/files?pageSize=25&orderBy=modifiedTime desc'
    + '&q=' + encodeURIComponent("trashed=false and mimeType!='application/vnd.google-apps.folder'")
    + '&fields=' + encodeURIComponent('files(id,name,mimeType,modifiedTime,webViewLink,owners(displayName))'),
    { headers: { Authorization: `Bearer ${token}` } },
  );
  if (!r.ok) throw new Error(`gdrive list http ${r.status}`);
  const { files } = await r.json();
  const docs = [];
  let textFetched = 0;
  for (const f of (files || [])) {
    let content = f.name;
    // Export Google Docs to plain text for the first ~10 (bounds API calls).
    if (f.mimeType === 'application/vnd.google-apps.document' && textFetched < 10) {
      textFetched++;
      try {
        const ex = await fetch(`https://www.googleapis.com/drive/v3/files/${f.id}/export?mimeType=text/plain`, { headers: { Authorization: `Bearer ${token}` } });
        if (ex.ok) content = `${f.name}\n${await ex.text()}`;
      } catch { /* fall back to title */ }
    }
    docs.push({ external_id: f.id, doc_type: 'file', title: f.name, content, url: f.webViewLink, author: f.owners?.[0]?.displayName || null, metadata: { mimeType: f.mimeType, modified: f.modifiedTime } });
  }
  return upsertDocuments(db, workspaceId, 'google', docs);
}
