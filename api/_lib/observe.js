// The brain's autonomous observe → act loop, run on the daily scan per ACTIVE
// workspace. Pluggable: each detector observes a slice of what the brain remembers,
// AUTO-records the observation (pattern history, no human), and PROPOSES (approve-
// first) anything that warrants a human decision. Add a detector here → it joins
// the loop. This is the spine the north star's "sees → predicts → positions" grows on.
import { observeStaffAndPropose } from './staff_signals.js';
import { recordObservation, proposeToInbox, adminRecipients } from './autonomy.js';

const daysAgoISO = (n) => new Date(Date.now() - n * 86400000).toISOString().slice(0, 10);

// Slipping deadlines — tasks past due by more than GRACE days and still not done.
// AUTO-records the count (so the brain tracks whether things are getting better or
// worse over time); PROPOSES one deduped digest listing the worst offenders.
export async function detectSlippingDeadlines(db, workspaceId) {
  const GRACE = Number(process.env.DEADLINE_GRACE_DAYS || 2);
  const cutoff = daysAgoISO(GRACE);
  const { data: tasks } = await db.from('tasks')
    .select('id, title, status, due_date').eq('workspace_id', workspaceId).neq('status', 'done');
  const slipped = (tasks || []).filter(t => t.due_date && t.due_date < cutoff);

  await recordObservation(db, workspaceId, {
    domain: 'deadline', subjectType: 'workspace', subjectId: workspaceId,
    signal: slipped.length ? 'slipping' : 'clear', value: slipped.length,
  });
  if (!slipped.length) return { slipped: 0, proposed: 0 };

  const recipients = await adminRecipients(db, workspaceId);
  const worst = slipped.slice(0, 5).map(t => `• ${t.title || 'untitled'} (due ${t.due_date})`).join('\n');
  const proposed = await proposeToInbox(db, workspaceId, recipients, {
    kind: 'deadlines_slipping', subjectId: workspaceId,
    title: `${slipped.length} deadline${slipped.length === 1 ? '' : 's'} slipping`,
    body: `Past due by more than ${GRACE} day(s), not done:\n${worst}`,
    metadata: { count: slipped.length },
  });
  return { slipped: slipped.length, proposed };
}

// Run every detector for a workspace. Each is best-effort — one failing never blocks
// the others or the scan.
export async function observeWorkspace(db, workspaceId) {
  const out = {};
  out.staff = await observeStaffAndPropose(db, workspaceId).catch((e) => ({ error: e.message }));
  out.deadlines = await detectSlippingDeadlines(db, workspaceId).catch((e) => ({ error: e.message }));
  return out;
}
