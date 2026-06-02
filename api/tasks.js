import { requireAuth, adminClient } from './_lib/supabase.js';
import { fail, enforceRateLimit } from './_lib/security.js';

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const user = await requireAuth(req, res);
  if (!user) return;

  if (!(await enforceRateLimit(res, { key: `tasks:${user.id}`, max: 120, windowSec: 60 }))) return;

  const db = adminClient();

  const { data: profile } = await db
    .from('profiles')
    .select('workspace_id')
    .eq('id', user.id)
    .single();

  if (!profile?.workspace_id) return res.status(200).json({ tasks: [] });

  const { data: tasks, error } = await db
    .from('tasks')
    .select('*, assignee:assignee_id(id, raw_user_meta_data)')
    .eq('workspace_id', profile.workspace_id)
    .order('created_at', { ascending: false });

  if (error) return fail(res, 500, 'Could not load tasks', error, 'tasks');

  return res.status(200).json({ tasks: tasks ?? [] });
}
