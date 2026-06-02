import { requireAuth, adminClient } from '../_lib/supabase.js';
import { braveSearchMany, resolveLLM, callLLM, extractJson } from '../_lib/research.js';

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/workspace/research-company   (workspace admin only)
//
// Researches the company itself on the open web — its market, competitors,
// location, industry trends, and recent competitor moves — then:
//   • durable facts  → workspaces.context (competitors + a marker-delimited
//     auto section in notes; both rendered by chat.js buildCompanyContext).
//   • timely moves   → hunt_findings (mode opportunity|threat), which chat.js
//     buildHuntContext surfaces proactively as alerts: "your competitor just
//     did X → you should Y."
//
// Idempotent: the notes auto-section is replaced in place (admin text kept),
// and findings are de-duplicated by headline before insert.
// ─────────────────────────────────────────────────────────────────────────────

const NOTE_OPEN = '<!--auto-market-intel-->';
const NOTE_CLOSE = '<!--/auto-market-intel-->';

function buildPrompt({ company, industry, location, existingDesc, research }) {
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

// Replace (or append) the auto-research block inside the admin's notes.
function mergeNotes(existingNotes, autoBlock) {
  const base = (existingNotes || '').replace(
    new RegExp(`\\s*${NOTE_OPEN}[\\s\\S]*?${NOTE_CLOSE}`, 'g'), ''
  ).trim();
  const block = `${NOTE_OPEN}\n${autoBlock}\n${NOTE_CLOSE}`;
  return base ? `${base}\n\n${block}` : block;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const user = await requireAuth(req, res);
  if (!user) return;

  const db = adminClient();

  const { data: profile } = await db
    .from('profiles')
    .select('workspace_id, workspaces(name, industry, context)')
    .eq('id', user.id)
    .single();

  const workspaceId = profile?.workspace_id;
  if (!workspaceId) return res.status(400).json({ error: 'No workspace' });

  // Admin only.
  const { data: member } = await db
    .from('workspace_members')
    .select('role')
    .eq('user_id', user.id)
    .eq('workspace_id', workspaceId)
    .single();
  if (member?.role !== 'admin') return res.status(403).json({ error: 'Admin only' });

  const ws = profile.workspaces;
  const company = (req.body?.company || ws?.name || '').toString().trim();
  if (!company) return res.status(400).json({ error: 'No company name to research' });
  const industry = ws?.industry || req.body?.industry || null;
  const location = req.body?.location || ws?.context?.location || null;
  const existingCtx = (ws?.context && typeof ws.context === 'object') ? ws.context : {};

  const llm = await resolveLLM(workspaceId, db);
  if (!llm) return res.status(503).json({ error: 'No AI provider configured for research.' });

  // 1. Research the company + competitors + market on the open web.
  const queries = [
    `"${company}" competitors${industry ? ` ${industry}` : ''}`,
    `${company}${industry ? ` ${industry}` : ''} news`,
    `top ${industry || 'companies'}${location ? ` ${location}` : ''} competitors`,
    `${industry || company} trends 2026`,
  ];
  const research = await braveSearchMany(queries, { count: 6, freshness: 'py' });

  // 2. Synthesise structured intelligence.
  const { sys, user: userPrompt } = buildPrompt({
    company, industry, location, existingDesc: existingCtx.description, research,
  });

  let intel;
  try {
    intel = extractJson(await callLLM(llm, sys, userPrompt, { maxTokens: 1500 }));
  } catch (e) {
    console.error('[research-company] synthesis error:', e.message);
    return res.status(502).json({ error: e.message || 'Company research failed' });
  }
  if (!intel) return res.status(502).json({ error: 'Could not parse research output' });

  const competitors = Array.isArray(intel.competitors) ? intel.competitors.filter(Boolean) : [];

  // 3. Durable facts → workspaces.context (never clobber admin-entered fields).
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
    market_intel: {                    // structured copy for future UI use
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
    console.error('[research-company] context save error:', ctxErr.message);
    return res.status(500).json({ error: 'Failed to save company context' });
  }

  // 4. Timely competitor/market moves → hunt_findings (proactive alerts).
  const rawFindings = Array.isArray(intel.findings) ? intel.findings : [];
  let insertedFindings = 0;
  for (const f of rawFindings.slice(0, 5)) {
    const headline = (f.headline || '').toString().trim();
    if (!headline) continue;
    const mode = ['opportunity', 'threat'].includes(f.mode) ? f.mode : 'opportunity';
    const severity = ['info', 'warning', 'critical'].includes(f.severity) ? f.severity : 'info';

    // De-dup against existing unresolved findings with a similar headline.
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
  }

  console.log('[research-company] company="%s" grounded=%s competitors=%d findings=%d/%d',
    company, research.grounded, competitors.length, insertedFindings, rawFindings.length);

  return res.status(200).json({
    ok: true,
    company,
    web_grounded: research.grounded,
    sources: research.sources,
    competitors,
    findings_created: insertedFindings,
    intel,
  });
}
