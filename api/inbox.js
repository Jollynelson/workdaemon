import { requireAuth, adminClient } from './_lib/supabase.js';
import { fail, enforceRateLimit } from './_lib/security.js';

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const user = await requireAuth(req, res);
  if (!user) return;

  if (!(await enforceRateLimit(res, { key: `inbox:${user.id}`, max: 120, windowSec: 60 }))) return;

  const { data: rows, error } = await adminClient()
    .from('inbox_items')
    .select('*')
    .eq('user_id', user.id)
    .order('created_at', { ascending: false });

  if (error) return fail(res, 500, 'Could not load inbox', error, 'inbox');

  // Shape rows into the fields the Inbox UI expects (unread/time/level/icon).
  const SEV_LEVEL = { critical: 'danger', warning: 'warning' };
  const items = (rows ?? []).map(r => ({
    id:     r.id,
    type:   r.type,
    title:  r.title,
    body:   r.body,
    source: r.source === 'daemon' ? 'Daemon' : (r.source || 'Daemon'),
    icon:   r.source === 'daemon' ? 'WD' : undefined,
    level:  SEV_LEVEL[r.metadata?.severity],
    unread: !r.read,
    time:   r.created_at ? new Date(r.created_at).toLocaleString() : '',
    metadata: r.metadata ?? null,
  }));

  return res.status(200).json({ items });
}
