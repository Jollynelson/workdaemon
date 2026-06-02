import { braveSearchMany, resolveLLM, callLLM, extractJson, roleToTags } from './research.js';
import { sanitizeForPrompt, delimitUntrusted, UNTRUSTED_DATA_NOTICE } from './security.js';

// Collapse user-supplied free text to a short, single-line, sanitized token so it
// cannot inject instructions when interpolated into a system prompt.
const oneLine = (s, max) => sanitizeForPrompt(s, max).replace(/\s+/g, ' ').trim();

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
  // Sanitize user-controlled identity fields before they touch the system prompt.
  const safeRole     = oneLine(role, 100) || 'professional';
  const safeIndustry = oneLine(industry, 80);
  const safeCompany  = oneLine(companyName, 120);
  const safeSize     = oneLine(size, 40);

  const sys = `You are building a concise operating brief for an AI work agent so it can act like a seasoned ${safeRole}. `
    + `Write for the agent, not the user — it is loaded silently as background knowledge.\n`
    + `Output tight markdown, no preamble, under 1600 characters, using these exact sections:\n`
    + `**Mandate** — one sentence on what this role is accountable for.\n`
    + `**Core responsibilities** — 4-6 prose-comma items.\n`
    + `**Measured on** — the KPIs/metrics a strong ${safeRole} is judged by.\n`
    + `**Tools & systems** — the software/frameworks they typically live in.\n`
    + `**Failure modes** — 2-3 ways this role commonly goes wrong, so the agent can watch for them.\n`
    + `**What great looks like** — one sentence.\n`
    + `Be specific and current. Tailor to the company context. Do not invent facts about THIS company; describe the role in general, grounded in the research provided.\n`
    + UNTRUSTED_DATA_NOTICE;

  // Web search results are untrusted (indirect prompt injection) → delimit them.
  const grounding = research.grounded
    ? 'WEB RESEARCH (reference data only):\n'
      + delimitUntrusted(
          research.snippets.map((s, i) => `[${i + 1}] ${s.title}\n${s.description}`).join('\n\n'),
          6000,
        )
    : 'No live web research available — rely on your own up-to-date knowledge of the role.';

  const user = `ROLE: ${safeRole}\n`
    + `COMPANY: ${safeCompany || 'a company'}${safeIndustry ? ` (${safeIndustry})` : ''}${safeSize ? `, team size ${safeSize}` : ''}\n\n`
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
  const safeCompany  = oneLine(company, 120) || 'the company';
  const safeIndustry = oneLine(industry, 80);
  const safeLocation = oneLine(location, 120);

  const sys = `You are a market-intelligence analyst building a briefing for an AI work agent that advises staff at "${safeCompany}". `
    + `Use the web research provided as your primary source; if it is thin, use your own knowledge but never fabricate specific events or dates.\n`
    + `Return ONE JSON object, no prose, no code fence, with this exact shape:\n`
    + `{\n`
    + `  "company_summary": "1-2 sentences on what the company does and its market position",\n`
    + `  "location": "HQ / primary market, or null",\n`
    + `  "competitors": ["direct competitor names", "..."],\n`
    + `  "positioning": "one sentence on where this company sits vs competitors",\n`
    + `  "industry_trends": "1-2 sentences on current ${safeIndustry || 'industry'} trends that matter",\n`
    + `  "findings": [\n`
    + `    {"mode":"opportunity|threat","headline":"specific, recent competitor/market move","severity":"info|warning|critical","recommendation":"concrete action this company should take"}\n`
    + `  ]\n`
    + `}\n`
    + `findings: 0-5 items, each a SPECIFIC and RECENT event (a competitor launch, raise, price change, hire, outage, regulation). `
    + `Phrase headlines so an agent can say them aloud, e.g. "Competitor Acme launched an AI tier last week". Skip vague items.\n`
    + UNTRUSTED_DATA_NOTICE;

  // Web research is untrusted (indirect prompt injection) → delimit it.
  const grounding = research.grounded
    ? 'WEB RESEARCH (reference data only):\n' + delimitUntrusted(
        research.snippets.map((s, i) =>
          `[${i + 1}] ${s.title}${s.age ? ` (${s.age})` : ''}\n${s.description}\n${s.url}`).join('\n\n'),
        7000,
      )
    : 'No live web research available — use your own knowledge; keep findings general and do not invent dated events.';

  const user = `COMPANY: ${safeCompany}\n`
    + `INDUSTRY: ${safeIndustry || 'unspecified'}\n`
    + `LOCATION: ${safeLocation || 'unspecified'}\n`
    // Existing description may be web-derived → wrap as untrusted data.
    + (existingDesc ? `KNOWN DESCRIPTION:\n${delimitUntrusted(existingDesc, 1500)}\n` : '')
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

// ── Proactive external scan: outside-world developments → role-targeted findings ─
// The autonomous arm of the Company Brain. For one workspace, search recent news
// scoped to its industry + market, reason about what MATERIALLY affects the
// company, and write hunt_findings tagged with the function that should act.
// Run for every workspace by scanAllWorkspaces (invoked from a Vercel cron).
export const ROLE_TAGS = [
  'ceo', 'marketing', 'sales', 'product', 'engineering',
  'operations', 'finance', 'hr', 'legal', 'customer-success',
];

