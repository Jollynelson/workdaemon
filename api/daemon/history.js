import { requireAuth, adminClient } from '../_lib/supabase.js';

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const user = await requireAuth(req, res);
  if (!user) return;

  const db = adminClient();

  const { data: rows, error } = await db
    .from('daemon_messages')
    .select('id, role, content, created_at')
    .eq('user_id', user.id)
    .order('created_at', { ascending: false })
    .limit(60);

  if (error) {
    console.error('[daemon/history] db error:', error.message);
    return res.status(500).json({ error: 'Failed to load history' });
  }

  // Return oldest first
  const messages = (rows || []).reverse().map(r => ({
    id: r.id,
    role: r.role,
    content: r.content,
    created_at: r.created_at,
  }));

  return res.status(200).json({ messages });
}
