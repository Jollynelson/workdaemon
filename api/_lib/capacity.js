// Capacity reasoning for cross-daemon communication.
// Before a daemon assigns work to another staff member, it reasons about that
// person's load — open tasks, overdue tasks, and their published availability
// signal — exactly as described in workdaemon-cross-daemon-communication.md.
// This is the logic behind "Zoe has capacity" (smooth assign) vs "Zoe is
// overloaded" (surface a decision to the assigner).

const todayISO = () => new Date().toISOString().slice(0, 10);

// Returns { load, openCount, overdueCount, availability, reason } for a staff member.
// load: 'low' | 'medium' | 'high'
export async function assessCapacity(db, workspaceId, userId) {
  const { data: tasks } = await db
    .from('tasks')
    .select('status, due_date')
    .eq('workspace_id', workspaceId)
    .eq('assignee_id', userId);

  const open = (tasks || []).filter(t => t.status !== 'done');
  const today = todayISO();
  const overdue = open.filter(t => t.due_date && t.due_date < today);

  const { data: agent } = await db
    .from('app_agent_profiles')
    .select('availability, availability_reason, availability_until')
    .eq('user_id', userId)
    .single();

  // An availability signal expires; treat a past `until` as no longer in effect.
  let availability = agent?.availability || 'normal';
  if (agent?.availability_until && new Date(agent.availability_until) < new Date()) {
    availability = 'normal';
  }

  const openCount = open.length;
  const overdueCount = overdue.length;

  // Load is high if the staffer self-reported high load/away, or the task math
  // says so. This mirrors the doc's "4 open tasks, 2 overdue → HIGH LOAD".
  let load = 'low';
  if (availability === 'away' || availability === 'high_load' || openCount >= 4 || overdueCount >= 2) {
    load = 'high';
  } else if (openCount >= 2 || overdueCount >= 1) {
    load = 'medium';
  }

  const bits = [`${openCount} open task${openCount === 1 ? '' : 's'}`];
  if (overdueCount) bits.push(`${overdueCount} overdue`);
  if (availability === 'high_load') bits.push('flagged high load');
  if (availability === 'away') bits.push('marked away');
  if (agent?.availability_reason && availability !== 'normal') bits.push(agent.availability_reason);

  return { load, openCount, overdueCount, availability, reason: bits.join(', ') };
}

// Suggest alternative assignees (lowest load first) for the "assignment risk"
// decision — the doc's "Reassign to Marcus (1 open task, no blockers)" option.
export async function suggestAlternatives(db, workspaceId, excludeUserId, limit = 3) {
  const { data: members } = await db
    .from('workspace_members')
    .select('user_id')
    .eq('workspace_id', workspaceId);

  const others = (members || []).filter(m => m.user_id !== excludeUserId);
  // Resolve names via profiles (auth.users isn't embeddable through PostgREST).
  const ids = others.map(m => m.user_id);
  const { data: profs } = ids.length
    ? await db.from('profiles').select('id, name, title, role').in('id', ids)
    : { data: [] };
  const profOf = Object.fromEntries((profs || []).map(p => [p.id, p]));

  const assessed = [];
  for (const m of others) {
    const cap = await assessCapacity(db, workspaceId, m.user_id);
    const p = profOf[m.user_id];
    assessed.push({
      user_id: m.user_id,
      name: p?.name || 'Teammate',
      title: p?.title || p?.role || '',
      ...cap,
    });
  }
  const rank = { low: 0, medium: 1, high: 2 };
  assessed.sort((a, b) => rank[a.load] - rank[b.load] || a.openCount - b.openCount);
  return assessed.slice(0, limit);
}
