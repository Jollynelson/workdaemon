// Scrub historical raw-JSON daemon messages (pre JSON-render-fix). Shared by the
// admin action in api/brain.js and scripts/scrub_raw_messages.mjs so there is one
// implementation. Recovers the real blocks from a leaked `{"blocks":...}` envelope
// (or deletes the unrecoverable). Only touches messages whose md PARSES to an
// envelope, so legitimate prose is never modified. Idempotent.

// Keep the blocks that individually parse (mirrors chat.js salvageEnvelope).
export function salvageEnvelope(text) {
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

// True only when the string IS a leaked envelope (parses to {blocks:[...]} or a
// truncated one). Plain prose — even prose mentioning "blocks" — returns false.
export function isLeakedEnvelope(s) {
  const t = String(s || '').trim().replace(/^```(?:json)?/, '').replace(/```$/, '').trim();
  if (!t.startsWith('{')) return false;
  try { const p = JSON.parse(t); return !!(p && Array.isArray(p.blocks)); }
  catch { return /"blocks"\s*:\s*\[/.test(t) && /"type"\s*:/.test(t); }
}

export function recoverEnvelope(raw) {
  const t = String(raw).trim().replace(/^```(?:json)?/, '').replace(/```$/, '').trim();
  try { const p = JSON.parse(t); if (p && Array.isArray(p.blocks)) return { blocks: p.blocks, suggestions: p.suggestions || [] }; } catch {}
  return salvageEnvelope(t);
}

// Scrub a workspace (or all, when workspaceId is null). `db` is a supabase client.
// Returns { scanned, fixed, deleted }. dryRun reports without writing.
export async function scrubDaemonMessages(db, { workspaceId = null, dryRun = false } = {}) {
  let scanned = 0, fixed = 0, deleted = 0;
  const PAGE = 1000;
  for (let from = 0; ; from += PAGE) {
    let q = db.from('daemon_messages').select('id, content').eq('role', 'daemon').range(from, from + PAGE - 1);
    if (workspaceId) q = q.eq('workspace_id', workspaceId);
    const { data: rows, error } = await q;
    if (error) throw new Error(`scrub read: ${error.message}`);
    if (!rows?.length) break;
    scanned += rows.length;
    for (const r of rows) {
      let c = null; try { c = JSON.parse(r.content); } catch {}
      let leaked = null;
      if (!c || !Array.isArray(c.blocks)) { if (isLeakedEnvelope(r.content)) leaked = r.content; }
      else { const w = (c.blocks || []).find(b => b && b.type === 'text' && isLeakedEnvelope(b.md)); if (w) leaked = w.md; }
      if (!leaked) continue;
      const env = recoverEnvelope(leaked);
      if (env && env.blocks?.length) {
        if (!dryRun) await db.from('daemon_messages').update({ content: JSON.stringify(env) }).eq('id', r.id);
        fixed++;
      } else {
        if (!dryRun) await db.from('daemon_messages').delete().eq('id', r.id);
        deleted++;
      }
    }
    if (rows.length < PAGE) break;
  }
  return { scanned, fixed, deleted, dryRun };
}
