// One-off backfill: sweep ALL historical daemon_messages into per-user daily
// transcript documents (workspace_documents, source 'chat') — the same shape
// the live per-turn ingest writes (api/_lib/transcripts.js). Idempotent:
// upserts on (workspace_id, source, external_id), so re-runs just refresh.
//
//   node scripts/backfill_chat_transcripts.mjs --dry   # report what WOULD be written
//   node scripts/backfill_chat_transcripts.mjs         # write + embed
//
// ⚠️ Operates on the prod DB (like every script here).
import { readFileSync } from 'node:fs';
for (const l of readFileSync(new URL('../.env', import.meta.url), 'utf8').split('\n')) {
  const m = l.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m) process.env[m[1]] = m[2].replace(/^"|"$/g, '');
}
process.env.SUPABASE_URL ||= process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.VITE_SUPABASE_URL;

const { adminClient } = await import('../api/_lib/supabase.js');
const { upsertDocuments } = await import('../api/_lib/ingestion.js');
const { transcriptLines, transcriptDoc } = await import('../api/_lib/transcripts.js');

const DRY = process.argv.includes('--dry');
const db = adminClient();

// Profiles: name + workspace fallback for rows whose workspace_id is null.
const { data: profiles } = await db.from('profiles').select('id, name, workspace_id');
const profOf = Object.fromEntries((profiles || []).map(p => [p.id, p]));

// Pull every message, oldest first, paged.
const PAGE = 1000;
const all = [];
for (let from = 0; ; from += PAGE) {
  const { data: rows, error } = await db.from('daemon_messages')
    .select('user_id, workspace_id, role, content, created_at')
    .order('created_at', { ascending: true })
    .range(from, from + PAGE - 1);
  if (error) { console.error('read failed:', error.message); process.exit(1); }
  if (!rows?.length) break;
  all.push(...rows);
  if (rows.length < PAGE) break;
}
console.log(`messages: ${all.length}`);

// Group by (workspace, user, day).
const groups = new Map(); // wsId → Map<`${userId}|${day}`, rows[]>
let skippedNoWs = 0;
for (const m of all) {
  const ws = m.workspace_id || profOf[m.user_id]?.workspace_id || null;
  if (!ws) { skippedNoWs++; continue; }
  const day = String(m.created_at).slice(0, 10);
  const wsMap = groups.get(ws) || groups.set(ws, new Map()).get(ws);
  const key = `${m.user_id}|${day}`;
  (wsMap.get(key) || wsMap.set(key, []).get(key)).push(m);
}

let docs = 0, empty = 0;
for (const [wsId, wsMap] of groups) {
  const batch = [];
  for (const [key, rows] of wsMap) {
    const [userId, dayISO] = key.split('|');
    const ownerName = profOf[userId]?.name || 'staff';
    const lines = transcriptLines(rows, ownerName);
    if (!lines.length) { empty++; continue; }
    batch.push(transcriptDoc({ userId, dayISO, ownerName, lines }));
  }
  // Small chunks: embed() has a 7s budget and big transcript batches blow it
  // (observed: 14 docs → embedded=false; the rows upsert but lose semantic rank).
  for (let i = 0; i < batch.length; i += 4) {
    const chunk = batch.slice(i, i + 4);
    if (DRY) { docs += chunk.length; continue; }
    try {
      const r = await upsertDocuments(db, wsId, 'chat', chunk);
      docs += r.upserted;
      console.log(`ws ${wsId.slice(0, 8)}…: +${r.upserted} transcript doc(s) (embedded=${r.embedded})`);
    } catch (e) { console.error(`ws ${wsId.slice(0, 8)}…:`, e.message); }
  }
}
console.log(`${DRY ? '[dry] would write' : 'wrote'} ${docs} transcript doc(s); ${empty} empty group(s) skipped; ${skippedNoWs} message(s) without workspace skipped`);
