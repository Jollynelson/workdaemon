// Notion connector — ingest pages (title + a snippet of block text) into the
// document store. Ready; runs once NOTION_CLIENT_ID/SECRET are set and a
// workspace connects Notion.
import { upsertDocuments } from '../ingestion.js';

const HEADERS = (token) => ({ Authorization: `Bearer ${token}`, 'Notion-Version': '2022-06-28', 'Content-Type': 'application/json' });

function pageTitle(page) {
  const props = page.properties || {};
  for (const k of Object.keys(props)) {
    const pr = props[k];
    if (pr?.type === 'title') return (pr.title || []).map(t => t.plain_text).join('') || 'Untitled';
  }
  return 'Untitled';
}

// Pull plain text from a page's top-level blocks (bounded; one call per page).
async function pageText(token, pageId) {
  try {
    const r = await fetch(`https://api.notion.com/v1/blocks/${pageId}/children?page_size=40`, { headers: HEADERS(token) });
    if (!r.ok) return '';
    const d = await r.json();
    const parts = [];
    for (const b of (d.results || [])) {
      const rich = b[b.type]?.rich_text;
      if (Array.isArray(rich)) parts.push(rich.map(t => t.plain_text).join(''));
    }
    return parts.filter(Boolean).join('\n');
  } catch { return ''; }
}

export async function ingest(db, workspaceId, token) {
  const r = await fetch('https://api.notion.com/v1/search', {
    method: 'POST', headers: HEADERS(token),
    body: JSON.stringify({ filter: { property: 'object', value: 'page' }, page_size: 25 }),
  });
  if (!r.ok) throw new Error(`notion search http ${r.status}`);
  const d = await r.json();
  const pages = (d.results || []).filter(p => p.object === 'page');
  const docs = [];
  for (let i = 0; i < pages.length; i++) {
    const p = pages[i];
    const title = pageTitle(p);
    // Fetch body text for the first ~12 pages to bound API calls.
    const content = i < 12 ? `${title}\n${await pageText(token, p.id)}` : title;
    docs.push({ external_id: p.id, doc_type: 'page', title, content, url: p.url, metadata: { last_edited: p.last_edited_time } });
  }
  return upsertDocuments(db, workspaceId, 'notion', docs);
}
