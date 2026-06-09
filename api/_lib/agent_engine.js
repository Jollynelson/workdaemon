// Autonomous Role Agent engine. The loop:
//   PLAN → RESEARCH → SCORE → DRAFT → QUEUE → (approve) → SEND → MEASURE
// See docs/specs/WorkDaemon_Growth_Agent_Spec.md. Pure lib (not a serverless
// function) so it stays off Vercel's 12-fn cap; driven by api/agents.js.
import { braveSearch, resolveLLM, callLLM, extractJson } from './research.js';
import { CHANNELS, getChannel, isSuppressed, normAddress, complianceFooter } from './channels/index.js';
import { recordSignal, distillAgentInsights, pickVariant } from './learning.js';

const DEFAULTS = { cadenceHours: 24, maxTargetsPerRun: 10, maxDraftsPerRun: 5 };

// Message-style variants the bandit explores. The MEASURE phase scores each by
// the human approve/reject/edit decisions it earns, and draftMessage favors the
// winners over time (epsilon-greedy). Seeded here; overridable via config.draft_variants.
const DRAFT_VARIANTS = [
  { id: 'warm',    style: 'warm and personal — lead with a genuine, specific observation about them' },
  { id: 'blunt',   style: 'blunt and metric-led — lead with one concrete outcome or number' },
  { id: 'curious', style: 'curious and question-first — open with one sharp, relevant question' },
];
function variantsFor(agent) {
  const v = agent.config?.draft_variants;
  return Array.isArray(v) && v.length ? v : DRAFT_VARIANTS;
}

