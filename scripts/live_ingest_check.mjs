// One-off: run the REAL Slack ingest path against prod for a workspace, then verify
// what landed. Mirrors api/brain.js action:'ingest' but with a service-role client
// (prod is behind Vercel's bot-challenge, so we can't drive the HTTP route headlessly).
//   node scripts/live_ingest_check.mjs "Beta Tenant"
import { readFileSync } from 'node:fs';
import { createClient } from '@supabase/supabase-js';

// Load .env (manual parse; NEXT_PUBLIC_SUPABASE_ANON_KEY has a known stray leading '=').
for (const line of readFileSync(new URL('../.env', import.meta.url), 'utf8').split('\n')) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m) process.env[m[1]] ??= m[2].replace(/^=/, '').replace(/^"(.*)"$/, '$1');
}

const { CONNECTORS } = await import('../api/_lib/connectors/index.js');
const { getAccessToken, getUserTokens } = await import('../api/_lib/oauth.js');

const wsName = process.argv[2] || 'Beta Tenant';
const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

// 1. Resolve workspace
const { data: ws } = await db.from('workspaces').select('id, name').ilike('name', wsName).limit(1).single();
if (!ws) { console.error(`No workspace matching "${wsName}"`); process.exit(1); }
console.log(`Workspace: ${ws.name}  (${ws.id})`);

// 2. Connection state
const botToken = await getAccessToken(db, ws.id, 'slack');
const userTokens = await getUserTokens(db, ws.id, 'slack');
const { data: umap } = await db.from('slack_user_map').select('slack_user_id, user_id, real_name').eq('workspace_id', ws.id);
console.log(`Slack bot token:   ${botToken ? 'present' : 'MISSING'}`);
console.log(`Per-staff tokens:  ${userTokens.length}`);
console.log(`slack_user_map:    ${(umap || []).length} mapped users`);

// 3. Counts BEFORE
const before = async (tbl, src) => {
  let q = db.from(tbl).select('*', { count: 'exact', head: true }).eq('workspace_id', ws.id);
  if (src) q = q.eq('source', src);
  const { count } = await q; return count ?? 0;
};
const docsBefore = await before('workspace_documents', 'slack');
const msgsBefore = await before('slack_messages');
console.log(`\nBEFORE → workspace_documents(slack)=${docsBefore}  slack_messages=${msgsBefore}`);

// 4. Run the real ingest
console.log('\nRunning slack.ingest()…');
let result;
try { result = await CONNECTORS.slack.ingest(db, ws.id, botToken); }
catch (e) { console.error('INGEST ERROR:', e.message); process.exit(2); }
console.log('ingest result:', JSON.stringify(result));

// 5. Counts AFTER + a sample
const docsAfter = await before('workspace_documents', 'slack');
console.log(`\nAFTER  → workspace_documents(slack)=${docsAfter}  (Δ ${docsAfter - docsBefore})`);
const { data: sample } = await db.from('workspace_documents')
  .select('title, visibility, content').eq('workspace_id', ws.id).eq('source', 'slack')
  .order('updated_at', { ascending: false }).limit(6);
for (const d of (sample || [])) {
  console.log(`  • ${d.title}  [${d.visibility}]  ${String(d.content || '').replace(/\s+/g, ' ').slice(0, 90)}…`);
}
console.log('\nDone.');
