// Brain Skill Library access — the "Skills" pillar. The brain HOLDS skills and
// PASSES them to daemons at runtime: relevantSkills() ranks global + workspace
// skills for a task, renderSkillsBlock() formats them for prompt injection, and
// learnSkillFromAction() distills NEW skills from approved work (self-improvement).
// Provider-agnostic: feeds the in-app DeepSeek daemons AND the Hermes agent (MCP).
import { resolveLLM, callLLM, extractJson } from './research.js';

const STOP = new Set(['the','a','an','and','or','for','to','of','in','on','with','your','our','this','that','is','are','be','it','as','at','by','from','about']);
function tokens(s) {
  return new Set(String(s || '').toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter(w => w.length > 2 && !STOP.has(w)));
}

// Core skills every daemon should always carry (operating discipline + grounding).
const ALWAYS = ['brain-grounding', 'reflexion-self-review', 'verification-gates', 'soul-consistency', 'approval-first-safety'];

// Rank global + workspace skills for an objective; always include the core few.
export async function relevantSkills(db, { workspaceId, objective = '', tags = [], limit = 7 }) {
  const { data } = await db.from('brain_skills')
    .select('slug,name,pillar,category,trigger_description,body,tags,workspace_id,confidence')
    .eq('status', 'active')
    .or(`workspace_id.is.null,workspace_id.eq.${workspaceId}`)
    .limit(200);
  const all = data || [];
  if (!all.length) return [];
  const need = tokens(objective + ' ' + tags.join(' '));
  const scored = all.map(s => {
    const hay = tokens(`${s.name} ${s.trigger_description} ${s.category} ${(s.tags || []).join(' ')}`);
    let overlap = 0; for (const t of need) if (hay.has(t)) overlap++;
    const wsBoost = s.workspace_id ? 0.5 : 0;        // prefer the company's own learned skills
    const core = ALWAYS.includes(s.slug) ? 100 : 0;  // pin core operating skills to the top
    return { s, score: core + overlap + wsBoost + Number(s.confidence || 0) * 0.1 };
  });
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, limit).map(x => x.s);
}

export function renderSkillsBlock(skills) {
  if (!skills?.length) return '';
  const lines = skills.map(s => `• ${s.name} — ${s.trigger_description}\n  ${s.body}`);
  return `\n\nSKILLS YOU'VE LEARNED (apply the relevant ones; they are how this company's daemons operate):\n${lines.join('\n')}`;
}

// Mark skills as used (cheap signal for ranking/curation).
export async function bumpSkillUsage(db, slugs, workspaceId) {
  if (!slugs?.length) return;
  try {
    const { data } = await db.from('brain_skills').select('id,usage_count').in('slug', slugs).or(`workspace_id.is.null,workspace_id.eq.${workspaceId}`);
    for (const r of data || []) await db.from('brain_skills').update({ usage_count: (r.usage_count || 0) + 1 }).eq('id', r.id);
  } catch { /* non-critical */ }
}

const slugify = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60);

// SELF-IMPROVEMENT: distill a reusable, workspace-scoped skill from an approved /
// edited daemon action. Gated + deduped so the library compounds without bloat.
export async function learnSkillFromAction(db, { workspaceId, action, wasEdited, userId }) {
  try {
    const llm = await resolveLLM(workspaceId, db);
    if (!llm) return null;
    const sys = 'You curate an agent skill library. Decide if this approved action contains a REUSABLE lesson worth saving as a skill. Most do NOT — be strict. Return ONLY JSON.';
    const user = `An autonomous daemon proposed this action and a human ${wasEdited ? 'edited then approved' : 'approved'} it:
Type: ${action.type}
Title: ${action.title}
Body: ${(action.body || '').slice(0, 800)}
Rationale: ${action.rationale || ''}

Save it ONLY if it implies a REPEATABLE play this company could reuse next time (a one-off fact is NOT a skill; a reusable sequence/approach IS — even if company-specific). If yes, generalize the pattern and return:
{"worth_saving": true, "name": "short skill name", "trigger_description": "when to use it (one sentence)", "body": "3-5 line reusable playbook", "tags": ["..."], "pillar": "skills|content|research|growth|productivity|knowledge|ops"}
Otherwise return {"worth_saving": false}.`;
    const txt = await callLLM(llm, sys, user, { maxTokens: 500 });
    const j = extractJson(txt);
    if (!j?.worth_saving || !j.name || !j.body) return null;
    const slug = slugify(j.name);
    if (!slug) return null;
    const { data: existing } = await db.from('brain_skills').select('id,usage_count').eq('workspace_id', workspaceId).eq('slug', slug).maybeSingle();
    const row = {
      workspace_id: workspaceId, slug, name: j.name, pillar: j.pillar || 'skills', category: 'learned',
      trigger_description: j.trigger_description || j.name, body: j.body,
      tags: Array.isArray(j.tags) ? j.tags.slice(0, 8) : [], learned_from: 'experience',
      confidence: 0.6, created_by: userId || null, updated_at: new Date().toISOString(),
    };
    if (existing?.id) { await db.from('brain_skills').update({ ...row, confidence: 0.7 }).eq('id', existing.id); return { slug, updated: true }; }
    const { error } = await db.from('brain_skills').insert(row);
    return error ? null : { slug, created: true };
  } catch (e) {
    console.warn('[skills] learnSkillFromAction failed:', e.message);
    return null;
  }
}

// MCP surface helpers (read-only) — the Hermes agent pulls skills from the brain.
export async function listSkills(db, workspaceId, { pillar = null } = {}) {
  let q = db.from('brain_skills').select('slug,name,pillar,category,trigger_description,tags,learned_from')
    .eq('status', 'active').or(`workspace_id.is.null,workspace_id.eq.${workspaceId}`).order('pillar');
  if (pillar) q = q.eq('pillar', pillar);
  const { data } = await q.limit(200);
  return data || [];
}
export async function getSkill(db, workspaceId, slug) {
  const { data } = await db.from('brain_skills')
    .select('slug,name,pillar,category,trigger_description,body,tags,source_url,learned_from')
    .eq('slug', slug).or(`workspace_id.is.null,workspace_id.eq.${workspaceId}`).order('workspace_id', { nullsFirst: false }).limit(1).maybeSingle();
  return data || null;
}
