// Atlassian connector — Jira issues into the document store. Resolves the
// Jira cloud id via accessible-resources. Ready; needs ATLASSIAN_CLIENT_ID/SECRET.
import { upsertDocuments } from '../ingestion.js';

// Shallow text extract from Atlassian Document Format (ADF).
function adfText(node) {
  if (!node) return '';
  if (typeof node === 'string') return node;
  if (node.text) return node.text;
  return (node.content || []).map(adfText).join(' ');
}

export async function ingest(db, workspaceId, token) {
  const resR = await fetch('https://api.atlassian.com/oauth/token/accessible-resources', {
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
  });
  if (!resR.ok) throw new Error(`atlassian resources http ${resR.status}`);
  const cloud = (await resR.json())?.[0]?.id;
  if (!cloud) return { upserted: 0 };
  const jql = encodeURIComponent('assignee = currentUser() OR reporter = currentUser() ORDER BY updated DESC');
  const r = await fetch(`https://api.atlassian.com/ex/jira/${cloud}/rest/api/3/search?jql=${jql}&maxResults=30&fields=summary,status,description,project`, {
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
  });
  if (!r.ok) throw new Error(`jira search http ${r.status}`);
  const d = await r.json();
  const docs = (d.issues || []).map(i => ({
    external_id: `jira-${i.id}`, doc_type: 'issue',
    title: `${i.key}: ${i.fields?.summary || ''}`,
    content: `${i.fields?.summary || ''} ${adfText(i.fields?.description)}`,
    metadata: { status: i.fields?.status?.name, project: i.fields?.project?.key },
  }));
  return upsertDocuments(db, workspaceId, 'atlassian', docs);
}
