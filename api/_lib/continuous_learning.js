// Continuous self-teaching — the brain proactively researches each ROLE's evolving
// best practices, new tools, and better ways to work, and distills them into the
// skill library. So the brain and daemons keep getting smarter about the OUTSIDE
// world, not just the company's own data. Recording learned knowledge is AUTO-tier
// (safe/internal). Round-robin + interval-gated so it's cheap and never spammy.
import { braveSearch, resolveLLM, callLLM, extractJson } from './research.js';
import { signalsSince } from './learning.js';
import { recordObservation, tierFor } from './autonomy.js';

// AUTO-equip: attach a self-taught skill to the daemons of everyone in that role —
// additive + reversible, so it's safe to self-execute (gated by tierFor). Deduped.
async function equipRoleDaemons(db, workspaceId, role, skillSlug) {
  if (tierFor('equip_learned_skill') !== 'auto') return 0;
  const { data: members } = await db.from('workspace_members').select('user_id').eq('workspace_id', workspaceId);
  const ids = (members || []).map(m => m.user_id);
  if (!ids.length) return 0;
  const { data: profs } = await db.from('profiles').select('id, role, title').in('id', ids);
  const inRole = (profs || []).filter(p => (p.role || p.title || '').trim().toLowerCase() === role.trim().toLowerCase());
  let equipped = 0;
  for (const p of inRole) {
    const { data: have } = await db.from('daemon_skills').select('id')
      .eq('user_id', p.id).eq('skill_slug', skillSlug).limit(1).maybeSingle();
    if (have) continue;
    const { error } = await db.from('daemon_skills').insert({
      workspace_id: workspaceId, user_id: p.id, skill_slug: skillSlug,
      reason: 'self-taught by the brain for your role', assigned_by: 'brain',
    });
    if (!error) equipped++;
  }
  return equipped;
}

const slugify = (s) => String(s || '').toLowerCase().trim()
  .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60);
const daysAgoISO = (n) => new Date(Date.now() - n * 86400000).toISOString();

// DEFAULT research: current (past-month) best practices + new tools for the role.
async function defaultResearch(role) {
  const year = new Date().getFullYear();
  const queries = [`${role} best practices ${year}`, `new tools and techniques for ${role}`];
  const out = [];
  for (const q of queries) {
    const r = await braveSearch(q, { count: 5, freshness: 'pm' });
    out.push(...(r.snippets || []));
  }
  return out;
}

// DEFAULT distill: turn the research into up to 2 reusable, CURRENT best-practice
// skills (generic to the craft, not company-specific).
async function defaultDistill(db, workspaceId, role, corpus) {
  const llm = await resolveLLM(workspaceId, db);
  if (!llm) return [];
  const sys = 'You distill web research into reusable agent skills (concrete playbooks). Return ONLY JSON. No fluff.';
  const user = `From this research on how great ${role}s work today, write up to 2 reusable, CURRENT best-practice skills (new tools / techniques / ways of working). Generic to the craft, not company-specific.
RESEARCH:\n${corpus}\n
Return JSON array: [{"name":"short skill name","trigger_description":"when to use it (one sentence)","body":"4-6 line actionable playbook grounded in the research","tags":["..."],"pillar":"skills|content|research|growth|productivity|knowledge|devops","source_idx":the [i] of the most useful source}]`;
  return extractJson(await callLLM(llm, sys, user, { maxTokens: 900 })) || [];
}

// Research + distill best practices for ONE role into brain_skills (deduped).
// research/distill are injectable for tests.
export async function learnForRole(db, workspaceId, role, opts = {}) {
  const research = opts.research || defaultResearch;
  const distill = opts.distill || ((corpus) => defaultDistill(db, workspaceId, role, corpus));

  const snippets = await research(role);
  if (!snippets || !snippets.length) {
    await recordObservation(db, workspaceId, { domain: 'role_learning', subjectType: 'role', subjectId: role, signal: 'none', value: 0 });
    return { role, learned: 0, skills: [] };
  }
  const corpus = snippets.map((s, i) => `[${i}] ${s.title}\n${s.description}\n${s.url}`).join('\n\n');
  const items = await distill(corpus);

  const added = [];
  for (const j of (items || []).slice(0, 2)) {
    if (!j?.name || !j?.body) continue;
    const slug = slugify(j.name);
    if (!slug) continue;
    const { data: dupe } = await db.from('brain_skills').select('id')
      .eq('slug', slug).or(`workspace_id.is.null,workspace_id.eq.${workspaceId}`).limit(1).maybeSingle();
    if (dupe) continue;
    const src = snippets[j.source_idx]?.url || snippets[0]?.url || null;
    const { error } = await db.from('brain_skills').insert({
      workspace_id: workspaceId, slug, name: j.name, pillar: j.pillar || 'skills', category: 'role_learning',
      trigger_description: j.trigger_description || j.name, body: j.body,
      tags: [...(Array.isArray(j.tags) ? j.tags.slice(0, 6) : []), `role:${role}`], source_url: src,
      learned_from: 'self_taught', confidence: 0.5,
    });
    if (!error) added.push({ slug, name: j.name });
  }
  // AUTO-equip the role's daemons with what was just learned (the brain upgrading
  // its own workforce — additive/reversible, gated by tierFor).
  let equipped = 0;
  for (const a of added) equipped += await equipRoleDaemons(db, workspaceId, role, a.slug);
  await recordObservation(db, workspaceId, {
    domain: 'role_learning', subjectType: 'role', subjectId: role,
    signal: added.length ? 'learned' : 'none', value: added.length, meta: { skills: added.map(a => a.slug), equipped },
  });
  return { role, learned: added.length, skills: added.map(a => a.name), equipped };
}

// Distinct roles in the workspace (from profiles.role/title).
async function workspaceRoles(db, workspaceId) {
  const { data: members } = await db.from('workspace_members').select('user_id').eq('workspace_id', workspaceId);
  const ids = (members || []).map(m => m.user_id);
  if (!ids.length) return [];
  const { data: profs } = await db.from('profiles').select('role, title').in('id', ids);
  const roles = new Set();
  for (const p of profs || []) { const r = (p.role || p.title || '').trim(); if (r) roles.add(r); }
  return [...roles];
}

// The stalest role not taught within intervalDays — or null if every role is fresh
// (skip, so it's never spammy and the web/LLM cost is bounded).
export async function pickRoleToLearn(db, workspaceId, { intervalDays = 5 } = {}) {
  const roles = await workspaceRoles(db, workspaceId);
  if (!roles.length) return null;
  const signals = await signalsSince(db, { workspaceId, domain: 'role_learning', subjectType: 'role', limit: 500 });
  const lastByRole = {};   // signals are created_at DESC → first seen per role is latest
  for (const s of signals || []) { const r = s.subject_id; if (r && !(r in lastByRole)) lastByRole[r] = s.created_at; }
  const cutoff = daysAgoISO(intervalDays);
  const due = roles.filter(r => !lastByRole[r] || lastByRole[r] < cutoff);
  if (!due.length) return null;
  due.sort((a, b) => (lastByRole[a] || '') < (lastByRole[b] || '') ? -1 : 1);   // never-learned (oldest) first
  return due[0];
}

// One role per call (round-robin via pickRoleToLearn); {ran:false} when all are fresh.
export async function runContinuousLearning(db, workspaceId, opts = {}) {
  const role = await pickRoleToLearn(db, workspaceId, opts);
  if (!role) return { ran: false };
  const res = await learnForRole(db, workspaceId, role, opts);
  return { ran: true, ...res };
}
