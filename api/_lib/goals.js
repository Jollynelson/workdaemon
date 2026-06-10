// Brain Goals engine — the Company Brain's own ambition loop.
// The moment a workspace exists, the brain writes itself an aggressive goal book
// for the company; the moment a staff member onboards, their daemon gets
// role-scoped goals. A daily review pass measures progress from real activity,
// UPGRADES targets that prove too easy, ADDS goals when new signals open
// opportunities, RAISES THE BAR with a harder successor whenever a goal is
// achieved, and escalates stalls as hunt findings. Goals are injected into every
// daemon prompt (chat + autonomous) so the whole fleet pulls in one direction.
// Pure lib (no serverless function) — called from chat.js, brain.js, setup.js.
import { resolveLLM, callLLM, extractJson } from './research.js';
import { recordSignal, upsertInsight } from './learning.js';

const MAX_COMPANY_GOALS = 7;
const MAX_STAFF_GOALS = 5;

const oneLine = (s, n) => String(s || '').replace(/\s+/g, ' ').trim().slice(0, n);

function contextLines(ws) {
  const ctx = ws?.context && typeof ws.context === 'object' ? ws.context : {};
  return Object.entries(ctx)
    .filter(([, v]) => v && typeof v === 'string')
    .map(([k, v]) => `${k}: ${oneLine(v, 300)}`)
    .join('\n');
}

function dueAt(horizonDays) {
  const d = Math.max(7, Math.min(120, Number(horizonDays) || 30));
  return { horizon_days: d, due_at: new Date(Date.now() + d * 864e5).toISOString() };
}

function sanitizeGoal(g, { workspaceId, userId = null, scope, parentGoalId = null }) {
  const title = oneLine(g?.title, 160);
  if (!title) return null;
  const ambition = ['baseline', 'stretch', 'moonshot'].includes(g?.ambition) ? g.ambition : 'stretch';
  return {
    workspace_id: workspaceId,
    user_id: userId,
    scope,
    title,
    description: oneLine(g?.description, 500) || null,
    metric: oneLine(g?.metric, 160) || null,
    target: oneLine(g?.target, 160) || null,
    ambition,
    rationale: oneLine(g?.rationale, 400) || null,
    parent_goal_id: parentGoalId,
    ...dueAt(g?.horizon_days),
  };
}

export async function activeGoals(db, { workspaceId, userId = null }) {
  const [companyRes, staffRes] = await Promise.all([
    db.from('brain_goals')
      .select('id, title, metric, target, progress, ambition, horizon_days, due_at, status')
      .eq('workspace_id', workspaceId).eq('scope', 'company').eq('status', 'active')
      .order('created_at').limit(MAX_COMPANY_GOALS),
    userId
      ? db.from('brain_goals')
          .select('id, title, metric, target, progress, ambition, horizon_days, due_at, status')
          .eq('workspace_id', workspaceId).eq('user_id', userId).eq('scope', 'staff').eq('status', 'active')
          .order('created_at').limit(MAX_STAFF_GOALS)
      : Promise.resolve({ data: [] }),
  ]);
  return { company: companyRes.data || [], staff: staffRes.data || [] };
}

// Render the goal book for prompt injection (chat daemons + autonomous daemons).
export function goalsPromptBlock({ company = [], staff = [] }, { ownerFirstName = null } = {}) {
  if (!company.length && !staff.length) return '';
  const fmt = (g) => {
    const due = g.due_at ? ` · due ${String(g.due_at).slice(0, 10)}` : '';
    const tgt = g.target ? ` → ${g.target}` : '';
    const met = g.metric ? ` (measured by ${g.metric})` : '';
    return `• [${g.progress || 0}%] ${g.title}${tgt}${met}${due} [${g.ambition}]`;
  };
  let out = '\nGOAL BOOK (set and continuously upgraded by the Company Brain — deliberately aggressive; treat them as the company\'s operating heartbeat):\n';
  if (company.length) out += `COMPANY GOALS:\n${company.map(fmt).join('\n')}\n`;
  if (staff.length) out += `${ownerFirstName ? ownerFirstName.toUpperCase() + "'S" : 'YOUR OWNER\'S'} DAEMON GOALS (yours to drive):\n${staff.map(fmt).join('\n')}\n`;
  out += 'Drive these relentlessly: when a question touches a goal, connect your answer to it and propose the single next action that moves it. When asked about goals/progress, render progress_bars from the percentages above. If real activity suggests a goal is already won or mis-aimed, say so — the Brain reviews and upgrades the goal book continuously.\n';
  return out;
}

