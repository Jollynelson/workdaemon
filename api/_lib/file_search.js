// File/document search across everything the brain has ingested — so a daemon can
// answer "do you have a doc about X?" by surfacing the actual files (name + date +
// link) for the user to pick, even files that aren't TRAINED on. Training is gated
// by relevance/source-trust; SEARCH is not — the daemon can know every file.
//
// Returns the top matches as selectable options: { title, url, date, source, doc_type, snippet }.

const FILE_TYPES = ['file', 'page', 'email_thread', 'email', 'opportunity', 'deal'];
const STOP = new Set([
  'the', 'a', 'an', 'about', 'of', 'for', 'to', 'my', 'our', 'document', 'documents',
  'file', 'files', 'doc', 'docs', 'have', 'you', 'it', 'that', 'this', 'on', 'in',
  'with', 'and', 'find', 'search', 'show', 'me', 'is', 'are', 'do', 'can',
]);

export function keywords(q) {
  // 2+ chars keeps meaningful short tokens (Q3, v2, ML, UI); stopwords filter the noise.
  return [...new Set(String(q || '').toLowerCase().match(/[a-z0-9]{2,}/g) || [])]
    .filter(w => !STOP.has(w)).slice(0, 8);
}

export async function searchFiles(db, workspaceId, query, { limit = 5 } = {}) {
  const kws = keywords(query);
  // Fetch the workspace's NON-restricted file-type docs (newest first), then rank in
  // JS by keyword hits (title weighs more than body). Visibility filter mirrors the
  // training corpus rule — never surface staff-restricted docs workspace-wide.
  const { data } = await db.from('workspace_documents')
    .select('id, title, content, url, source, doc_type, metadata, updated_at, visibility')
    .eq('workspace_id', workspaceId)
    .in('doc_type', FILE_TYPES)
    .or('visibility.is.null,visibility.eq.public,visibility.eq.workspace')
    .order('updated_at', { ascending: false })
    .limit(120);

  const rows = data || [];
  const scored = rows.map((r) => {
    const t = (r.title || '').toLowerCase();
    const c = (r.content || '').toLowerCase();
    let s = 0;
    for (const k of kws) { if (t.includes(k)) s += 3; if (c.includes(k)) s += 1; }
    return { r, s };
  });
  // With keywords: keep only hits, best first. Without: fall back to most-recent.
  const ranked = (kws.length ? scored.filter(x => x.s > 0).sort((a, b) => b.s - a.s) : scored)
    .slice(0, limit)
    .map(({ r }) => ({
      id: r.id,
      title: r.title,
      url: r.url || null,
      source: r.source,
      doc_type: r.doc_type,
      date: (r.metadata && (r.metadata.modifiedTime || r.metadata.created || r.metadata.date)) || r.updated_at || null,
      snippet: (r.content || '').replace(/\s+/g, ' ').trim().slice(0, 160),
      metadata: r.metadata || {},
    }));
  return ranked;
}

// When the team brings a file up (searched it / the daemon surfaced it), the brain
// NOTICES and re-promotes it for learning — even if the relevance gate skipped it
// before. Stamps metadata.referenced so the trainer (qa_synth) treats it as relevant
// next cycle. Best-effort; merges metadata so nothing is lost.
export async function markFilesReferenced(db, workspaceId, files) {
  let marked = 0;
  for (const f of files || []) {
    if (!f?.id) continue;
    try {
      const meta = { ...(f.metadata || {}), referenced: true, last_referenced: new Date().toISOString() };
      const { error } = await db.from('workspace_documents').update({ metadata: meta })
        .eq('id', f.id).eq('workspace_id', workspaceId);
      if (!error) marked++;
    } catch { /* never block search on the re-promotion write */ }
  }
  return marked;
}
