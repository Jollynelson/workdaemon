import { requireAuth, adminClient } from './_lib/supabase.js';
import { enforceRateLimit } from './_lib/security.js';
import { waitUntil } from '@vercel/functions';
import { readRawBody, verifySlackSignature, processSlackEvent } from './_lib/connectors/slack_events.js';
import { activeGoals } from './_lib/goals.js';

// Raw body needed to verify Slack's signature — disable Vercel's parser. This
// route is otherwise GET-only (no parsed body needed), so this is safe.
export const config = { api: { bodyParser: false } };

export default async function handler(req, res) {
  // ── Slack Events API endpoint (POST /api/slack/events → rewritten here) ──────
  if (req.method === 'POST' && req.query.__slack === 'events') {
    const raw = await readRawBody(req);
    if (!verifySlackSignature(raw, req.headers)) return res.status(401).json({ error: 'bad signature' });
    let payload;
    try { payload = JSON.parse(raw); } catch { return res.status(400).json({ error: 'bad payload' }); }
    // url_verification must answer with the challenge synchronously.
    if (payload.type === 'url_verification') {
      return res.status(200).json(await processSlackEvent(adminClient(), payload));
    }
    // Slack retries on a slow ack — we already process via waitUntil, so skip
    // retries to avoid double-replying / double-processing.
    if (req.headers['x-slack-retry-num']) return res.status(200).json({ ok: true });
    // Ack within Slack's 3s window; process in the background (waitUntil keeps
    // the function alive so the work actually completes).
    waitUntil(processSlackEvent(adminClient(), payload).catch(e => console.error('[slack_events]', e.message)));
    return res.status(200).json({ ok: true });
  }

  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const user = await requireAuth(req, res);
  if (!user) return;

  if (!(await enforceRateLimit(res, { key: `overview:${user.id}`, max: 120, windowSec: 60 }))) return;

  const db = adminClient();

  const { data: profile } = await db
    .from('profiles')
    .select('workspace_id')
    .eq('id', user.id)
    .single();

  if (!profile?.workspace_id) {
    return res.status(200).json({ stats: [], activity: [], team: [], integrations: [], alerts: [], brainLastSync: null });
  }
  const ws = profile.workspace_id;

  const todayStart = new Date(); todayStart.setUTCHours(0, 0, 0, 0);
  const todayISO = todayStart.toISOString();
  const dayAgoISO = new Date(Date.now() - 86400000).toISOString();
  const monthStart = new Date(); monthStart.setUTCDate(1); monthStart.setUTCHours(0, 0, 0, 0);
  const monthISO = monthStart.toISOString();

  // ── Daily digest — the once-a-day "morning briefing" cards on first login.
  // DETERMINISTIC: pure aggregation of real state, NO LLM call (so opening the
  // daemon never "starts spinning"). Returns only non-empty cards; the client
  // gates display to once/day after 6am local. Open to all members. ───────────
  if (req.query.view === 'digest') {
    const [profRes, findRes, taskRes, inboxRes, integ2Res, actRes, goals] = await Promise.all([
      db.from('profiles').select('name, title').eq('id', user.id).maybeSingle(),
      db.from('hunt_findings').select('id, pattern, severity, recommendation, hunt_mode')
        .eq('workspace_id', ws).eq('resolved', false).order('severity', { ascending: false }).limit(4),
      db.from('tasks').select('id, title, status, assignee_id, created_at')
        .eq('workspace_id', ws).neq('status', 'done').order('created_at', { ascending: false }).limit(60),
      db.from('inbox_items').select('id, title, type, created_at')
        .eq('user_id', user.id).eq('read', false).order('created_at', { ascending: false }).limit(6),
      db.from('workspace_integrations').select('provider, status').eq('workspace_id', ws),
      db.from('daemon_actions').select('id, title, type, created_at, status')
        .eq('workspace_id', ws).eq('status', 'pending').order('created_at', { ascending: false }).limit(25),
      activeGoals(db, { workspaceId: ws, userId: user.id }).catch(() => ({ company: [], staff: [] })),
    ]);

    const firstName = (profRes.data?.name || '').trim().split(/\s+/)[0] || null;
    const findings = findRes.data || [];
    const openTasks = taskRes.data || [];
    const unread = inboxRes.data || [];
    const integrations2 = integ2Res.data || [];
    const pendingActs = actRes.data || [];
    const cards = [];

    // 1. Brain findings — what the company brain noticed (risks, patterns).
    if (findings.length) {
      cards.push({
        id: 'findings', kind: 'findings', icon: '◈', title: 'Brain findings', count: findings.length,
        items: findings.map(f => ({
          text: (f.pattern || f.recommendation || 'Pattern detected').slice(0, 140),
          sub: (f.pattern && f.recommendation) ? f.recommendation.slice(0, 120) : (f.hunt_mode || null),
          severity: f.severity || null,
        })),
        cta: { label: 'Walk me through these', ask: 'Walk me through the top brain finding and what I should do about it.' },
      });
    }

    // 2. Pending tasks — open work, yours first.
    if (openTasks.length) {
      const mine = openTasks.filter(t => t.assignee_id === user.id);
      const ordered = [...mine, ...openTasks.filter(t => t.assignee_id !== user.id)];
      cards.push({
        id: 'tasks', kind: 'tasks', icon: '✓', title: 'Pending tasks', count: openTasks.length,
        items: ordered.slice(0, 4).map(t => ({
          text: (t.title || 'Untitled task').slice(0, 140),
          sub: t.assignee_id === user.id ? 'Assigned to you' : (t.status === 'in_progress' ? 'In progress' : null),
        })),
        cta: { label: 'Open Tasks', to: '/app/tasks' },
      });
    }

    // 3. Issues — things that are off: integrations down, approvals waiting.
    const issueItems = [];
    for (const i of integrations2) {
      if (i.status && i.status !== 'connected') issueItems.push({ text: `${i.provider} integration: ${i.status}`, severity: 'warning', to: '/app/integrations' });
    }
    const staleActs = pendingActs.filter(a => a.created_at && a.created_at < dayAgoISO).length;
    if (pendingActs.length) {
      issueItems.push({
        text: `${pendingActs.length} action${pendingActs.length > 1 ? 's' : ''} waiting for your approval${staleActs ? ` (${staleActs} over 24h)` : ''}`,
        severity: staleActs ? 'critical' : 'warning', to: '/app/activity',
      });
    }
    if (issueItems.length) {
      cards.push({
        id: 'issues', kind: 'issues', icon: '⚠', title: 'Needs attention', count: issueItems.length,
        items: issueItems.slice(0, 4),
        cta: { label: 'Review', to: issueItems[0]?.to || '/app/activity' },
      });
    }

    // 4. Inbox — unread daemon/Slack items.
    if (unread.length) {
      cards.push({
        id: 'inbox', kind: 'inbox', icon: '✉', title: 'Unread inbox', count: unread.length,
        items: unread.slice(0, 4).map(it => ({ text: (it.title || 'New item').slice(0, 140), sub: it.type || null })),
        cta: { label: 'Open Inbox', to: '/app/inbox' },
      });
    }

    // Quiet morning → a friendly "all clear" card so the briefing still greets
    // you once a day instead of showing nothing.
    const hadSubstance = cards.length > 0;
    if (!hadSubstance) {
      cards.push({
        id: 'allclear', kind: 'allclear', icon: '✓', title: 'All clear',
        items: [{ text: 'Nothing needs you right now — no findings, tasks, or issues waiting.' }],
      });
    }

    // 5. Suggestions — concrete next steps you can tap to ask the daemon.
    const suggestions = [];
    const goal = goals?.staff?.[0] || goals?.company?.[0];
    if (goal?.title) suggestions.push(`What's the fastest next step on "${String(goal.title).slice(0, 70)}"?`);
    if (pendingActs.length) suggestions.push(`Summarize the ${pendingActs.length} approvals waiting on me`);
    const connected = integrations2.filter(i => i.status === 'connected').length;
    if (connected < 2) suggestions.push('What can you do for me once I connect a tool?');
    suggestions.push('What needs my attention today?');
    cards.push({
      id: 'suggestions', kind: 'suggestions', icon: '✦', title: 'Suggestions',
      items: [...new Set(suggestions)].slice(0, 3).map(s => ({ text: s, ask: s })),
    });

    return res.status(200).json({ name: firstName, cards });
  }

  // ── Crew directory (§4) — teammates + their Daemons. Open to all members. ────
  if (req.query.view === 'crew') {
    const [profRes, activeRes, tasksRes] = await Promise.all([
      db.from('profiles').select('id, name, title, role, permission_level, created_at').eq('workspace_id', ws),
      db.from('brain_interactions').select('user_id, created_at').eq('workspace_id', ws).gte('created_at', dayAgoISO),
      db.from('tasks').select('assignee_id, title, status, updated_at').eq('workspace_id', ws).order('updated_at', { ascending: false }).limit(80),
    ]);
    const lastActive = {};
    for (const r of (activeRes.data ?? [])) { if (!lastActive[r.user_id] || r.created_at > lastActive[r.user_id]) lastActive[r.user_id] = r.created_at; }
    const latestTask = {};
    for (const t of (tasksRes.data ?? [])) { if (t.assignee_id && !latestTask[t.assignee_id]) latestTask[t.assignee_id] = t; }
    const crew = (profRes.data ?? []).map(m => ({
      id: m.id,
      name: m.name || 'Member',
      role: m.title || m.role || 'Member',
      level: m.permission_level ?? 2,
      joinedAt: m.created_at || null,
      status: lastActive[m.id] ? 'online' : 'away',
      activity: latestTask[m.id] ? `${latestTask[m.id].status === 'done' ? 'Completed' : 'Working on'}: ${latestTask[m.id].title}` : null,
    }));
    return res.status(200).json({ crew, me: user.id });
  }

  // ── Activity (§9) — what the workspace's daemons are DOING NOW / have DONE /
  // will DO next. Open to all members. Grounds purely on real autonomous signals
  // (no chat replies): action queue, scheduled outbox, agent runs, cross-daemon
  // events. Empty buckets are honest — they fill as daemons act. ───────────────
  if (req.query.view === 'activity') {
    const nowISO = new Date().toISOString();
    const [actRes, outRes, runRes, agentRes, evRes, profRes] = await Promise.all([
      db.from('daemon_actions').select('id, title, type, status, rationale, created_at, acted_at, agent_id').eq('workspace_id', ws).order('created_at', { ascending: false }).limit(40),
      db.from('daemon_outbox').select('id, kind, title, message, deliver_at, status, delivered_at, user_id, created_at').eq('workspace_id', ws).order('deliver_at', { ascending: false }).limit(40),
      db.from('agent_runs').select('id, agent_id, status, phase, started_at, finished_at, error').eq('workspace_id', ws).order('started_at', { ascending: false }).limit(20),
      db.from('agents').select('id, name, role, status, next_run_at').eq('workspace_id', ws),
      db.from('daemon_events').select('id, type, payload, from_user_id, status, created_at, resolved_at').eq('workspace_id', ws).order('created_at', { ascending: false }).limit(25),
      db.from('profiles').select('id, name, title').eq('workspace_id', ws),
    ]);
    const nameOf = Object.fromEntries((profRes.data ?? []).map(p => [p.id, p.name || p.title || 'A teammate']));
    const agentName = Object.fromEntries((agentRes.data ?? []).map(a => [a.id, a.name || a.role || 'Daemon']));
    const now = [], upcoming = [], done = [];

    for (const r of (runRes.data ?? [])) {
      const who = agentName[r.agent_id] || 'A daemon';
      if (!r.finished_at) now.push({ id: 'run-' + r.id, kind: 'agent', title: `${who} is running`, detail: r.phase ? `Phase: ${r.phase}` : 'In progress', at: r.started_at, status: 'running' });
      else done.push({ id: 'run-' + r.id, kind: 'agent', title: `${who} ${r.status === 'error' ? 'hit an error' : 'finished a run'}`, detail: r.error || r.phase || '', at: r.finished_at, status: r.status === 'error' ? 'failed' : 'done' });
    }
    for (const a of (actRes.data ?? [])) {
      const base = { id: 'act-' + a.id, kind: 'action', detail: a.rationale || '' };
      const label = a.title || a.type || 'Daemon action';
      if (a.status === 'pending') upcoming.push({ ...base, title: `Needs your approval: ${label}`, at: a.created_at, status: 'pending', age: true });
      else if (a.status === 'running') now.push({ ...base, title: label, at: a.created_at, status: 'running' });
      else done.push({ ...base, title: label, at: a.acted_at || a.created_at, status: a.status || 'done' });
    }
    for (const o of (outRes.data ?? [])) {
      const t = o.title || (o.message ? o.message.slice(0, 60) : 'Scheduled message');
      if (o.status === 'delivered' || o.delivered_at) done.push({ id: 'out-' + o.id, kind: 'scheduled', title: `Delivered: ${t}`, detail: '', at: o.delivered_at || o.created_at, status: 'done' });
      else if (o.deliver_at && o.deliver_at > nowISO) upcoming.push({ id: 'out-' + o.id, kind: 'scheduled', title: `Will deliver: ${t}`, detail: `to ${nameOf[o.user_id] || 'you'}`, at: o.deliver_at, status: 'scheduled' });
    }
    for (const a of (agentRes.data ?? [])) {
      if (a.status === 'active' && a.next_run_at && a.next_run_at > nowISO) upcoming.push({ id: 'agent-' + a.id, kind: 'agent', title: `${a.name || a.role || 'Daemon'} runs next`, detail: a.role || '', at: a.next_run_at, status: 'scheduled' });
    }
    for (const e of (evRes.data ?? [])) {
      const who = e.payload?.source === 'brain' ? 'The Company Brain' : (nameOf[e.from_user_id] || 'A daemon');
      const p = e.payload || {};
      const label = e.type === 'assignment' ? `${who} assigned “${p.title || 'a task'}”`
        : e.type === 'flag' ? `${who} flagged a capacity risk on “${p.title || 'a task'}”`
        : e.type === 'accepted' ? `${who} accepted “${p.title || 'a task'}”`
        : e.type === 'broadcast' ? `${who} broadcast to the company`
        : `${who}: ${e.type}`;
      const isPending = e.status === 'pending';
      // Pending events sit in Upcoming but their timestamp is when they were
      // RAISED (past) — flag age:true so the UI labels it "raised Nd ago", not a
      // schedule. Resolved events go to Done where a plain "ago" reads correctly.
      const item = { id: 'ev-' + e.id, kind: 'coordination', title: label, detail: p.reason || p.brief || p.message || '', at: e.created_at, status: isPending ? 'pending' : 'done', age: isPending };
      (isPending ? upcoming : done).push(item);
    }

    now.sort((a, b) => String(b.at || '').localeCompare(String(a.at || '')));
    upcoming.sort((a, b) => String(a.at || '').localeCompare(String(b.at || '')));   // soonest first
    done.sort((a, b) => String(b.at || '').localeCompare(String(a.at || '')));        // newest first
    return res.status(200).json({ now: now.slice(0, 20), upcoming: upcoming.slice(0, 25), done: done.slice(0, 40), me: user.id });
  }

  // All independent — fan out, and never let one failed table sink the page.
  const [membersRes, tasksRes, brainCountRes, pendingRes, integRes, actRes, activeRes, tokenRes] = await Promise.all([
    // profiles is the reliable membership source (a fragile workspace_members→profiles
    // embed silently errored → Active Daemons read 0 for workspaces with members).
    db.from('profiles').select('id, name, title, role').eq('workspace_id', ws),
    db.from('tasks').select('status, updated_at').eq('workspace_id', ws),
    db.from('brain_interactions').select('id', { count: 'exact', head: true }).eq('workspace_id', ws).gte('created_at', todayISO),
    db.from('daemon_actions').select('created_at', { count: 'exact' }).eq('workspace_id', ws).eq('status', 'pending'),
    db.from('workspace_integrations').select('provider, status, updated_at').eq('workspace_id', ws),
    db.from('daemon_actions').select('title, type, status, created_at').eq('workspace_id', ws).order('created_at', { ascending: false }).limit(8),
    db.from('brain_interactions').select('user_id').eq('workspace_id', ws).gte('created_at', dayAgoISO),
    db.from('token_usage').select('user_id, total_tokens, estimated').eq('workspace_id', ws).gte('created_at', monthISO).limit(20000),
  ]);

  const members = membersRes.data ?? [];
  const tasks = tasksRes.data ?? [];
  const integrations = integRes.data ?? [];
  const pending = pendingRes.data ?? [];
  const activeIds = new Set((activeRes.data ?? []).map(r => r.user_id));

  const completedToday = tasks.filter(t => t.status === 'done' && t.updated_at && t.updated_at >= todayISO).length;
  const brainToday = brainCountRes.count ?? 0;
  const pendingApprovals = pendingRes.count ?? pending.length;

  // Spec §9 metric cards.
  const stats = [
    { label: 'Active Daemons',      value: String(members.length),  unit: 'members',  accent: 'blue' },
    { label: 'Tasks Done Today',    value: String(completedToday),  unit: 'today',    accent: 'green' },
    { label: 'Brain Queries Today', value: String(brainToday),      unit: 'today',    accent: 'purple' },
    { label: 'Pending Approvals',   value: String(pendingApprovals), unit: 'awaiting', accent: 'amber' },
  ];

  const team = members.map(m => ({
    name: m.name || 'Member',
    role: m.title || m.role || 'Member',
    status: activeIds.has(m.id) ? 'online' : 'away',
  }));

  const integHealth = integrations.map(i => ({ provider: i.provider, status: i.status || 'unknown', lastSync: i.updated_at || null }));
  const brainLastSync = integrations.reduce((max, i) => (i.updated_at && (!max || i.updated_at > max) ? i.updated_at : max), null);

  // Spec §9 system alerts — derived from real state.
  const alerts = [];
  const staleApprovals = pending.filter(a => a.created_at && a.created_at < dayAgoISO).length;
  if (staleApprovals > 0) alerts.push({ level: 'warning', text: `${staleApprovals} approval${staleApprovals > 1 ? 's' : ''} pending over 24h` });
  for (const i of integHealth) {
    if (i.status && i.status !== 'connected') alerts.push({ level: 'danger', text: `${i.provider} integration: ${i.status}` });
  }

  const activity = (actRes.data ?? []).map(a => ({
    icon: '◆',
    text: a.title || a.type || 'Daemon action',
    source: a.type || 'daemon',
    time: a.created_at,
  }));

  // Token usage this month (IA §9) — total + per-employee breakdown.
  const nameById = {}; for (const m of members) nameById[m.id] = m.name || 'Member';
  const byUser = {}; let totalTokens = 0; let anyEstimated = false;
  for (const r of (tokenRes.data ?? [])) {
    const t = r.total_tokens || 0;
    totalTokens += t;
    if (r.estimated) anyEstimated = true;
    const k = r.user_id || 'system';
    byUser[k] = (byUser[k] || 0) + t;
  }
  const tokenUsage = {
    total: totalTokens,
    estimated: anyEstimated,
    monthLabel: monthStart.toLocaleDateString('en-US', { month: 'long', year: 'numeric' }),
    byUser: Object.entries(byUser)
      .map(([id, tokens]) => ({ name: id === 'system' ? 'Autonomous / system' : (nameById[id] || 'Member'), tokens }))
      .sort((a, b) => b.tokens - a.tokens)
      .slice(0, 5),
  };

  return res.status(200).json({ stats, team, activity, integrations: integHealth, alerts, brainLastSync, tokenUsage });
}
