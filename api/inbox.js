import { requireAuth, adminClient } from './_lib/supabase.js';
import { fail, enforceRateLimit } from './_lib/security.js';

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const user = await requireAuth(req, res);
  if (!user) return;

  if (!(await enforceRateLimit(res, { key: `inbox:${user.id}`, max: 120, windowSec: 60 }))) return;

  const { data: items, error } = await adminClient()
    .from('inbox_items')
    .select('*')
    .eq('user_id', user.id)
    .order('created_at', { ascending: false });

  if (error) return fail(res, 500, 'Could not load inbox', error, 'inbox');

  return res.status(200).json({ items: items ?? [] });
}
