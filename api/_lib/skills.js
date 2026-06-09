// Brain Skill Library access — the "Skills" pillar. The brain HOLDS skills and
// PASSES them to daemons at runtime: relevantSkills() ranks global + workspace
// skills for a task, renderSkillsBlock() formats them for prompt injection, and
// learnSkillFromAction() distills NEW skills from approved work (self-improvement).
// Provider-agnostic: feeds the in-app DeepSeek daemons AND the Hermes agent (MCP).
import { resolveLLM, callLLM, extractJson, braveSearch } from './research.js';
import { recordSignal } from './learning.js';

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

// ── AUTONOMOUS SKILL DISCOVERY ───────────────────────────────────────────────
// The brain finds + learns NEW skills from the web on its own: identify the
// capability gaps for this company, search the web for how to do them well,
// distill each into a SKILL.md-style skill grounded in real sources. Discovered
// skills are workspace-scoped, badged 'discovered' + lower confidence so humans
// can see (and prune) what the brain taught itself.
const DISCOVERY_COOLDOWN_DAYS = 3;

// Has this workspace discovered a skill recently? (rate-limit autonomous runs.)
async function discoveredRecently(db, workspaceId, days = DISCOVERY_COOLDOWN_DAYS) {
  const since = new Date(Date.now() - days * 864e5).toISOString();
  const { data } = await db.from('brain_skills').select('id')
    .eq('workspace_id', workspaceId).eq('learned_from', 'discovered').gte('created_at', since).limit(1);
  return (data || []).length > 0;
}

export async function discoverSkills(db, { workspaceId, llm = null, max = 3, force = false } = {}) {
  if (!force && await discoveredRecently(db, workspaceId)) return { ran: false, reason: 'cooldown', added: [] };
  llm = llm || await resolveLLM(workspaceId, db);
  if (!llm) return { ran: false, reason: 'no_llm', added: [] };

  // 1. What does this company need? Use its context + objectives + current library.
  const [{ data: ws }, { data: agents }, { data: have }] = await Promise.all([
    db.from('workspaces').select('name, industry, context').eq('id', workspaceId).single(),
    db.from('agents').select('objective').eq('workspace_id', workspaceId).limit(10),
    db.from('brain_skills').select('name,slug').or(`workspace_id.is.null,workspace_id.eq.${workspaceId}`).limit(200),
  ]);
  const ctx = ws?.context && typeof ws.context === 'object'
    ? Object.entries(ws.context).filter(([, v]) => v && typeof v === 'string').map(([k, v]) => `${k}: ${v}`).join('\n') : '';
  const objectives = (agents || []).map(a => a.objective).filter(Boolean).join(' · ');
  const haveList = (have || []).map(s => s.name).join(', ');

  const gapSys = 'You identify the highest-leverage agent SKILLS a company is missing. A skill is a reusable capability/playbook (e.g. "cohort retention analysis", "PLG onboarding teardown"). Return ONLY JSON.';
  const gapUser = `Company: ${ws?.name || ''} (${ws?.industry || ''})
Context:\n${ctx || '(none)'}
Daemon missions: ${objectives || '(none)'}
Skills already in the library: ${haveList || '(none)'}

Name up to ${max} skills this company's daemons are MISSING that would most improve their work — capabilities NOT already covered above. For each, give a web search query that would surface how to do it well.
Return JSON {"gaps":[{"skill":"short skill name","why":"one line","query":"a search query to learn it"}]}.`;
  const gapTxt = await callLLM(llm, gapSys, gapUser, { maxTokens: 700 });
  const gaps = (extractJson(gapTxt)?.gaps || []).slice(0, max);
  if (!gaps.length) return { ran: true, added: [], reason: 'no_gaps' };

  const added = [];
  for (const g of gaps) {
    try {
      // 2. Go online: search for how to do this skill well.
      const res = await braveSearch(g.query || g.skill, { count: 6 });
      if (!res.snippets.length) continue;
      const corpus = res.snippets.map((s, i) => `[${i}] ${s.title}\n${s.description}\n${s.url}`).join('\n\n');

      // 3. Distill a grounded, reusable skill from what it found.
      const sys = 'You write agent skills (SKILL.md playbooks) grounded in web research. Return ONLY JSON. No fluff — a concrete, reusable playbook.';
      const user = `Turn the best of this research into ONE reusable skill for "${g.skill}".
RESEARCH:\n${corpus}\n
Return JSON {"name":"short skill name","trigger_description":"when to use it (one sentence)","body":"4-6 line actionable playbook grounded in the research","tags":["..."],"pillar":"skills|content|research|growth|productivity|knowledge|devops|memory","source_idx":the [i] of the most useful source}.`;
      const txt = await callLLM(llm, sys, user, { maxTokens: 700 });
      const j = extractJson(txt);
      if (!j?.name || !j.body) continue;
      const slug = slugify(j.name);
      if (!slug) continue;

      // 4. Dedupe (global or workspace already has it).
      const { data: dupe } = await db.from('brain_skills').select('id')
        .eq('slug', slug).or(`workspace_id.is.null,workspace_id.eq.${workspaceId}`).limit(1).maybeSingle();
      if (dupe) continue;

      const src = res.snippets[j.source_idx]?.url || res.snippets[0]?.url || g.query || null;
      const { error } = await db.from('brain_skills').insert({
        workspace_id: workspaceId, slug, name: j.name, pillar: j.pillar || 'skills', category: 'discovered',
        trigger_description: j.trigger_description || j.name, body: j.body,
        tags: Array.isArray(j.tags) ? j.tags.slice(0, 8) : [], source_url: src,
        learned_from: 'discovered', confidence: 0.5,
      });
      if (!error) added.push({ slug, name: j.name, source_url: src });
    } catch (e) { console.warn('[skills] discover gap failed:', e.message); }
  }
  if (added.length) {
    await recordSignal(db, { workspaceId, domain: 'agent', subjectType: 'skill_discovery', subjectId: workspaceId,
      signal: 'discovered', value: added.length, meta: { slugs: added.map(a => a.slug) } }).catch(() => {});
  }
  return { ran: true, added };
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
