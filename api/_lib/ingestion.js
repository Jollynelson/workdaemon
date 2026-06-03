// Ingestion pipeline (FINAL §17 / Master §12). Connectors normalize their data
// into the standard document shape and upsert it here; the daemon grounds answers
// on it via keyword retrieval (the spec's pgvector store, approximated without a
// vector DB — same pragmatic choice as the keyword topic-tagging elsewhere).

const STOP = new Set(['the','a','an','is','are','was','were','be','been','have','has','had','do','does','did','will','would','could','should','can','may','might','what','where','when','how','why','who','which','that','this','these','those','for','and','but','or','nor','yet','so','if','while','with','at','by','from','to','in','on','about','just','my','our','your','their','its','we','they','you','he','she','it','i','need','want','help','know','tell','show','find','our','about']);

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
  const { error } = await db.from('workspace_documents').upsert(rows, { onConflict: 'workspace_id,source,external_id' });
  if (error) throw new Error(error.message);
  return { upserted: rows.length };
}

// Retrieve the documents most relevant to a query (keyword overlap on title+content).
// Returns [{ source, title, content, url, score }]. Empty when nothing matches.
export async function retrieveDocuments(db, workspaceId, query, limit = 4) {
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
