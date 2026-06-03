// Ingestion pipeline (FINAL §17 / Master §12). Connectors normalize their data
// into the standard document shape and upsert it here; the daemon grounds answers
// on it via keyword retrieval (the spec's pgvector store, approximated without a
// vector DB — same pragmatic choice as the keyword topic-tagging elsewhere).

const STOP = new Set(['the','a','an','is','are','was','were','be','been','have','has','had','do','does','did','will','would','could','should','can','may','might','what','where','when','how','why','who','which','that','this','these','those','for','and','but','or','nor','yet','so','if','while','with','at','by','from','to','in','on','about','just','my','our','your','their','its','we','they','you','he','she','it','i','need','want','help','know','tell','show','find','our','about']);

// ── Embeddings — PLATFORM-managed (customers bring only a reasoning key) ──────
// Embeddings run on OUR infra (Modal-served Ollama) or our own central key — set
// once via env, shared by every workspace. Returns vectors, or null → the caller
// falls back to keyword retrieval (so the KB always works).
//   EMBEDDINGS_PROVIDER  modal | ollama | openai | mistral  (default: modal if a
//                        Modal/Ollama URL is set, else openai)
//   MODAL_EMBEDDINGS_URL  Modal serving base (…/api/serve/embeddings)
//   MODAL_SERVE_SECRET    bearer for the Modal serving app
//   EMBEDDINGS_MODEL      default 'nomic-embed-text' (768-dim) for modal/ollama
const cap = (s) => String(s).slice(0, 8000);
const vecLiteral = (arr) => '[' + arr.join(',') + ']';

function embedConfig() {
  const url = process.env.MODAL_EMBEDDINGS_URL || process.env.EMBEDDINGS_BASE_URL || '';
  const provider = process.env.EMBEDDINGS_PROVIDER || (url ? 'modal' : 'openai');
  return {
    provider,
    url: url.replace(/\/$/, ''),
    key: process.env.MODAL_SERVE_SECRET || process.env.EMBEDDINGS_API_KEY || process.env.OPENAI_API_KEY || '',
    model: process.env.EMBEDDINGS_MODEL || (provider === 'openai' ? 'text-embedding-3-small' : 'nomic-embed-text'),
  };
}

export async function embed(inputs) {
  if (!inputs?.length) return null;
  const c = embedConfig();
  try {
    // Our infra: Modal-served Ollama embeddings. Contract: {embeddings:[[...],…]}.
    if (c.provider === 'modal' || c.provider === 'ollama') {
      if (!c.url) return null;
      const r = await fetch(`${c.url}/api/serve/embeddings`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(c.key ? { Authorization: `Bearer ${c.key}` } : {}) },
        body: JSON.stringify({ model: c.model, input: inputs.map(cap) }),
      });
      if (!r.ok) return null;
      const d = await r.json();
      return d.embeddings || null;
    }
    // Hosted OpenAI-shaped APIs (central platform key).
    if (!c.key) return null;
    const base = c.provider === 'mistral' ? 'https://api.mistral.ai/v1' : 'https://api.openai.com/v1';
    const r = await fetch(`${base}/embeddings`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${c.key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: c.model, input: inputs.map(cap) }),
    });
    if (!r.ok) return null;
    const d = await r.json();
    return (d.data || []).sort((a, b) => a.index - b.index).map(x => x.embedding);
  } catch { return null; }
}

export function keywords(text, max = 10) {
  return [...new Set(String(text || '').toLowerCase().replace(/[^a-z0-9 ]/g, ' ').split(/\s+/)
    .filter(w => w.length > 3 && !STOP.has(w)))].slice(0, max);
}

// Normalize + upsert a batch of documents for a workspace+source.
// docs: [{ external_id, doc_type, title, content, url, author, metadata }]
export async function upsertDocuments(db, workspaceId, source, docs) {
  const rows = (docs || []).filter(d => d.external_id && (d.title || d.content)).map(d => ({
    workspace_id: workspaceId,
    source,
    external_id: String(d.external_id).slice(0, 200),
    doc_type: d.doc_type || 'doc',
    title: (d.title || '').slice(0, 300),
    content: (d.content || '').replace(/\s+/g, ' ').trim().slice(0, 8000),
    url: d.url || null,
    author: d.author || null,
    metadata: d.metadata || {},
    updated_at: new Date().toISOString(),
  }));
  if (!rows.length) return { upserted: 0 };
  // Embed for semantic retrieval (best-effort; rows still upsert without it).
  const vecs = await embed(rows.map(r => `${r.title}\n${r.content}`));
  if (vecs && vecs.length === rows.length) rows.forEach((r, i) => { r.embedding = vecLiteral(vecs[i]); });
  const { error } = await db.from('workspace_documents').upsert(rows, { onConflict: 'workspace_id,source,external_id' });
  if (error) throw new Error(error.message);
  return { upserted: rows.length, embedded: !!vecs };
}

// Re-embed every document in a workspace (the "switching providers re-indexes"
// background job). Best-effort; no-op cleanly when embeddings are unavailable.
export async function reindexWorkspace(db, workspaceId) {
  const { data: docs } = await db
    .from('workspace_documents').select('id, title, content').eq('workspace_id', workspaceId);
  if (!docs?.length) return { reindexed: 0, embedded: false };
  let embedded = 0;
  const BATCH = 32;
  for (let i = 0; i < docs.length; i += BATCH) {
    const chunk = docs.slice(i, i + BATCH);
    const vecs = await embed(chunk.map(d => `${d.title}\n${d.content}`));
    if (!vecs || vecs.length !== chunk.length) continue;
    for (let j = 0; j < chunk.length; j++) {
      const { error } = await db.from('workspace_documents').update({ embedding: vecLiteral(vecs[j]) }).eq('id', chunk[j].id);
      if (!error) embedded++;
    }
  }
  return { reindexed: docs.length, embedded };
}

// Retrieve the documents most relevant to a query (keyword overlap on title+content).
// Returns [{ source, title, content, url, score }]. Empty when nothing matches.
export async function retrieveDocuments(db, workspaceId, query, limit = 4) {
  // Prefer semantic (pgvector) retrieval; fall back to keyword.
  const qv = await embed([query]);
  if (qv?.[0]) {
    const { data } = await db.rpc('match_documents', { p_workspace: workspaceId, p_embedding: vecLiteral(qv[0]), p_count: limit });
    if (data?.length) return data.map(d => ({ ...d, score: d.similarity }));
  }
  const terms = keywords(query, 12);
  if (!terms.length) return [];
  const { data: docs } = await db
    .from('workspace_documents')
    .select('source, doc_type, title, content, url')
    .eq('workspace_id', workspaceId)
    .limit(200);
  if (!docs?.length) return [];
  const scored = docs.map(d => {
    const hay = `${d.title || ''} ${d.content || ''}`.toLowerCase();
    let score = 0;
    for (const t of terms) if (hay.includes(t)) score += hay.indexOf(t) < (d.title || '').length ? 2 : 1; // title hits weigh more
    return { ...d, score };
  }).filter(d => d.score > 0).sort((a, b) => b.score - a.score);
  return scored.slice(0, limit);
}
