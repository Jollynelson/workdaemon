import { braveSearchMany, resolveLLM, callLLM, extractJson } from './research.js';

// ─────────────────────────────────────────────────────────────────────────────
// Research actions, invoked from api/brain.js as POST actions (research_role,
// research_company). Kept in _lib so they add ZERO serverless functions — the
// Hobby plan caps a deployment at 12 functions and api/ is already at the cap.
// Each returns { status, body } for the caller to send.
// ─────────────────────────────────────────────────────────────────────────────

const ROLE_MEMORY_KEY = 'role-brief';
const NOTE_OPEN = '<!--auto-market-intel-->';
const NOTE_CLOSE = '<!--/auto-market-intel-->';

// ── Per-user: research the role → daemon_memory row ───────────────────────────
function buildRolePrompt({ role, industry, companyName, size, research }) {
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

export async function researchRole(db, userId, body = {}) {
  const { data: profile } = await db
    .from('profiles')
    .select('role, title, industry, workspace_id, workspaces(name, industry, size)')
    .eq('id', userId)
    .single();

  const ws = profile?.workspaces;
  const role = (body.role || profile?.role || profile?.title || '').toString().trim();
  if (!role) return { status: 400, body: { error: 'No role to research' } };

  const industry = ws?.industry || profile?.industry || null;
  const workspaceId = profile?.workspace_id || null;

  const llm = await resolveLLM(workspaceId, db);
  if (!llm) return { status: 503, body: { error: 'No AI provider configured for research.' } };

  // Several simple queries beat one long exact-phrase query (quotes returned 0).
  const queries = [
    `${role} role responsibilities and KPIs`,
    `${role} tools workflow best practices${industry ? ` ${industry}` : ''}`,
  ];
  const research = await braveSearchMany(queries, { count: 6 });

  const { sys, user: userPrompt } = buildRolePrompt({
    role, industry, companyName: ws?.name, size: ws?.size, research,
  });

  let brief;
  try {
    brief = (await callLLM(llm, sys, userPrompt)).trim();
  } catch (e) {
    console.error('[research_role] synthesis error:', e.message);
    return { status: 502, body: { error: e.message || 'Role research failed' } };
  }
  if (!brief) return { status: 502, body: { error: 'Empty role brief' } };

  const { error: memErr } = await db.from('daemon_memory').upsert({
    user_id:      userId,
    workspace_id: workspaceId,
    key:          ROLE_MEMORY_KEY,
    value:        `Role playbook for ${role}${research.grounded ? ' (web-researched)' : ''} — ${brief}`.slice(0, 4000),
    memory_type:  'role_brief',
    updated_at:   new Date().toISOString(),
  }, { onConflict: 'user_id,key' });

  if (memErr) {
    console.error('[research_role] store error:', memErr.message);
    return { status: 500, body: { error: 'Failed to store role brief' } };
  }

  console.log('[research_role] role="%s" grounded=%s sources=%d', role, research.grounded, research.sources.length);
  return { status: 200, body: { ok: true, role, web_grounded: research.grounded, sources: research.sources, brief } };
}

// ── Workspace: research company + competitors → context + hunt_findings ───────
function buildCompanyPrompt({ company, industry, location, existingDesc, research }) {
  const sys = `You are a market-intelligence analyst building a briefing for an AI work agent that advises staff at "${company}". `
    + `Use the web research provided as your primary source; if it is thin, use your own knowledge but never fabricate specific events or dates.\n`
    + `Return ONE JSON object, no prose, no code fence, with this exact shape:\n`
    + `{\n`
    + `  "company_summary": "1-2 sentences on what the company does and its market position",\n`
    + `  "location": "HQ / primary market, or null",\n`
    + `  "competitors": ["direct competitor names", "..."],\n`
    + `  "positioning": "one sentence on where this company sits vs competitors",\n`
    + `  "industry_trends": "1-2 sentences on current ${industry || 'industry'} trends that matter",\n`
    + `  "findings": [\n`
    + `    {"mode":"opportunity|threat","headline":"specific, recent competitor/market move","severity":"info|warning|critical","recommendation":"concrete action this company should take"}\n`
    + `  ]\n`
    + `}\n`
    + `findings: 0-5 items, each a SPECIFIC and RECENT event (a competitor launch, raise, price change, hire, outage, regulation). `
    + `Phrase headlines so an agent can say them aloud, e.g. "Competitor Acme launched an AI tier last week". Skip vague items.`;

  const grounding = research.grounded
    ? 'WEB RESEARCH:\n' + research.snippets.map((s, i) =>
        `[${i + 1}] ${s.title}${s.age ? ` (${s.age})` : ''}\n${s.description}\n${s.url}`).join('\n\n')
    : 'No live web research available — use your own knowledge; keep findings general and do not invent dated events.';

  const user = `COMPANY: ${company}\n`
    + `INDUSTRY: ${industry || 'unspecified'}\n`
    + `LOCATION: ${location || 'unspecified'}\n`
    + (existingDesc ? `KNOWN DESCRIPTION: ${existingDesc}\n` : '')
    + `\n${grounding}`;

  return { sys, user };
}

function mergeNotes(existingNotes, autoBlock) {
  const base = (existingNotes || '').replace(
    new RegExp(`\\s*${NOTE_OPEN}[\\s\\S]*?${NOTE_CLOSE}`, 'g'), ''
  ).trim();
  const block = `${NOTE_OPEN}\n${autoBlock}\n${NOTE_CLOSE}`;
  return base ? `${base}\n\n${block}` : block;
}

export async function researchCompany(db, workspaceId, ws, body = {}) {
  const company = (body.company || ws?.name || '').toString().trim();
  if (!company) return { status: 400, body: { error: 'No company name to research' } };
  const industry = ws?.industry || body.industry || null;
  const existingCtx = (ws?.context && typeof ws.context === 'object') ? ws.context : {};
  const location = body.location || existingCtx.location || null;

  const llm = await resolveLLM(workspaceId, db);
  if (!llm) return { status: 503, body: { error: 'No AI provider configured for research.' } };

  const queries = [
    `"${company}" competitors${industry ? ` ${industry}` : ''}`,
    `${company}${industry ? ` ${industry}` : ''} news`,
    `top ${industry || 'companies'}${location ? ` ${location}` : ''} competitors`,
    `${industry || company} trends 2026`,
  ];
  const research = await braveSearchMany(queries, { count: 6, freshness: 'py' });

  const { sys, user: userPrompt } = buildCompanyPrompt({
    company, industry, location, existingDesc: existingCtx.description, research,
  });

  let intel;
  try {
    intel = extractJson(await callLLM(llm, sys, userPrompt, { maxTokens: 1500 }));
  } catch (e) {
    console.error('[research_company] synthesis error:', e.message);
    return { status: 502, body: { error: e.message || 'Company research failed' } };
  }
  if (!intel) return { status: 502, body: { error: 'Could not parse research output' } };

  const competitors = Array.isArray(intel.competitors) ? intel.competitors.filter(Boolean) : [];

  const autoBlock = [
    intel.company_summary && `Market summary: ${intel.company_summary}`,
    intel.positioning && `Positioning: ${intel.positioning}`,
    competitors.length && `Competitors: ${competitors.join(', ')}`,
    intel.industry_trends && `Industry trends: ${intel.industry_trends}`,
    intel.location && `Location: ${intel.location}`,
    `(auto-researched ${new Date().toISOString().slice(0, 10)})`,
  ].filter(Boolean).join('\n');

  const newCtx = {
    ...existingCtx,
    competitors: existingCtx.competitors || competitors.join(', ') || existingCtx.competitors,
    location:    existingCtx.location || intel.location || null,
    notes:       mergeNotes(existingCtx.notes, autoBlock),
    market_intel: {
      summary: intel.company_summary || null,
      positioning: intel.positioning || null,
      competitors,
      industry_trends: intel.industry_trends || null,
      location: intel.location || null,
      researched_at: new Date().toISOString(),
      web_grounded: research.grounded,
    },
  };

  const { error: ctxErr } = await db.from('workspaces').update({ context: newCtx }).eq('id', workspaceId);
  if (ctxErr) {
    console.error('[research_company] context save error:', ctxErr.message);
    return { status: 500, body: { error: 'Failed to save company context' } };
  }

  const rawFindings = Array.isArray(intel.findings) ? intel.findings : [];
  let insertedFindings = 0;
  let findingsError = null;          // first insert error, logged server-side
  for (const f of rawFindings.slice(0, 5)) {
    const headline = (f.headline || '').toString().trim();
    if (!headline) continue;
    const mode = ['opportunity', 'threat'].includes(f.mode) ? f.mode : 'opportunity';
    const severity = ['info', 'warning', 'critical'].includes(f.severity) ? f.severity : 'info';

    const probe = headline.slice(0, 40).replace(/[%_]/g, ' ');
    const { data: existing } = await db
      .from('hunt_findings')
      .select('id')
      .eq('workspace_id', workspaceId)
      .eq('hunt_mode', mode)
      .ilike('pattern', `%${probe}%`)
      .eq('resolved', false)
      .limit(1);
    if (existing?.length) continue;

    const { error: findErr } = await db.from('hunt_findings').insert({
      workspace_id:   workspaceId,
      hunt_mode:      mode,
      pattern:        headline,
      occurrences:    1,
      affected_roles: [],
      severity,
      recommendation: f.recommendation || null,
    });
    if (!findErr) insertedFindings++;
    else if (!findingsError) { findingsError = findErr.message; console.error('[research_company] finding insert error:', findErr.message); }
  }

  console.log('[research_company] company="%s" grounded=%s competitors=%d findings=%d/%d',
    company, research.grounded, competitors.length, insertedFindings, rawFindings.length);

  return {
    status: 200,
    body: {
      ok: true, company, web_grounded: research.grounded, sources: research.sources,
      competitors, findings_created: insertedFindings, intel,
    },
  };
}