// ── Generation ────────────────────────────────────────────────────────────────

// Write the company's goal book. Skips when active goals already exist (unless
// force). Grounded in workspace context; deliberately ambitious per owner
// directive: short horizons, stretch-to-moonshot targets.
export async function generateCompanyGoals(db, { workspaceId, force = false }) {
  const { data: existing } = await db.from('brain_goals').select('id')
    .eq('workspace_id', workspaceId).eq('scope', 'company').eq('status', 'active').limit(1);
  if (existing?.length && !force) return { generated: 0, reason: 'exists' };

  const { data: ws } = await db.from('workspaces')
    .select('name, industry, size, location, context').eq('id', workspaceId).single();
  if (!ws) return { generated: 0, reason: 'no_workspace' };
  const llm = await resolveLLM(workspaceId, db);
  if (!llm) return { generated: 0, reason: 'no_llm' };

  const sys = 'You are the goal-setting core of an AI Company Brain. You write aggressive, concrete, measurable goals that force a company to move faster than it believed possible. Return ONLY JSON.';
  const user = `Company: ${oneLine(ws.name, 120)}${ws.industry ? ` (${oneLine(ws.industry, 80)})` : ''}${ws.size ? `, team size ${oneLine(ws.size, 40)}` : ''}${ws.location ? `, ${oneLine(ws.location, 80)}` : ''}
KNOWN CONTEXT:\n${contextLines(ws) || '(early-stage workspace — derive goals from the industry and company size)'}

Write 4-5 company goals for the next 14-60 days. Rules:
- AGGRESSIVE by design: each goal should feel almost unrealistic but be physically achievable with focus. Mix ambition: mostly "stretch", at least one "moonshot".
- CONCRETE + MEASURABLE: every goal has a metric and a numeric/observable target. No vague "improve X".
- SHORT HORIZONS: 14-60 days, never longer.
- Tailored to THIS company's industry, stage and size — not generic startup advice.
Return JSON {"goals":[{"title":"imperative, specific","description":"1-2 sentences","metric":"what is measured","target":"the number/state to hit","horizon_days":14-60,"ambition":"stretch|moonshot","rationale":"why this goal, why now"}]}`;

  let goals = [];
  try { goals = extractJson(await callLLM(llm, sys, user, { maxTokens: 1200 }))?.goals || []; }
  catch (e) { console.error('[goals] company generation failed:', e.message); return { generated: 0, reason: e.message }; }

  const rows = goals.slice(0, MAX_COMPANY_GOALS)
    .map(g => sanitizeGoal(g, { workspaceId, scope: 'company' })).filter(Boolean);
  if (!rows.length) return { generated: 0, reason: 'empty' };
  const { error } = await db.from('brain_goals').insert(rows);
  if (error) { console.error('[goals] insert:', error.message); return { generated: 0, reason: error.message }; }
  recordSignal(db, { workspaceId, domain: 'brain', subjectType: 'goals', subjectId: workspaceId, signal: 'generated', value: rows.length, meta: { scope: 'company' } }).catch(() => {});
  console.log('[goals] company goals generated ws=%s n=%d', workspaceId, rows.length);
  return { generated: rows.length, goals: rows.map(r => r.title) };
}

