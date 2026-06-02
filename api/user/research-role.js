import { requireAuth, adminClient } from '../_lib/supabase.js';
import { braveSearch, resolveLLM, callLLM } from '../_lib/research.js';

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/user/research-role
//
// Signup-time "learn the role" step. Researches the user's role on the open web
// (Brave), synthesises a structured role brief with an LLM, and stores it as a
// per-user daemon_memory row. Because api/chat.js already injects daemon_memory
// into the system prompt (buildMemoriesContext), the brief shapes the live
// daemon immediately — no chat.js change required.
//
// Idempotent (upserts a stable key). Degrades gracefully — no Brave key →
// model-only synthesis with web_grounded:false; no LLM key → 503.
// ─────────────────────────────────────────────────────────────────────────────

const MEMORY_KEY = 'role-brief';

function buildSynthesisPrompt({ role, industry, companyName, size, research }) {
  const sys = `You are building a concise operating brief for an AI work agent so it can act like a seasoned ${role}. `
    + `Write for the agent, not the user — it is loaded silently as background knowledge.\n`
    + `Output tight markdown, no preamble, under 1600 characters, using these exact sections:\n`
    + `**Mandate** — one sentence on what this role is accountable for.\n`
    + `**Core responsibilities** — 4-6 prose-comma items.\n`
    + `**Measured on** — the KPIs/metrics a strong ${role} is judged by.\n`
    + `**Tools & systems** — the software/frameworks they typically live in.\n`
    + `**Failure modes** — 2-3 ways this role commonly goes wrong, so the agent can watch for them.\n`
    + `**What great looks like** — one sentence.\n`
    + `Be specific and current. Tailor to the company context. Do not invent facts about THIS company; describe the role in general, grounded in the research provided.`;

  const grounding = research.grounded
    ? 'WEB RESEARCH (use as grounding):\n'
      + research.snippets.map((s, i) => `[${i + 1}] ${s.title}\n${s.description}`).join('\n\n')
    : 'No live web research available — rely on your own up-to-date knowledge of the role.';

  const user = `ROLE: ${role}\n`
    + `COMPANY: ${companyName || 'a company'}${industry ? ` (${industry})` : ''}${size ? `, team size ${size}` : ''}\n\n`
    + grounding;

  return { sys, user };
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const user = await requireAuth(req, res);
  if (!user) return;

  const db = adminClient();

  const { data: profile } = await db
    .from('profiles')
    .select('role, title, industry, workspace_id, workspaces(name, industry, size)')
    .eq('id', user.id)
    .single();

  const ws = profile?.workspaces;
  const role = (req.body?.role || profile?.role || profile?.title || '').toString().trim();
  if (!role) return res.status(400).json({ error: 'No role to research' });

  const industry = ws?.industry || profile?.industry || null;
  const workspaceId = profile?.workspace_id || null;

  const llm = await resolveLLM(workspaceId, db);
  if (!llm) return res.status(503).json({ error: 'No AI provider configured for research.' });

  // 1. Research the role on the open web.
  const query = `"${role}" responsibilities KPIs tools workflow best practices${industry ? ` in ${industry}` : ''}`;
  const research = await braveSearch(query, { count: 8 });

  // 2. Synthesise a structured role brief.
  const { sys, user: userPrompt } = buildSynthesisPrompt({
    role, industry, companyName: ws?.name, size: ws?.size, research,
  });

  let brief;
  try {
    brief = (await callLLM(llm, sys, userPrompt)).trim();
  } catch (e) {
    console.error('[research-role] synthesis error:', e.message);
    return res.status(502).json({ error: e.message || 'Role research failed' });
  }
  if (!brief) return res.status(502).json({ error: 'Empty role brief' });

  // 3. Store as a per-user memory the live daemon already injects.
  const { error: memErr } = await db.from('daemon_memory').upsert({
    user_id:      user.id,
    workspace_id: workspaceId,
    key:          MEMORY_KEY,
    value:        `Role playbook for ${role}${research.grounded ? ' (web-researched)' : ''} — ${brief}`.slice(0, 4000),
    memory_type:  'role_brief',
    updated_at:   new Date().toISOString(),
  }, { onConflict: 'user_id,key' });

  if (memErr) {
    console.error('[research-role] store error:', memErr.message);
    return res.status(500).json({ error: 'Failed to store role brief' });
  }

  console.log('[research-role] role="%s" grounded=%s sources=%d', role, research.grounded, research.sources.length);
  return res.status(200).json({ ok: true, role, web_grounded: research.grounded, sources: research.sources, brief });
}
