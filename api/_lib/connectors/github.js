// GitHub connector — ingest the connected user's real dev work (issues, pull
// requests, and their discussion) into the document store, so it grounds the
// shared brain AND feeds the per-company model. Issues/PRs are facts; the
// discussion (comments, reviews) is the BEHAVIORAL signal a fine-tune learns from
// that RAG-over-docs can't easily give. Ready; runs once GITHUB_CLIENT_ID/SECRET
// are set and a workspace connects GitHub.
import { upsertDocuments } from '../ingestion.js';

const GH = 'https://api.github.com';
const HEADERS = (token) => ({
  Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'User-Agent': 'WorkDaemon',
});
// How many of the most-recently-updated items also get their discussion pulled
// (1 extra API call each — bounded to stay well under GitHub rate limits).
const COMMENTS_FOR = Number(process.env.GITHUB_COMMENTS_FOR || 25);
const MAX_COMMENTS = 20;

async function ghJson(url, token) {
  const r = await fetch(url, { headers: HEADERS(token) });
  if (!r.ok) throw new Error(`github http ${r.status} (${url.replace(GH, '')})`);
  return r.json();
}

// Append the discussion thread to an item's body — that's where the company's
// actual reasoning/decisions live (the part worth learning).
async function withComments(item, token) {
  if (!item.comments || !item.comments_url) return item.body || item.title || '';
  try {
    const comments = await ghJson(`${item.comments_url}?per_page=${MAX_COMMENTS}`, token);
    const thread = (Array.isArray(comments) ? comments : [])
      .map(c => `${c.user?.login || 'someone'}: ${(c.body || '').trim()}`)
      .filter(Boolean).join('\n');
    return [item.body || item.title || '', thread && `\n\n--- discussion ---\n${thread}`].filter(Boolean).join('');
  } catch {
    return item.body || item.title || '';   // a single comment fetch failing never blocks ingest
  }
}

export async function ingest(db, workspaceId, token, { onProgress } = {}) {
  onProgress?.({ stage: 'reading issues & pull requests', done: 0, total: 1 });
  // The /issues feed returns BOTH issues and PRs the user is involved in; PRs carry
  // a `pull_request` field. state=all + sort=updated pulls open AND resolved work.
  const items = await ghJson(`${GH}/issues?filter=all&state=all&sort=updated&per_page=100`, token);
  const list = Array.isArray(items) ? items : [];

  // Pull discussion for the most-recently-updated items (behavioral signal).
  const enriched = new Map();
  const head = list.slice(0, COMMENTS_FOR);
  for (let i = 0; i < head.length; i++) {
    enriched.set(head[i].id, await withComments(head[i], token));
    onProgress?.({ stage: 'reading discussion', done: i + 1, total: head.length });
  }

  const docs = list.map(i => {
    const isPR = !!i.pull_request;
    return {
      external_id: `${isPR ? 'pr' : 'issue'}-${i.id}`,
      doc_type: isPR ? 'pull_request' : 'issue',
      title: `${i.repository?.name ? i.repository.name + ' ' : ''}#${i.number}: ${i.title}`,
      content: enriched.get(i.id) || i.body || i.title || '',
      url: i.html_url,
      author: i.user?.login || null,
      metadata: {
        kind: isPR ? 'pull_request' : 'issue',
        state: i.state,
        labels: (i.labels || []).map(l => l.name).filter(Boolean),
        repo: i.repository?.full_name,
        comments: i.comments || 0,
      },
    };
  });

  onProgress?.({ stage: 'indexing', done: list.length, total: list.length, doc_count: docs.length });
  return upsertDocuments(db, workspaceId, 'github', docs);
}