// Role-scoped goals for one staff member's daemon, written at onboarding.
export async function generateStaffGoals(db, { workspaceId, userId, role = null, force = false }) {
  const { data: existing } = await db.from('brain_goals').select('id')
    .eq('workspace_id', workspaceId).eq('user_id', userId).eq('scope', 'staff').eq('status', 'active').limit(1);
  if (existing?.length && !force) return { generated: 0, reason: 'exists' };

  const [{ data: ws }, { data: profile }, companyGoalsRes] = await Promise.all([
    db.from('workspaces').select('name, industry, size, context').eq('id', workspaceId).single(),
    db.from('profiles').select('name, title, role').eq('id', userId).single(),
    db.from('brain_goals').select('title, target').eq('workspace_id', workspaceId)
      .eq('scope', 'company').eq('status', 'active').limit(MAX_COMPANY_GOALS),
  ]);
  const roleLabel = oneLine(role || profile?.title || profile?.role, 100) || 'team member';
  const llm = await resolveLLM(workspaceId, db);
  if (!llm) return { generated: 0, reason: 'no_llm' };

  const companyGoals = (companyGoalsRes.data || []).map(g => `- ${g.title}${g.target ? ` → ${g.target}` : ''}`).join('\n');
  const sys = 'You set aggressive personal operating goals for ONE employee\'s AI daemon, derived from their role and the company\'s goals. Return ONLY JSON.';
  const user = `Employee: ${oneLine(profile?.name, 80) || 'a staff member'} — ${roleLabel}
Company: ${oneLine(ws?.name, 120)}${ws?.industry ? ` (${oneLine(ws.industry, 80)})` : ''}
COMPANY GOALS:\n${companyGoals || '(not yet set)'}
COMPANY CONTEXT:\n${contextLines(ws) || '(none)'}

Write 3 goals for this person's daemon for the next 14-45 days. Rules:
- Each must be something a ${roleLabel} can actually move, and should ladder up to a company goal when one fits.
- AGGRESSIVE but achievable with focus; measurable metric + target each.
Return JSON {"goals":[{"title":"...","description":"...","metric":"...","target":"...","horizon_days":14-45,"ambition":"stretch|moonshot","rationale":"..."}]}`;

  let goals = [];
  try { goals = extractJson(await callLLM(llm, sys, user, { maxTokens: 900 }))?.goals || []; }
  catch (e) { console.error('[goals] staff generation failed:', e.message); return { generated: 0, reason: e.message }; }

  const rows = goals.slice(0, MAX_STAFF_GOALS)
    .map(g => sanitizeGoal(g, { workspaceId, userId, scope: 'staff' })).filter(Boolean);
  if (!rows.length) return { generated: 0, reason: 'empty' };
  const { error } = await db.from('brain_goals').insert(rows);
  if (error) { console.error('[goals] staff insert:', error.message); return { generated: 0, reason: error.message }; }
  recordSignal(db, { workspaceId, domain: 'brain', subjectType: 'goals', subjectId: userId, signal: 'generated', value: rows.length, meta: { scope: 'staff', role: roleLabel } }).catch(() => {});
  return { generated: rows.length, goals: rows.map(r => r.title) };
}

// Cron-safe: make sure every active workspace + every onboarded staff member has
// a goal book. Covers workspaces created before this feature shipped.
export async function ensureGoals(db, workspaceId) {
  const out = { company: 0, staff: 0 };
  try {
    const company = await generateCompanyGoals(db, { workspaceId });
    out.company = company.generated || 0;
    const { data: members } = await db.from('workspace_members')
      .select('user_id').eq('workspace_id', workspaceId).limit(50);
    for (const m of members || []) {
      const { data: has } = await db.from('brain_goals').select('id')
        .eq('user_id', m.user_id).eq('scope', 'staff').eq('status', 'active').limit(1);
      if (has?.length) continue;
      const r = await generateStaffGoals(db, { workspaceId, userId: m.user_id });
      out.staff += r.generated || 0;
    }
  } catch (e) { console.error('[goals] ensureGoals ws=%s:', workspaceId, e.message); }
  return out;
}