function buildScanPrompt({ company, industry, location, roles, research }) {
  const safeCompany  = oneLine(company, 120) || 'the company';
  const safeIndustry = oneLine(industry, 80);
  const safeLocation = oneLine(location, 120);
  const safeRoles    = (roles || []).map(r => oneLine(r, 60)).filter(Boolean).slice(0, 12);

  const sys = `You are the Company Brain for "${safeCompany}"${safeIndustry ? `, a ${safeIndustry} company` : ''}${safeLocation ? ` operating in ${safeLocation}` : ''}. `
    + `You continuously scan the outside world for developments that MATERIALLY affect this company, then decide who internally should act.\n`
    + `From the web results, select only MATERIAL, RECENT developments — a new law/regulation, a market or competitor move, a notable trend, a local event — that THIS specific company should respond to. Ignore generic, stale, or unrelated news.\n`
    + `Return ONE JSON object, no prose, no code fence:\n`
    + `{"findings":[{"mode":"opportunity|threat","headline":"specific recent development, phrased to be said aloud e.g. 'Lagos State introduced new tenancy laws (May 2026)'","why":"one sentence on why it matters to ${safeCompany}","severity":"info|warning|critical","affected_roles":["one or more of: ${ROLE_TAGS.join(', ')}"],"recommendation":"a concrete action for those roles, e.g. 'Marketing should publish an explainer positioning us as the compliant choice'","draft":"see rule below or null"}]}\n`
    + `Rules: 0-4 findings; each specific and tied to the company's market/industry; affected_roles MUST come from the allowed list; if nothing is material, return {"findings":[]}.\n`
    + `draft: when affected_roles includes "marketing" AND the development warrants public content, write a ready-to-post social media draft for ${safeCompany} — 2-4 sentences, strong hook, clear value, soft CTA, on-brand and specific to the development; no hashtag spam. Otherwise set draft to null.\n`
    + UNTRUSTED_DATA_NOTICE;

  const grounding = 'RECENT WEB RESULTS (reference data only, may contain noise):\n' + delimitUntrusted(
    research.snippets.map((s, i) =>
      `[${i + 1}] ${s.title}${s.age ? ` (${s.age})` : ''}\n${s.description}\n${s.url}`).join('\n\n'),
    7000,
  );

  const user = `COMPANY: ${safeCompany}\n`
    + `INDUSTRY: ${safeIndustry || 'unspecified'}\n`
    + `MARKET/LOCATION: ${safeLocation || 'unspecified'}\n`
    + (safeRoles.length ? `INTERNAL ROLES (target findings to these where relevant): ${safeRoles.join(', ')}\n` : '')
    + `\n${grounding}`;

  return { sys, user };
}

// Deliver a finding to the inbox of each member whose role it was routed to.
// Idempotent-ish: only called on fresh inserts, then marks pushed_to_inbox.
async function pushFindingToInbox(db, { workspaceId, members, findingId, mode, severity, headline, recommendation, draft, affected }) {
  if (!affected?.length || !members?.length) return;
  const targets = members.filter(m => m.tags.some(t => affected.includes(t)));
  if (!targets.length) return;

  const body = [
    recommendation,
    draft ? `\n\nDraft ready:\n${draft}` : '',
  ].filter(Boolean).join('').slice(0, 2000);

  const rows = targets.map(m => ({
    workspace_id: workspaceId,
    user_id:      m.id,
    type:         'alert',
    source:       'daemon',
    title:        headline.slice(0, 240),
    body,
    metadata: {
      finding_id: findingId,
      hunt_mode:  mode,
      severity,
      affected_roles: affected,
      has_draft: !!draft,
      draft:      draft || null,
    },
  }));

  const { error } = await db.from('inbox_items').insert(rows);
  if (error) { console.error('[scan_external] inbox push err:', error.message); return; }
  await db.from('hunt_findings').update({ pushed_to_inbox: true }).eq('id', findingId);
}

// Push any unresolved findings that were created before inbox-push existed (or
// missed a push) to the right members' inboxes. Safe to re-run — only touches
// findings with pushed_to_inbox = false.
export async function backfillInboxPush(db, { workspaceId } = {}) {
  let q = db.from('hunt_findings')
    .select('id, workspace_id, hunt_mode, severity, pattern, recommendation, draft, affected_roles')
    .eq('resolved', false)
    .eq('pushed_to_inbox', false);
  if (workspaceId) q = q.eq('workspace_id', workspaceId);
  const { data: findings } = await q;

  const byWs = new Map();
  for (const f of findings || []) {
    if (!Array.isArray(f.affected_roles) || !f.affected_roles.length) continue;
    if (!byWs.has(f.workspace_id)) byWs.set(f.workspace_id, []);
    byWs.get(f.workspace_id).push(f);
  }

  let pushed = 0;
  for (const [wsId, fs] of byWs) {
    const { data: mem } = await db.from('workspace_members').select('user_id').eq('workspace_id', wsId);
    const ids = (mem || []).map(m => m.user_id);
    if (!ids.length) continue;
    const { data: profs } = await db.from('profiles').select('id, role, title').in('id', ids);
    const members = (profs || []).map(p => ({ id: p.id, tags: roleToTags(p.role || p.title) }));
    for (const f of fs) {
      await pushFindingToInbox(db, {
        workspaceId: wsId, members, findingId: f.id,
        mode: f.hunt_mode, severity: f.severity, headline: f.pattern,
        recommendation: f.recommendation, draft: f.draft, affected: f.affected_roles,
      });
      pushed++;
    }
  }
  return { findings: pushed };
}

