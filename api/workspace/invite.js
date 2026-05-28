import { requireAuth, adminClient } from '../_lib/supabase.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const user = await requireAuth(req, res);
  if (!user) return;

  const { emails } = req.body ?? {};
  if (!Array.isArray(emails) || emails.length === 0) {
    return res.status(400).json({ error: 'Emails array required' });
  }

  const db = adminClient();

  // Get user's workspace
  const { data: profile } = await db
    .from('profiles')
    .select('workspace_id')
    .eq('id', user.id)
    .single();

  if (!profile?.workspace_id) {
    return res.status(400).json({ error: 'Complete workspace setup first' });
  }

  // Store invites
  const inviteRows = emails.map(email => ({
    workspace_id: profile.workspace_id,
    email: email.trim().toLowerCase(),
    invited_by: user.id,
  }));

  const { error } = await db
    .from('workspace_invites')
    .upsert(inviteRows, { onConflict: 'workspace_id, email' });

  if (error) return res.status(500).json({ error: error.message });

  return res.status(200).json({ invited: emails.length });
}
