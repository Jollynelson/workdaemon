import { requireAuth, adminClient } from '../_lib/supabase.js';

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const user = await requireAuth(req, res);
  if (!user) return;

  const { data: profile } = await adminClient()
    .from('profiles')
    .select('*, workspaces(id, name, size, industry, invite_code)')
    .eq('id', user.id)
    .single();

  return res.status(200).json({ user, profile: profile ?? null });
}
