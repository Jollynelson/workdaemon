// Re-embed all workspace_documents using the configured embeddings provider
// (Modal, per .env). Run once after deploying/switching embeddings so existing
// docs become semantically searchable. Mirrors api/brain.js action:'reindex'.
//   node scripts/reindex_embeddings.mjs            # all workspaces
//   node scripts/reindex_embeddings.mjs "Beta Tenant"
import { readFileSync } from 'node:fs';
import { createClient } from '@supabase/supabase-js';

for (const line of readFileSync(new URL('../.env', import.meta.url), 'utf8').split('\n')) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m) process.env[m[1]] ??= m[2].replace(/^=/, '').replace(/^"(.*)"$/, '$1');
}

const { reindexWorkspace } = await import('../api/_lib/ingestion.js');
const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

console.log(`provider=${process.env.EMBEDDINGS_PROVIDER}  url=${process.env.MODAL_EMBEDDINGS_URL ? 'set' : 'MISSING'}\n`);

const only = process.argv[2];
let q = db.from('workspaces').select('id, name');
if (only) q = q.ilike('name', only);
const { data: workspaces } = await q;
if (!workspaces?.length) { console.error('No workspaces found'); process.exit(1); }

for (const ws of workspaces) {
  process.stdout.write(`${ws.name.padEnd(24)} … `);
  try {
    const r = await reindexWorkspace(db, ws.id);
    console.log(`reindexed=${r.reindexed} embedded=${r.embedded}`);
  } catch (e) {
    console.log(`ERROR: ${e.message}`);
  }
}
console.log('\nDone.');
