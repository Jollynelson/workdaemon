// GitHub connector — ingest issues assigned to / involving the connected user
// into the document store so the daemon can ground on real dev work.
// Ready; runs once GITHUB_CLIENT_ID/SECRET are set and a workspace connects GitHub.
import { upsertDocuments } from '../ingestion.js';

export async function ingest(db, workspaceId, token) {
  const r = await fetch('https://api.github.com/issues?filter=all&state=open&per_page=40', {
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'User-Agent': 'WorkDaemon' },
  });
  if (!r.ok) throw new Error(`github issues http ${r.status}`);
  const issues = await r.json();
  const docs = (Array.isArray(issues) ? issues : []).map(i => ({
    external_id: `issue-${i.id}`,
    doc_type: 'issue',
    title: `${i.repository?.name ? i.repository.name + ' ' : ''}#${i.number}: ${i.title}`,
    content: i.body || i.title || '',
    url: i.html_url,
    author: i.user?.login || null,
    metadata: { state: i.state, labels: (i.labels || []).map(l => l.name).filter(Boolean), repo: i.repository?.full_name },
  }));
  return upsertDocuments(db, workspaceId, 'github', docs);
}