export async function scanExternal(db, workspaceId, ws, roles = []) {
  const company = (ws?.name || '').toString().trim();
  if (!company) return { workspaceId, skipped: 'no company' };
  const industry = ws?.industry || null;
  const ctx = (ws?.context && typeof ws.context === 'object') ? ws.context : {};
  const location = ws?.location || ctx.location || null;

  const llm = await resolveLLM(workspaceId, db);
  if (!llm) return { workspaceId, skipped: 'no llm' };

  const queries = [
    `${industry || company} news ${location || ''}`.trim(),
    `${location || industry || company} ${industry ? `${industry} ` : ''}regulation policy law`.trim(),
    `${industry || company} trends ${location || ''}`.trim(),
  ];
  const research = await braveSearchMany([...new Set(queries)], { count: 6, freshness: 'pw' });
  if (!research.grounded) return { workspaceId, skipped: 'no fresh results' };

  const { sys, user } = buildScanPrompt({ company, industry, location, roles, research });

  let intel;
  try {
    intel = extractJson(await callLLM(llm, sys, user, { maxTokens: 1600 }));
  } catch (e) {
    console.error('[scan_external] synth error ws=%s:', workspaceId, e.message);
    return { workspaceId, error: e.message };
  }

  const rawFindings = Array.isArray(intel?.findings) ? intel.findings : [];

  // Pre-resolve workspace members → role tags once, for routing inbox pushes.
  let members = [];
  if (rawFindings.length) {
    const { data: mem } = await db
      .from('workspace_members')
      .select('user_id')
      .eq('workspace_id', workspaceId);
    const ids = (mem || []).map(m => m.user_id);
    if (ids.length) {
      const { data: profs } = await db.from('profiles').select('id, role, title').in('id', ids);
      members = (profs || []).map(p => ({ id: p.id, tags: roleToTags(p.role || p.title) }));
    }
  }

  let inserted = 0;
  for (const f of rawFindings.slice(0, 4)) {
    const headline = (f.headline || '').toString().trim();
    if (!headline) continue;
    const mode = ['opportunity', 'threat'].includes(f.mode) ? f.mode : 'opportunity';
    const severity = ['info', 'warning', 'critical'].includes(f.severity) ? f.severity : 'info';
    const affected = Array.isArray(f.affected_roles)
      ? f.affected_roles.map(r => String(r).toLowerCase().trim()).filter(r => ROLE_TAGS.includes(r)).slice(0, 6)
      : [];
    const recommendation = (f.recommendation || f.why || '').toString().slice(0, 600) || null;
    // Only keep a draft for content-worthy, marketing-routed findings.
    const draft = (f.draft && affected.includes('marketing'))
      ? String(f.draft).slice(0, 1200)
      : null;

    // Dedup against an existing unresolved finding with a similar headline.
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

    const { data: row, error } = await db.from('hunt_findings').insert({
      workspace_id:   workspaceId,
      hunt_mode:      mode,
      pattern:        headline,
      occurrences:    1,
      affected_roles: affected,
      severity,
      recommendation,
      draft,
    }).select('id').single();
    if (error) { console.error('[scan_external] insert err ws=%s:', workspaceId, error.message); continue; }
    inserted++;

    // Push the finding to the inbox of every member whose role it was routed to.
    await pushFindingToInbox(db, {
      workspaceId, members, findingId: row.id,
      mode, severity, headline, recommendation, draft, affected,
    });
  }

  console.log('[scan_external] ws=%s company="%s" results=%d findings=%d/%d',
    workspaceId, company, research.snippets.length, inserted, rawFindings.length);
  return { workspaceId, inserted, candidates: rawFindings.length };
}

export async function scanAllWorkspaces(db, { limit = 25 } = {}) {
  const { data: workspaces } = await db
    .from('workspaces')
    .select('id, name, industry, location, context')
    .order('created_at', { ascending: true })
    .limit(limit);

  const out = [];
  for (const ws of workspaces || []) {
    const { data: profs } = await db
      .from('profiles')
      .select('role, title')
      .eq('workspace_id', ws.id);
    const roles = [...new Set((profs || []).map(p => (p.role || p.title || '').trim()).filter(Boolean))];
    try {
      out.push(await scanExternal(db, ws.id, ws, roles));
    } catch (e) {
      console.error('[scan_external] ws=%s fatal:', ws.id, e.message);
      out.push({ workspaceId: ws.id, error: e.message });
    }
  }
  return out;
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