// ── Review: the self-upgrading loop ──────────────────────────────────────────
// Daily per workspace. The brain measures progress from real activity, then
// rewrites its own goal book: upgrades targets that proved too easy, adjusts
// mis-aimed goals, adds new ones when signals open opportunities, marks
// achieved/missed, and chains a harder successor onto every win.
export async function reviewGoals(db, workspaceId) {
  const { data: goals } = await db.from('brain_goals')
    .select('id, user_id, scope, title, description, metric, target, progress, ambition, horizon_days, due_at, status, created_at, last_review_at')
    .eq('workspace_id', workspaceId).eq('status', 'active')
    .order('created_at').limit(30);
  if (!goals?.length) return { reviewed: 0 };

  // Review at most once per ~20h per workspace (cron is daily; guard double-runs).
  const newest = goals.map(g => g.last_review_at).filter(Boolean).sort().pop();
  if (newest && Date.now() - new Date(newest).getTime() < 20 * 3600e3) return { reviewed: 0, reason: 'recent' };

  const llm = await resolveLLM(workspaceId, db);
  if (!llm) return { reviewed: 0, reason: 'no_llm' };

  // Cheap, real evidence of the week's activity.
  const since = new Date(Date.now() - 7 * 864e5).toISOString();
  const [ws, inter, actions, doneTasks, findings, resolved] = await Promise.all([
    db.from('workspaces').select('name, industry, context').eq('id', workspaceId).single(),
    db.from('brain_interactions').select('id', { count: 'exact', head: true }).eq('workspace_id', workspaceId).gte('created_at', since),
    db.from('daemon_actions').select('title, status').eq('workspace_id', workspaceId).gte('created_at', since).limit(40),
    db.from('tasks').select('title, status').eq('workspace_id', workspaceId).gte('created_at', since).limit(40),
    db.from('hunt_findings').select('pattern, severity').eq('workspace_id', workspaceId).eq('resolved', false).order('created_at', { ascending: false }).limit(12),
    db.from('hunt_findings').select('id', { count: 'exact', head: true }).eq('workspace_id', workspaceId).eq('resolved', true).gte('created_at', since),
  ]);
  const approvedActions = (actions.data || []).filter(a => ['approved', 'done'].includes(a.status));
  const completedTasks = (doneTasks.data || []).filter(t => ['done', 'completed'].includes(String(t.status || '').toLowerCase()));
  const evidence = [
    `Daemon interactions (7d): ${inter.count ?? 0}`,
    `Daemon actions approved/done (7d): ${approvedActions.length} — ${approvedActions.slice(0, 8).map(a => a.title).join(' · ') || 'none'}`,
    `Tasks completed (7d): ${completedTasks.length} — ${completedTasks.slice(0, 8).map(t => t.title).join(' · ') || 'none'}`,
    `Findings resolved (7d): ${resolved.count ?? 0}`,
    `Open findings: ${(findings.data || []).map(f => `[${f.severity}] ${f.pattern}`).join(' · ') || 'none'}`,
  ].join('\n');

  const goalList = goals.map((g, i) =>
    `[${i}] (${g.scope}${g.ambition === 'moonshot' ? ' · moonshot' : ''}) ${g.title}` +
    `${g.target ? ` → ${g.target}` : ''}${g.metric ? ` (metric: ${g.metric})` : ''}` +
    ` · ${g.progress}% · due ${String(g.due_at || '').slice(0, 10)}`).join('\n');

  const sys = 'You are the self-upgrading goal engine of an AI Company Brain. You review the goal book against real activity, then make it MORE ambitious: upgrade targets that proved too easy, fix mis-aimed goals, add new goals when signals reveal opportunities, and mark wins/misses honestly. Return ONLY JSON.';
  const user = `Company: ${oneLine(ws.data?.name, 120)}${ws.data?.industry ? ` (${oneLine(ws.data.industry, 80)})` : ''}
CONTEXT:\n${contextLines(ws.data) || '(none)'}
ACTIVITY EVIDENCE (last 7 days):\n${evidence}
GOAL BOOK:\n${goalList}

For EACH goal return an assessment; optionally adjust it; optionally add up to 2 NEW company-level goals if the evidence reveals an opportunity or gap no current goal covers.
Rules:
- "progress" 0-100, honest, grounded ONLY in the evidence (no progress without evidence).
- "status": "active" | "achieved" (target verifiably hit) | "missed" (past due with low progress).
- "adjust": include ONLY when the goal should change — e.g. target too easy (raise it), wrong metric, horizon too long (shorten). Adjusting must make it MORE aggressive or better aimed, never softer (unless clearly mis-aimed).
- New goals: aggressive, measurable, 14-60 day horizons.
Return JSON {"reviews":[{"idx":0,"progress":0-100,"status":"active|achieved|missed","note":"one sharp sentence","adjust":{"title":"...","target":"...","metric":"...","horizon_days":14-60,"ambition":"stretch|moonshot"}}],"new_goals":[{"title":"...","description":"...","metric":"...","target":"...","horizon_days":14-60,"ambition":"stretch|moonshot","rationale":"the evidence that justifies it"}]}`;

  let parsed;
  try { parsed = extractJson(await callLLM(llm, sys, user, { maxTokens: 1600 })); }
  catch (e) { console.error('[goals] review llm ws=%s:', workspaceId, e.message); return { reviewed: 0, reason: e.message }; }
  const reviews = Array.isArray(parsed?.reviews) ? parsed.reviews : [];
  const nowISO = new Date().toISOString();
  let achieved = 0, adjusted = 0, escalated = 0, added = 0;

  for (const r of reviews) {
    const g = goals[Number(r.idx)];
    if (!g) continue;
    const progress = Math.max(0, Math.min(100, Number(r.progress) || 0));
    const status = ['active', 'achieved', 'missed'].includes(r.status) ? r.status : 'active';
    const upd = { progress, status, review_note: oneLine(r.note, 300) || null, last_review_at: nowISO, updated_at: nowISO };

    // SELF-ADJUSTMENT: the brain rewrites its own goal in place (always upward).
    if (r.adjust && typeof r.adjust === 'object' && status === 'active') {
      if (r.adjust.title) upd.title = oneLine(r.adjust.title, 160);
      if (r.adjust.target) upd.target = oneLine(r.adjust.target, 160);
      if (r.adjust.metric) upd.metric = oneLine(r.adjust.metric, 160);
      if (['stretch', 'moonshot'].includes(r.adjust.ambition)) upd.ambition = r.adjust.ambition;
      if (r.adjust.horizon_days) Object.assign(upd, dueAt(r.adjust.horizon_days));
      adjusted++;
    }
    await db.from('brain_goals').update(upd).eq('id', g.id);

    // RAISE THE BAR: every achieved goal chains a harder successor immediately.
    if (status === 'achieved') {
      achieved++;
      try {
        const succSys = 'A company just achieved a goal. Write the next goal in the chain: meaningfully HARDER (higher target, same or shorter horizon), same direction. Return ONLY JSON.';
        const succUser = `Achieved: "${g.title}"${g.target ? ` → ${g.target}` : ''} (${g.scope} goal, metric: ${g.metric || 'n/a'}, ${g.horizon_days}d horizon).
Return JSON {"title":"...","description":"...","metric":"...","target":"noticeably beyond the previous","horizon_days":14-45,"ambition":"stretch|moonshot","rationale":"raising the bar after a win"}`;
        const succ = extractJson(await callLLM(llm, succSys, succUser, { maxTokens: 400 }));
        const row = sanitizeGoal(succ, { workspaceId, userId: g.user_id, scope: g.scope, parentGoalId: g.id });
        if (row) { await db.from('brain_goals').insert(row); added++; }
      } catch (e) { console.warn('[goals] successor failed:', e.message); }
    }

    // STALL ESCALATION: past 60% of horizon with <25% progress → hunt finding
    // (the existing routing surfaces it to the right daemons as an alert).
    const ageDays = (Date.now() - new Date(g.created_at).getTime()) / 864e5;
    if (status === 'active' && progress < 25 && ageDays > 0.6 * g.horizon_days) {
      const { data: dupe } = await db.from('hunt_findings').select('id')
        .eq('workspace_id', workspaceId).eq('resolved', false).ilike('pattern', `%${g.title.slice(0, 60)}%`).limit(1);
      if (!dupe?.length) {
        await db.from('hunt_findings').insert({
          workspace_id: workspaceId, hunt_mode: 'performance', severity: 'warning',
          pattern: `Goal stalling: "${g.title}" is at ${progress}% with ${Math.max(0, Math.round(g.horizon_days - ageDays))} days left`,
          recommendation: oneLine(r.note, 200) || 'Re-plan this goal: break it into this week\'s three highest-leverage actions or re-aim it.',
          occurrences: 1, affected_roles: g.scope === 'company' ? ['ceo'] : [],
        });
        escalated++;
      }
    }
  }

  // SELF-EXPANSION: add brand-new goals the evidence justifies (capped).
  const { data: activeCount } = await db.from('brain_goals').select('id')
    .eq('workspace_id', workspaceId).eq('scope', 'company').eq('status', 'active');
  let room = MAX_COMPANY_GOALS - (activeCount?.length || 0);
  for (const ng of (Array.isArray(parsed?.new_goals) ? parsed.new_goals : []).slice(0, 2)) {
    if (room <= 0) break;
    const row = sanitizeGoal(ng, { workspaceId, scope: 'company' });
    if (row) { await db.from('brain_goals').insert(row); added++; room--; }
  }

  await upsertInsight(db, {
    workspaceId, domain: 'brain', scope: { kind: 'goals' }, kind: 'goal_review',
    insight: `Goal review: ${reviews.length} reviewed, ${achieved} achieved (bar raised), ${adjusted} self-upgraded, ${added} added, ${escalated} escalated.`,
    confidence: 0.7, evidence: { achieved, adjusted, added, escalated },
  }).catch(() => {});
  recordSignal(db, { workspaceId, domain: 'brain', subjectType: 'goals', subjectId: workspaceId, signal: 'reviewed', value: reviews.length, meta: { achieved, adjusted, added, escalated } }).catch(() => {});
  console.log('[goals] review ws=%s reviewed=%d achieved=%d adjusted=%d added=%d escalated=%d', workspaceId, reviews.length, achieved, adjusted, added, escalated);
  return { reviewed: reviews.length, achieved, adjusted, added, escalated };
}
