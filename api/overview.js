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
    return res.status(200).json({ metrics: {}, activity: [], team: [] });
  }

  const [tasksRes, membersRes] = await Promise.all([
    db.from('tasks').select('status').eq('workspace_id', profile.workspace_id),
    db.from('workspace_members')
      .select('user_id, role, joined_at, profiles(name, title)')
      .eq('workspace_id', profile.workspace_id),
  ]);

  const tasks = tasksRes.data ?? [];
  const members = membersRes.data ?? [];

  return res.status(200).json({
    metrics: {
      totalTasks: tasks.length,
      completedTasks: tasks.filter(t => t.status === 'done').length,
      teamSize: members.length,
    },
    activity: [],
    team: members,
  });
}
