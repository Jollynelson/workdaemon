import { requireAuth, adminClient } from './_lib/supabase.js';

async function isAdmin(userId, db) {
  const { data } = await db
    .from('workspace_members')
    .select('role')
    .eq('user_id', userId)
    .single();
  return data?.role === 'admin';
}

async function getWorkspaceId(userId, db) {
  const { data } = await db
    .from('profiles')
    .select('workspace_id')
    .eq('id', userId)
    .single();
  return data?.workspace_id ?? null;
}

export default async function handler(req, res) {
  const user = await requireAuth(req, res);
  if (!user) return;

  const db = adminClient();
  const workspaceId = await getWorkspaceId(user.id, db);
  if (!workspaceId) return res.status(400).json({ error: 'No workspace' });

  if (!(await isAdmin(user.id, db))) {
    return res.status(403).json({ error: 'Admin access required' });
  }

  // ── GET ──────────────────────────────────────────────────────────────────
  if (req.method === 'GET') {
    const { data: ws, error } = await db
      .from('workspaces')
      .select('context')
      .eq('id', workspaceId)
      .single();

    if (error) return res.status(500).json({ error: error.message });
    return res.status(200).json({ context: ws?.context || {} });
  }

  // ── POST (save context) ───────────────────────────────────────────────────
  if (req.method === 'POST') {
    const { context } = req.body ?? {};
    if (typeof context !== 'object' || context === null) {
      return res.status(400).json({ error: 'context must be an object' });
    }

    const { error } = await db
      .from('workspaces')
      .update({ context })
      .eq('id', workspaceId);

    if (error) return res.status(500).json({ error: error.message });

    return res.status(200).json({ ok: true });
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
