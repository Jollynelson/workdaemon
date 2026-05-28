import { requireAuth, adminClient } from '../_lib/supabase.js';

export default async function handler(req, res) {
  const user = await requireAuth(req, res);
  if (!user) return;

  const db = adminClient();

  // Resolve user's workspace
  const { data: profile } = await db
    .from('profiles')
    .select('workspace_id')
    .eq('id', user.id)
    .single();

  if (!profile?.workspace_id) return res.status(404).json({ error: 'No workspace found' });

  // GET — return current settings (never expose the raw key)
  if (req.method === 'GET') {
    const { data: ws } = await db
      .from('workspaces')
      .select('openrouter_key, openrouter_model')
      .eq('id', profile.workspace_id)
      .single();

    return res.status(200).json({
      model: ws?.openrouter_model || null,
      hasKey: !!(ws?.openrouter_key),
      keyHint: ws?.openrouter_key ? `sk-or-...${ws.openrouter_key.slice(-4)}` : null,
    });
  }

  // POST — admin saves key and/or model
  if (req.method === 'POST') {
    const { data: member } = await db
      .from('workspace_members')
      .select('role')
      .eq('workspace_id', profile.workspace_id)
      .eq('user_id', user.id)
      .single();

    if (member?.role !== 'admin') return res.status(403).json({ error: 'Admin access required' });

    const { model, key } = req.body ?? {};
    const update = {};
    if (model !== undefined) update.openrouter_model = model || null;
    if (key !== undefined) update.openrouter_key = key || null;

    if (Object.keys(update).length === 0) return res.status(400).json({ error: 'Nothing to update' });

    const { error } = await db
      .from('workspaces')
      .update(update)
      .eq('id', profile.workspace_id);

    if (error) return res.status(500).json({ error: error.message });
    return res.status(200).json({ ok: true });
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
