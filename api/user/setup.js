import { requireAuth, adminClient } from '../_lib/supabase.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const user = await requireAuth(req, res);
  if (!user) return;

  const { name, title, company, size, role, industry } = req.body ?? {};
  if (!company) return res.status(400).json({ error: 'Company name required' });

  const db = adminClient();

  // Check if user already has a workspace
  const { data: existing } = await db
    .from('profiles')
    .select('workspace_id')
    .eq('id', user.id)
    .single();

  let workspace;

  if (existing?.workspace_id) {
    // Update existing workspace
    const { data: ws } = await db
      .from('workspaces')
      .update({ name: company, size, industry })
      .eq('id', existing.workspace_id)
      .select()
      .single();
    workspace = ws;
  } else {
    // Create new workspace
    const { data: ws, error: wsError } = await db
      .from('workspaces')
      .insert({ name: company, size, industry, owner_id: user.id })
      .select()
      .single();

    if (wsError) return res.status(500).json({ error: wsError.message });
    workspace = ws;

    // Add as admin member
    await db.from('workspace_members').insert({
      workspace_id: workspace.id,
      user_id: user.id,
      role: 'admin',
    });
  }

  // Upsert profile
  await db.from('profiles').upsert({
    id: user.id,
    name: name || null,
    title: title || null,
    role: role || null,
    industry: industry || null,
    workspace_id: workspace.id,
    onboarded: true,
  });

  const appUrl = process.env.APP_URL || 'https://workdaemon-prod.vercel.app';
  const inviteLink = `${appUrl}/join/${workspace.invite_code}`;

  return res.status(200).json({ workspace, inviteLink });
}
