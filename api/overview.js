import { requireAuth, adminClient } from './_lib/supabase.js';

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const user = await requireAuth(req, res);
  if (!user) return;

  const db = adminClient();

  const { data: profile } = await db
    .from('profiles')
    .select('workspace_id')
    .eq('id', user.id)
    .single();

  if (!profile?.workspace_id) {
    return res.status(200).json({ metrics: {}, activity: [], team: [] });
  }

  const [tasksRes, membersRes] = await Promise.all([
    db.from('tasks').select('status').eq('workspace_id', profile.workspace_id),
    db.from('workspace_members')
      .select('user_id, role, joined_at, profiles(name, title)')
      .eq('workspace_id', profile.workspace_id),
  ]);

  const tasks = tasksRes.data ?? [];
  const members = membersRes.data ?? [];

  return res.status(200).json({
    metrics: {
      totalTasks: tasks.length,
      completedTasks: tasks.filter(t => t.status === 'done').length,
      teamSize: members.length,
    },
    activity: [],
    team: members,
  });
}
