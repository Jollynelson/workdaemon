#!/usr/bin/env node
// Scrub historical raw-JSON daemon messages across ALL companies.
//
// Before the JSON-render fix (api/chat.js: JSON output mode + salvageEnvelope),
// a malformed model response was stored as a text block whose `md` was the raw
// `{"blocks":...}` envelope (or the whole content failed to parse) — rendering as
// a wall of JSON in chat history. This recovers the real blocks from those
// messages (or deletes the unrecoverable ones).
//
//   node scripts/scrub_raw_messages.mjs --dry   # preview only (no writes)
//   node scripts/scrub_raw_messages.mjs         # recover/delete
//
// Idempotent and safe to re-run. Only touches role='daemon' messages whose `md`
// PARSES to an envelope (a leaked `{...,"blocks":[...]}`), so legitimate prose —
// even prose that mentions JSON — is never modified.
import { readFileSync } from 'fs';
import pg from 'pg';

const DRY = process.argv.includes('--dry');
const env = Object.fromEntries(readFileSync('.env', 'utf8').split('\n')
  .filter(l => l && !l.startsWith('#') && l.includes('='))
  .map(l => { const i = l.indexOf('='); return [l.slice(0, i), l.slice(i + 1).replace(/^["']|["']$/g, '')]; }));

// Mirrors api/chat.js salvageEnvelope: keep blocks that individually parse.
function salvage(text) {
  const bi = text.indexOf('"blocks"'); if (bi === -1) return null;
  const a = text.indexOf('[', bi); if (a === -1) return null;
  const blocks = []; let d = 0, os = -1, s = false, e = false;
  for (let i = a + 1; i < text.length; i++) {
    const c = text[i];
    if (s) { if (e) e = false; else if (c === '\\') e = true; else if (c === '"') s = false; continue; }
    if (c === '"') { s = true; continue; }
    if (c === '{') { if (d === 0) os = i; d++; }
    else if (c === '}') { d--; if (d === 0 && os !== -1) { try { const o = JSON.parse(text.slice(os, i + 1)); if (o && o.type) blocks.push(o); } catch {} os = -1; } }
    else if (c === ']' && d === 0) break;
  }
  if (!blocks.length) return null;
  let sg = []; const m = text.match(/"suggestions"\s*:\s*\[([^\]]*)\]/);
  if (m) { try { sg = JSON.parse('[' + m[1] + ']').filter(x => typeof x === 'string'); } catch {} }
  return { blocks, suggestions: sg };
}

// True only when the string IS a leaked envelope (parses to {blocks:[...]} or is a
// truncated one). Plain prose — even with the word "blocks" — returns false.
function isLeakedEnvelope(s) {
  const t = String(s || '').trim().replace(/^```(?:json)?/, '').replace(/```$/, '').trim();
  if (!t.startsWith('{')) return false;
  try { const p = JSON.parse(t); return !!(p && Array.isArray(p.blocks)); }
  catch { return /"blocks"\s*:\s*\[/.test(t) && /"type"\s*:/.test(t); }
}

function recover(raw) {
  const t = String(raw).trim().replace(/^```(?:json)?/, '').replace(/```$/, '').trim();
  try { const p = JSON.parse(t); if (p && Array.isArray(p.blocks)) return { blocks: p.blocks, suggestions: p.suggestions || [] }; } catch {}
  return salvage(t);
}

const db = new pg.Client({ connectionString: env.DATABASE_URL_UNPOOLED || env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
await db.connect();
const { rows } = await db.query(`select id, content from daemon_messages where role='daemon'`);

let fixed = 0, deleted = 0, scanned = rows.length;
for (const r of rows) {
  let c = null; try { c = JSON.parse(r.content); } catch {}
  let leaked = null;                                   // the raw envelope string to recover from
  if (!c || !Array.isArray(c.blocks)) { if (isLeakedEnvelope(r.content)) leaked = r.content; }
  else { const w = (c.blocks || []).find(b => b && b.type === 'text' && isLeakedEnvelope(b.md)); if (w) leaked = w.md; }
  if (!leaked) continue;

  const env2 = recover(leaked);
  if (env2 && env2.blocks?.length) {
    if (!DRY) await db.query('update daemon_messages set content=$1 where id=$2', [JSON.stringify(env2), r.id]);
    fixed++; console.log(`${DRY ? '[dry] would recover' : 'recovered'} ${r.id.slice(0, 8)} → ${env2.blocks.map(b => b.type).join(',')}`);
  } else {
    if (!DRY) await db.query('delete from daemon_messages where id=$1', [r.id]);
    deleted++; console.log(`${DRY ? '[dry] would delete' : 'deleted'} ${r.id.slice(0, 8)} (unrecoverable)`);
  }
}
await db.end();
console.log(`\nScanned ${scanned} daemon messages — ${fixed} ${DRY ? 'recoverable' : 'recovered'}, ${deleted} ${DRY ? 'unrecoverable' : 'deleted'}.`);
