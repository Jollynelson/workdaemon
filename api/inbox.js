import { requireAuth, adminClient } from './_lib/supabase.js';
import { fail, enforceRateLimit, parseBody } from './_lib/security.js';
import { agentsHandler } from './_lib/agents_handler.js';

export default async function handler(req, res) {
  // Multiplex: /api/agents is rewritten to /api/inbox?__agents=1 to stay under
  // Vercel's 12-function cap. The agents handler does its own auth (cron secret,
  // public unsubscribe, then requireAuth), so delegate before inbox's own auth.
  if (req.query?.__agents !== undefined) return agentsHandler(req, res);

  const user = await requireAuth(req, res);
  if (!user) return;

  const db = adminClient();

  // ── POST: mark item(s) read/unread ──────────────────────────────────────────
  if (req.method === 'POST') {
    if (!(await enforceRateLimit(res, { key: `inbox-rw:${user.id}`, max: 120, windowSec: 60 }))) return;

    const body = parseBody(res, req.body, {
      id:   { type: 'string', max: 64 },
      all:  { type: 'boolean' },
      read: { type: 'boolean' },
    });
    if (!body) return;

    const read = body.read !== false; // default true
    let q = db.from('inbox_items').update({ read }).eq('user_id', user.id);
    if (body.all)       { /* all of the user's items */ }
    else if (body.id)   { q = q.eq('id', body.id); }
    else                { return res.status(400).json({ error: 'Provide id or all' }); }

    const { error } = await q;
    if (error) return fail(res, 500, 'Could not update inbox', error, 'inbox');
    return res.status(200).json({ ok: true });
  }

  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  if (!(await enforceRateLimit(res, { key: `inbox:${user.id}`, max: 120, windowSec: 60 }))) return;

  const { data: rows, error } = await db
    .from('inbox_items')
    .select('*')
    .eq('user_id', user.id)
    .order('created_at', { ascending: false });

  if (error) return fail(res, 500, 'Could not load inbox', error, 'inbox');

  // Shape rows into the fields the Inbox UI expects (unread/time/level/icon).
  const SEV_LEVEL = { critical: 'danger', warning: 'warning' };
  const SRC = { daemon: { label: 'Daemon', icon: 'WD' }, slack: { label: 'Slack', icon: 'SL' } };
  const items = (rows ?? []).map(r => {
    const src = SRC[r.source] || { label: r.source ? r.source[0].toUpperCase() + r.source.slice(1) : 'Daemon', icon: undefined };
    return ({
    id:        r.id,
    type:      r.type,
    title:     r.title,
    body:      r.body,
    source:    src.label,
    icon:      src.icon,
    level:     SEV_LEVEL[r.metadata?.severity],
    unread:    !r.read,
    time:      r.created_at ? new Date(r.created_at).toLocaleString() : '',
    draft:     r.metadata?.draft || null,
    findingId: r.metadata?.finding_id || null,
    metadata:  r.metadata ?? null,
  }); });

  return res.status(200).json({ items });
}
