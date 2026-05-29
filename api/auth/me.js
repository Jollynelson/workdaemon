import { requireAuth, adminClient } from '../_lib/supabase.js';

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const user = await requireAuth(req, res);
  if (!user) return;

  const db = adminClient();

  const { data: profile } = await db
    .from('profiles')
    .select('*, workspaces(id, name, size, industry, invite_code, openrouter_model)')
    .eq('id', user.id)
    .single();

  // If profile has no workspace via FK, check workspace_members (covers invited users)
  let workspaces = profile?.workspaces ?? null;
  let workspaceId = profile?.workspace_id ?? null;

  if (!workspaces) {
    const { data: member } = await db
      .from('workspace_members')
      .select('workspace_id, workspaces(id, name, size, industry, invite_code, openrouter_model)')
      .eq('user_id', user.id)
      .limit(1)
      .single();

    if (member?.workspaces) {
      workspaces = member.workspaces;
      workspaceId = member.workspace_id;

      // Self-heal: write workspace_id back to profile so future lookups are fast
      await db.from('profiles').update({ workspace_id: member.workspace_id }).eq('id', user.id);
    }
  }

  const enriched = profile
    ? { ...profile, workspace_id: workspaceId, workspaces }
    : null;

  return res.status(200).json({ user, profile: enriched });
}
