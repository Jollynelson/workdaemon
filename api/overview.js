import { requireAuth, adminClient } from './_lib/supabase.js';
import { enforceRateLimit } from './_lib/security.js';
import { waitUntil } from '@vercel/functions';
import { readRawBody, verifySlackSignature, processSlackEvent } from './_lib/connectors/slack_events.js';

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

  // All independent — fan out, and never let one failed table sink the page.
  const [membersRes, tasksRes, brainCountRes, pendingRes, integRes, actRes, activeRes] = await Promise.all([
    db.from('workspace_members').select('user_id, role, joined_at, profiles(name, title)').eq('workspace_id', ws),
    db.from('tasks').select('status, updated_at').eq('workspace_id', ws),
    db.from('brain_interactions').select('id', { count: 'exact', head: true }).eq('workspace_id', ws).gte('created_at', todayISO),
    db.from('daemon_actions').select('created_at', { count: 'exact' }).eq('workspace_id', ws).eq('status', 'pending'),
    db.from('workspace_integrations').select('provider, status, updated_at').eq('workspace_id', ws),
    db.from('daemon_actions').select('title, type, status, created_at').eq('workspace_id', ws).order('created_at', { ascending: false }).limit(8),
    db.from('brain_interactions').select('user_id').eq('workspace_id', ws).gte('created_at', dayAgoISO),
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
    name: m.profiles?.name || 'Member',
    role: m.profiles?.title || m.role || 'Member',
    status: activeIds.has(m.user_id) ? 'online' : 'away',
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

  return res.status(200).json({ stats, team, activity, integrations: integHealth, alerts, brainLastSync });
}