function domainOf(url, email) {
  const src = email?.includes('@') ? email.split('@')[1] : url || '';
  return String(src).replace(/^https?:\/\//, '').replace(/^www\./, '').split(/[/?#]/)[0].toLowerCase();
}

// Primary outbound channel for an agent (email first — the only live sender).
function primaryChannel(agent) {
  return agent.channels?.find(c => c === 'email') || agent.channels?.[0] || null;
}

// ── PLAN: derive/refresh the ICP from the objective ──────────────────────────
async function planICP(llm, agent) {
  if (agent.config?.icp?.search_queries?.length) return agent.config.icp;
  const sys = 'You are a B2B growth strategist. Return ONLY JSON.';
  const user = `Mission: "${agent.objective}"
Define the Ideal Customer Profile and the web searches to find them.
Return JSON: {"description": str, "keywords": [str], "search_queries": [str up to 5 — concrete queries that surface real companies/people, e.g. site:linkedin.com or "head of sales" + industry]}`;
  const txt = await callLLM(llm, sys, user, { maxTokens: 600 });
  const icp = extractJson(txt) || {};
  if (!icp.search_queries?.length) icp.search_queries = [agent.objective];
  return icp;
}

// ── RESEARCH + SCORE + EXTRACT: snippets → scored prospects ──────────────────
// Searches each query separately so every snippet carries the query that found
// it; the LLM echoes back the snippet index, letting us attribute each prospect
// to its source query (which the MEASURE phase uses to rank queries by yield).
async function findProspects(llm, agent, icp) {
  const queries = icp.search_queries.slice(0, 5);
  const runs = await Promise.all(queries.map(q => braveSearch(q, { count: 8 })));
  const seen = new Set();
  const tagged = []; // { title, description, url, query }
  runs.forEach((run, qi) => {
    for (const s of run.snippets) {
      if (s.url && seen.has(s.url)) continue;
      if (s.url) seen.add(s.url);
      tagged.push({ ...s, query: queries[qi] });
    }
  });
  if (!tagged.length) return [];
  const pool = tagged.slice(0, 24);
  const corpus = pool.map((s, i) => `[${i}] ${s.title}\n${s.description}\n${s.url}`).join('\n\n');
  const sys = 'You extract B2B sales prospects from web snippets. Return ONLY JSON. Never invent contact details — leave fields null if unknown.';
  const user = `ICP: ${icp.description || agent.objective}
Snippets:
${corpus}

Return JSON {"prospects":[{"source_idx":int (the [i] snippet this came from),"company":str,"person_name":str|null,"title":str|null,"email":str|null,"x_handle":str|null,"linkedin_url":str|null,"website":str|null,"source_url":str,"research":"one specific sentence about why they fit, grounded in the snippet","score":0..1 ICP fit}]}.
Only include real organizations from the snippets. Max 12.`;
  const txt = await callLLM(llm, sys, user, { maxTokens: 1800 });
  const parsed = extractJson(txt);
  const prospects = Array.isArray(parsed?.prospects) ? parsed.prospects : [];
  // Attribute each prospect to the query that surfaced its snippet.
  for (const p of prospects) {
    const src = pool[p.source_idx];
    p.source_query = src?.query || queries[0] || null;
    if (!p.source_url && src?.url) p.source_url = src.url;
  }
  return prospects;
}

// ── DRAFT: a personalized message for one target on one channel ──────────────
// `variant` (chosen by the bandit) steers the style so MEASURE can learn which
// opening lands best for this agent's audience.
async function draftMessage(llm, agent, target, channel, variant = null) {
  const persona = agent.config?.persona || 'a concise, warm, no-fluff founder';
  const styleLine = variant?.style ? ` Style: ${variant.style}.` : '';
  const sys = `You are ${persona} writing first-touch ${channel} outreach for: "${agent.objective}". Personal, specific, <120 words, one clear ask.${styleLine} Return ONLY JSON.`;
  const user = `Prospect: ${target.person_name || target.company} ${target.title ? '(' + target.title + ')' : ''} at ${target.company}.
Why they fit: ${target.research || 'n/a'}
Return JSON {"subject": "short email subject (email only, else null)", "body": "the message"}.`;
  const txt = await callLLM(llm, sys, user, { maxTokens: 500 });
  return extractJson(txt) || { subject: null, body: txt };
}

// ── KNOWLEDGE DAEMON: read the Company Brain on a schedule, propose actions ───
// The n8n-style, knowledge-native path. No prospecting — it grounds itself in the
// company's own context + findings + memory and proposes concrete actions
// (tasks/notes/drafts/alerts) into daemon_actions for approve-first execution.
async function gatherBrainContext(db, agent) {
  const [{ data: ws }, { data: findings }, { data: recentActs }] = await Promise.all([
    db.from('workspaces').select('name, industry, context').eq('id', agent.workspace_id).single(),
    db.from('hunt_findings').select('pattern, recommendation, severity, affected_roles')
      .eq('workspace_id', agent.workspace_id).eq('resolved', false)
      .order('created_at', { ascending: false }).limit(12),
    db.from('daemon_actions').select('title')
      .eq('agent_id', agent.id).in('status', ['proposed', 'approved', 'done'])
      .order('created_at', { ascending: false }).limit(30),
  ]);
  return { ws: ws || {}, findings: findings || [], priorTitles: (recentActs || []).map(a => a.title) };
}

export async function runKnowledgeDaemon(db, agent) {
  const cfg = { maxActionsPerRun: 5, ...(agent.config || {}) };
  const { data: run } = await db.from('agent_runs').insert({
    agent_id: agent.id, workspace_id: agent.workspace_id, status: 'running', phase: 'plan',
  }).select().single();
  const metrics = { proposed: 0 };
  const logLines = [];
  try {
    const llm = await resolveLLM(agent.workspace_id, db);
    if (!llm) throw new Error('No LLM configured for workspace');

    await db.from('agent_runs').update({ phase: 'research' }).eq('id', run.id);
    const { ws, findings, priorTitles } = await gatherBrainContext(db, agent);
    const ctx = ws.context && typeof ws.context === 'object'
      ? Object.entries(ws.context).filter(([, v]) => v && typeof v === 'string').map(([k, v]) => `${k}: ${v}`).join('\n')
      : String(ws.context || '');
    const findingsBlock = findings.length
      ? findings.map(f => `- [${f.severity}] ${f.pattern} → ${f.recommendation || ''}`).join('\n')
      : '(no open findings)';
    const avoid = priorTitles.length ? `\nDo NOT repeat any of these already-proposed actions:\n- ${priorTitles.join('\n- ')}` : '';

    await db.from('agent_runs').update({ phase: 'draft' }).eq('id', run.id);
    const sys = `You are an autonomous operations daemon for the company "${ws.name || 'the company'}". `
      + `You act on the company's own knowledge to advance one mission. You DON'T chat — you propose concrete, `
      + `grounded actions a human will approve. Return ONLY JSON.`;
    const user = `Mission: "${agent.objective}"

COMPANY CONTEXT:
${ctx || '(none provided)'}

OPEN BRAIN FINDINGS:
${findingsBlock}
${avoid}

Propose up to ${cfg.maxActionsPerRun} high-value actions that advance the mission, each grounded in the context/findings above.
Allowed types: "task" (work to assign), "note" (a fact/insight to save to memory), "draft" (a message/post/doc to write), "alert" (something a human should see now).
Return JSON {"actions":[{"type":..., "title":"short imperative title", "body":"the task detail / note / draft text", "rationale":"one sentence: which context or finding makes this worth doing now", "assignee_role": "ceo|sales|product|engineering|marketing|hr|finance|null"}]}.
Only propose what the context actually supports. Fewer, sharper actions beat filler.`;
    const txt = await callLLM(llm, sys, user, { maxTokens: 1600 });
    const parsed = extractJson(txt);
    const actions = Array.isArray(parsed?.actions) ? parsed.actions : [];
    const VALID = new Set(['task', 'note', 'draft', 'alert', 'message']);

    for (const a of actions.slice(0, cfg.maxActionsPerRun)) {
      const type = VALID.has(a.type) ? a.type : 'task';
      const title = String(a.title || '').trim().slice(0, 200);
      if (!title) continue;
      await db.from('daemon_actions').insert({
        agent_id: agent.id, workspace_id: agent.workspace_id, run_id: run.id,
        type, title, body: String(a.body || '').slice(0, 4000),
        rationale: a.rationale ? String(a.rationale).slice(0, 500) : null,
        payload: { assignee_role: a.assignee_role || null }, status: 'proposed',
      });
      metrics.proposed++;
    }
    logLines.push(`Proposed ${metrics.proposed} actions grounded in ${findings.length} findings`);

    const cadenceHours = cfg.cadenceHours || 24;
    const nextRun = new Date(Date.now() + cadenceHours * 3600 * 1000).toISOString();
    await db.from('agents').update({ last_run_at: new Date().toISOString(), next_run_at: nextRun }).eq('id', agent.id);
    await db.from('agent_runs').update({
      status: 'done', phase: 'measure', metrics, log: logLines.join('\n'), finished_at: new Date().toISOString(),
    }).eq('id', run.id);
    return { ok: true, runId: run.id, metrics };
  } catch (e) {
    await db.from('agent_runs').update({
      status: 'error', error: e.message, log: logLines.join('\n'), finished_at: new Date().toISOString(),
    }).eq('id', run.id);
    await recordSignal(db, {
      workspaceId: agent.workspace_id, domain: 'codebase', subjectType: 'error', subjectId: 'agent_engine.runKnowledgeDaemon',
      signal: 'error', meta: { where: 'agent_engine.runKnowledgeDaemon', message: e.message },
    });
    return { ok: false, runId: run.id, error: e.message };
  }
}

// ── ONE RUN of an agent's loop (dispatch by kind) ────────────────────────────
export async function runAgent(db, agent) {
  if (agent.kind === 'knowledge') return runKnowledgeDaemon(db, agent);
  const cfg = { ...DEFAULTS, ...(agent.config || {}) };
  const { data: run } = await db.from('agent_runs').insert({
    agent_id: agent.id, workspace_id: agent.workspace_id, status: 'running', phase: 'plan',
  }).select().single();
  const metrics = { found: 0, new: 0, drafted: 0 };
  const logLines = [];
  try {
    const llm = await resolveLLM(agent.workspace_id, db);
    if (!llm) throw new Error('No LLM configured for workspace');

    // LEARN (MEASURE phase, run up-front): distill the previous cycle's signals —
    // human approve/reject/edit decisions AND research yield — into adaptations
    // applied to THIS run, so each run is better than the last.
    const learned = await distillAgentInsights(db, agent, { since: agent.last_run_at });
    const variants = variantsFor(agent);
    if (learned.queryRank?.length) logLines.push(`Learned: best query "${learned.queryRank[0]}"`);

    const icp = await planICP(llm, agent);
    // Reorder ICP queries by realized yield (best-performing queries first).
    if (learned.queryRank?.length && Array.isArray(icp.search_queries)) {
      const rank = new Map(learned.queryRank.map((q, i) => [q, i]));
      icp.search_queries = [...icp.search_queries].sort(
        (a, b) => (rank.has(a) ? rank.get(a) : 99) - (rank.has(b) ? rank.get(b) : 99));
    }
    if (!agent.config?.icp) {
      await db.from('agents').update({ config: { ...(agent.config || {}), icp } }).eq('id', agent.id);
    }
    logLines.push(`ICP: ${icp.description || '(from objective)'}`);

    await db.from('agent_runs').update({ phase: 'research' }).eq('id', run.id);
    const prospects = await findProspects(llm, agent, icp);
    metrics.found = prospects.length;
    logLines.push(`Found ${prospects.length} candidate prospects`);

    // LEARN from research: record how many candidates each query surfaced, so the
    // next cycle's query ranking reflects what research actually produces.
    const yieldByQuery = {};
    for (const p of prospects) { if (p.source_query) yieldByQuery[p.source_query] = (yieldByQuery[p.source_query] || 0) + 1; }
    for (const [q, n] of Object.entries(yieldByQuery)) {
      await recordSignal(db, {
        workspaceId: agent.workspace_id, domain: 'agent', subjectType: 'research_query',
        subjectId: q, signal: 'found', value: n, meta: { agent_id: agent.id, source_query: q, run_id: run.id },
      });
    }

    // SCORE + dedupe + persist targets
    await db.from('agent_runs').update({ phase: 'score' }).eq('id', run.id);
    const sorted = prospects.sort((a, b) => (b.score || 0) - (a.score || 0)).slice(0, cfg.maxTargetsPerRun);
    const newTargets = [];
    for (const p of sorted) {
      const dedupe = domainOf(p.website, p.email) || normAddress(p.company);
      if (!dedupe) continue;
      const { data: existing } = await db.from('outreach_targets')
        .select('id').eq('agent_id', agent.id).eq('dedupe_key', dedupe).maybeSingle();
      if (existing) continue;
      const { data: t } = await db.from('outreach_targets').insert({
        agent_id: agent.id, workspace_id: agent.workspace_id,
        company: p.company, person_name: p.person_name, title: p.title,
        email: p.email, x_handle: p.x_handle, linkedin_url: p.linkedin_url,
        website: p.website, source_url: p.source_url, research: p.research,
        source_query: p.source_query || null,
        score: Math.max(0, Math.min(1, Number(p.score) || 0)), dedupe_key: dedupe, status: 'new',
      }).select().single();
      if (t) newTargets.push(t);
    }
    metrics.new = newTargets.length;
    logLines.push(`${newTargets.length} new targets after dedupe`);

    // DRAFT + QUEUE for the primary channel
    await db.from('agent_runs').update({ phase: 'draft' }).eq('id', run.id);
    const channel = primaryChannel(agent);
    if (channel) {
      for (const t of newTargets.slice(0, cfg.maxDraftsPerRun)) {
        const to = channel === 'email' ? t.email : channel === 'x' ? t.x_handle : t.linkedin_url;
        if (!to) continue; // no reachable address on this channel — leave as a target only
        if (await isSuppressed(db, agent.workspace_id, channel, to)) continue;
        // Bandit picks the message style; we record which one drafted this message
        // so the human's approve/reject decision can score it later.
        const variant = pickVariant(variants, learned.variantScores, agent.config?.bandit_epsilon ?? 0.2);
        const d = await draftMessage(llm, agent, t, channel, variant);
        await db.from('outreach_messages').insert({
          agent_id: agent.id, workspace_id: agent.workspace_id, target_id: t.id,
          channel, to_address: to, subject: d.subject || null, body: d.body || '', status: 'draft',
          variant_id: variant?.id || null,
        });
        await db.from('outreach_targets').update({ status: 'queued' }).eq('id', t.id);
        metrics.drafted++;
      }
    }
    logLines.push(`Drafted ${metrics.drafted} messages on ${channel || 'no channel'}`);

    // MEASURE summary: surface what the loop learned on this run.
    const topVariant = Object.entries(learned.variantScores || {}).sort((a, b) => b[1] - a[1])[0];
    metrics.learning = {
      topVariant: topVariant ? { id: topVariant[0], score: Math.round(topVariant[1] * 100) / 100 } : null,
      topQuery: learned.queryRank?.[0] || null,
    };
    if (topVariant) logLines.push(`MEASURE: favoring style "${topVariant[0]}" (${Math.round(topVariant[1] * 100)}% win-rate)`);

    const nextRun = new Date(Date.now() + cfg.cadenceHours * 3600 * 1000).toISOString();
    await db.from('agents').update({ last_run_at: new Date().toISOString(), next_run_at: nextRun }).eq('id', agent.id);
    await db.from('agent_runs').update({
      status: 'done', phase: 'measure', metrics, log: logLines.join('\n'), finished_at: new Date().toISOString(),
    }).eq('id', run.id);
    return { ok: true, runId: run.id, metrics };
  } catch (e) {
    await db.from('agent_runs').update({
      status: 'error', error: e.message, log: logLines.join('\n'), finished_at: new Date().toISOString(),
    }).eq('id', run.id);
    // LEARN (codebase): capture the failure so the weekly improver can cluster it.
    await recordSignal(db, {
      workspaceId: agent.workspace_id, domain: 'codebase', subjectType: 'error', subjectId: 'agent_engine.runAgent',
      signal: 'error', meta: { where: 'agent_engine.runAgent', message: e.message, stack: String(e.stack || '').slice(0, 1000) },
    });
    return { ok: false, runId: run.id, error: e.message };
  }
}

// ── Approve a proposed knowledge-daemon action → materialize it ──────────────
// Resolve an assignee_role hint to a workspace member (best-effort, substring match).
async function resolveRoleUser(db, workspaceId, role) {
  if (!role) return null;
  const { data: members } = await db.from('workspace_members').select('user_id').eq('workspace_id', workspaceId);
  const ids = (members || []).map(m => m.user_id);
  if (!ids.length) return null;
  const { data: profs } = await db.from('profiles').select('id, role').in('id', ids);
  const r = String(role).toLowerCase();
  const hit = (profs || []).find(p => (p.role || '').toLowerCase().includes(r));
  return hit?.id || null;
}

export async function approveAction(db, { workspaceId, actionId, userId, edits = {} }) {
  const { data: act } = await db.from('daemon_actions')
    .select('*, agents(name)').eq('id', actionId).eq('workspace_id', workspaceId).single();
  if (!act) return { ok: false, error: 'Action not found' };
  if (act.status !== 'proposed') return { ok: false, error: `Action already ${act.status}` };
  const title = edits.title ?? act.title;
  const body = edits.body ?? act.body;
  let result = '';
  try {
    if (act.type === 'task') {
      const assignee = await resolveRoleUser(db, workspaceId, act.payload?.assignee_role);
      const { data: task } = await db.from('tasks').insert({
        workspace_id: workspaceId, title, description: body, status: 'todo', priority: 'P2',
        assignee_id: assignee, created_by: userId, routed_by_brain: true,
      }).select('id').single();
      if (assignee) await db.from('inbox_items').insert({
        workspace_id: workspaceId, user_id: assignee, type: 'task', source: 'daemon',
        title: `${act.agents?.name || 'A daemon'} assigned you: ${title}`, body: body || '',
        metadata: { task_id: task?.id, event_type: 'assignment', from: act.agents?.name }, read: false,
      });
      result = `task ${task?.id || ''}`;
    } else if (act.type === 'note') {
      await db.from('daemon_memory').insert({
        user_id: userId, workspace_id: workspaceId, key: 'daemon-note-' + Math.random().toString(36).slice(2, 8),
        value: body || title, memory_type: 'insight',
      });
      result = 'saved to memory';
    } else { // draft | message | alert → land in the approver's inbox
      await db.from('inbox_items').insert({
        workspace_id: workspaceId, user_id: userId, type: 'alert', source: 'daemon',
        title: `${act.agents?.name || 'Daemon'}: ${title}`, body: body || '',
        metadata: { event_type: act.type, daemon: act.agents?.name, draft: act.type !== 'alert' ? body : null }, read: false,
      });
      result = 'sent to inbox';
    }
    await db.from('daemon_actions').update({
      status: 'done', approved_by: userId, title, body, result, acted_at: new Date().toISOString(),
    }).eq('id', actionId);
    await recordSignal(db, { workspaceId, domain: 'agent', subjectType: 'daemon_action', subjectId: actionId, signal: 'approved', meta: { agent_id: act.agent_id, type: act.type } });
    return { ok: true, result };
  } catch (e) {
    await db.from('daemon_actions').update({ status: 'failed', result: e.message }).eq('id', actionId);
    return { ok: false, error: e.message };
  }
}

export async function rejectAction(db, { workspaceId, actionId, userId }) {
  const { data: act } = await db.from('daemon_actions').select('agent_id, type, status').eq('id', actionId).eq('workspace_id', workspaceId).single();
  if (!act) return { ok: false, error: 'Action not found' };
  await db.from('daemon_actions').update({ status: 'rejected', approved_by: userId, acted_at: new Date().toISOString() }).eq('id', actionId);
  await recordSignal(db, { workspaceId, domain: 'agent', subjectType: 'daemon_action', subjectId: actionId, signal: 'rejected', meta: { agent_id: act.agent_id, type: act.type } });
  return { ok: true };
}

// ── Cron: run every active agent whose next_run_at is due ─────────────────────
export async function runDueAgents(db, { limit = Number(process.env.AGENTS_RUN_BATCH || 25), budgetMs = Number(process.env.AGENTS_RUN_BUDGET_MS || 50000) } = {}) {
  const nowIso = new Date().toISOString();
  // Oldest-due first → fair round-robin across all companies' agents at scale.
  const { data: due } = await db.from('agents')
    .select('*').eq('status', 'active')
    .or(`next_run_at.is.null,next_run_at.lte.${nowIso}`)
    .order('next_run_at', { ascending: true, nullsFirst: true })
    .limit(limit);
  const results = [];
  const startedAt = Date.now();
  for (const agent of (due || [])) {
    if (Date.now() - startedAt > budgetMs) break; // stay inside the function's maxDuration
    try { results.push({ agent: agent.id, ...(await runAgent(db, agent)) }); }
    catch (e) { results.push({ agent: agent.id, ok: false, error: e.message }); }
  }
  return results;
}

// ── Approve a queued message → send it via its channel ───────────────────────
export async function approveMessage(db, { workspaceId, messageId, userId, edits = {} }) {
  const { data: msg } = await db.from('outreach_messages')
    .select('*, outreach_targets(*), agents(name)')
    .eq('id', messageId).eq('workspace_id', workspaceId).single();
  if (!msg) return { ok: false, error: 'Message not found' };
  if (!['draft', 'approved', 'failed'].includes(msg.status)) {
    return { ok: false, error: `Cannot approve a message in status "${msg.status}"` };
  }

  const subject = edits.subject ?? msg.subject;
  let body = edits.body ?? msg.body;
  const channel = getChannel(msg.channel);
  if (!channel) return { ok: false, error: `Unknown channel ${msg.channel}` };

  // Compliance: suppression check + footer (email).
  if (await isSuppressed(db, workspaceId, msg.channel, msg.to_address)) {
    await db.from('outreach_messages').update({ status: 'rejected', error: 'suppressed', approved_by: userId }).eq('id', messageId);
    return { ok: false, error: 'Recipient is on the suppression list' };
  }
  if (msg.channel === 'email') {
    const unsub = `${process.env.PUBLIC_BASE_URL || 'https://app.workdaemon.com'}/api/agents?action=unsubscribe&w=${workspaceId}&a=${encodeURIComponent(msg.to_address)}`;
    body += '\n' + complianceFooter({ unsubscribeUrl: unsub, senderName: process.env.SENDER_NAME, address: process.env.SENDER_ADDRESS });
  }

  // LEARN: the human's approve/edit decision is the richest training signal,
  // attributed to the style variant + source query that produced this draft.
  const wasEdited = (edits.subject != null && edits.subject !== msg.subject) ||
                    (edits.body != null && edits.body !== msg.body);
  await recordSignal(db, {
    workspaceId, domain: 'agent', subjectType: 'outreach_message', subjectId: messageId,
    signal: wasEdited ? 'edited' : 'approved',
    meta: { agent_id: msg.agent_id, variant_id: msg.variant_id, source_query: msg.outreach_targets?.source_query, channel: msg.channel },
  });

  if (!channel.configured()) {
    // Approved but the live sender isn't wired (e.g. X/LinkedIn P2, or no ESP key).
    await db.from('outreach_messages').update({
      status: 'approved', subject, body, approved_by: userId,
      error: `${channel.label} not configured — saved as approved; will send once connected`,
    }).eq('id', messageId);
    return { ok: true, status: 'approved', note: `Approved. ${channel.label} send not yet configured.` };
  }

  await db.from('outreach_messages').update({ status: 'sending', subject, body, approved_by: userId }).eq('id', messageId);
  try {
    const r = await channel.send({ db, workspaceId, to: msg.to_address, subject, body, meta: {} });
    await db.from('outreach_messages').update({
      status: 'sent', provider_id: r.providerId, sent_at: new Date().toISOString(),
    }).eq('id', messageId);
    if (msg.target_id) await db.from('outreach_targets').update({ status: 'contacted' }).eq('id', msg.target_id);
    await recordSignal(db, { workspaceId, domain: 'agent', subjectType: 'outreach_message', subjectId: messageId, signal: 'sent', meta: { agent_id: msg.agent_id, variant_id: msg.variant_id, channel: msg.channel } });
    return { ok: true, status: 'sent', providerId: r.providerId };
  } catch (e) {
    await db.from('outreach_messages').update({ status: 'failed', error: e.message }).eq('id', messageId);
    await recordSignal(db, { workspaceId, domain: 'agent', subjectType: 'outreach_message', subjectId: messageId, signal: 'send_failed', meta: { agent_id: msg.agent_id, channel: msg.channel, error: e.message } });
    return { ok: false, error: e.message };
  }
}

export { CHANNELS };
