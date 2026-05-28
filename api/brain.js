import { requireAuth, adminClient } from './_lib/supabase.js';

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const user = await requireAuth(req, res);
  if (!user) return;

  const db = adminClient();

  // Verify user is a workspace admin
  const { data: member } = await db
    .from('workspace_members')
    .select('role')
    .eq('user_id', user.id)
    .single();

  if (member?.role !== 'admin') {
    return res.status(403).json({ error: 'Admin access required' });
  }

  return res.status(200).json({
    documents: [],
    stats: { documents: 0, queries: 0, lastSync: null },
  });
}
