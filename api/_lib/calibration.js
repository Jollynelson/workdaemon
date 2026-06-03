// Push calibration (Master §10.2 / FINAL push/calibration.py).
// The Brain backs off push categories a user consistently ignores — "Never mind,
// I'll do it the old way." A push is "ignored" only if it was never read AND never
// acted on AND is old enough to have been seen. Engagement (read OR acted) resets
// the back-off. Never applies to direct/critical pushes — only proactive brain ones.

const SOFT_CATEGORIES = new Set(['pattern', 'briefing', 'finding', 'insight']);
const IGNORE_STREAK = 4;        // consecutive ignored → back off
const SEEN_AGE_MS = 2 * 864e5;  // a push must be >2d old to count as "ignored"

const category = (item) => item?.metadata?.event_type || item?.type || 'update';

// Decide whether to deliver a proactive push of `cat` to this user.
// Returns { deliver: boolean, reason, ignoredStreak }.
export async function shouldDeliver(db, userId, cat) {
  // Direct/actionable categories are never suppressed.
  if (!SOFT_CATEGORIES.has(cat)) return { deliver: true, reason: 'direct' };
  const { data: recent } = await db
    .from('inbox_items')
    .select('read, acted_on, created_at, metadata, type')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(40);
  const inCat = (recent || []).filter(r => category(r) === cat);
  let streak = 0;
  for (const r of inCat) {            // newest → oldest
    if (r.read || r.acted_on) break;  // any engagement resets the back-off
    const old = Date.now() - new Date(r.created_at).getTime() > SEEN_AGE_MS;
    if (old) streak++;                // ignored long enough to count
    // a fresh unread push is neutral — don't count it, don't reset
  }
  if (streak >= IGNORE_STREAK) return { deliver: false, reason: 'backoff', ignoredStreak: streak };
  return { deliver: true, reason: 'ok', ignoredStreak: streak };
}

// Mark the push tied to a task (or a specific item) as acted on — the strongest
// engagement signal. Called when a user accepts/flags/uses a pushed item.
export async function recordTaskAction(db, userId, taskId) {
  if (!taskId) return;
  await db.from('inbox_items')
    .update({ acted_on: true, acted_at: new Date().toISOString(), read: true })
    .eq('user_id', userId).eq('metadata->>task_id', taskId);
}

// Per-category engagement for a user (read-rate, act-rate) — admin/debug view.
export async function engagement(db, workspaceId) {
  const { data: rows } = await db
    .from('inbox_items')
    .select('user_id, read, acted_on, metadata, type')
    .eq('workspace_id', workspaceId)
    .limit(1000);
  const agg = {};
  for (const r of (rows || [])) {
    const cat = category(r);
    const a = (agg[cat] ||= { total: 0, read: 0, acted: 0 });
    a.total++; if (r.read) a.read++; if (r.acted_on) a.acted++;
  }
  return Object.entries(agg).map(([cat, a]) => ({
    category: cat, total: a.total,
    read_rate: a.total ? +(a.read / a.total).toFixed(2) : 0,
    act_rate: a.total ? +(a.acted / a.total).toFixed(2) : 0,
  })).sort((x, y) => y.total - x.total);
}
