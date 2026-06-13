// Per-staff performance signal — the brain reasoning over what it already remembers
// about each person's work (open / overdue / done tasks + self-reported availability)
// into a status: on_track | quiet | overloaded | at_risk | away.
//
// Read by the `staff_signals` brain action (a view); ACTED ON by the daily scan
// (observeStaffAndPropose) — the brain SEES a signal and PUTS something in place,
// approve-first: it drafts an inbox alert for the admins, it does not act unilaterally.

import { recordObservation, proposeToInbox, adminRecipients } from './autonomy.js';

const todayISO = () => new Date().toISOString().slice(0, 10);

// Pure decision: status + human reason from a staffer's aggregates. Order matters —
// away (self-reported) and at_risk (falling behind) take precedence over load.
export function deriveStaffStatus({ openCount = 0, overdueCount = 0, doneCount = 0, availability = 'normal' }) {
  const bits = [`${openCount} open`];
  if (overdueCount) bits.push(`${overdueCount} overdue`);
  if (doneCount) bits.push(`${doneCount} done`);
  let status;
  if (availability === 'away') { status = 'away'; bits.push('marked away'); }
  else if (overdueCount >= 2 || (overdueCount >= 1 && doneCount === 0)) { status = 'at_risk'; }
  else if (availability === 'high_load' || openCount >= 4) {
    status = 'overloaded';
    if (availability === 'high_load') bits.push('flagged high load');
  } else if (openCount === 0 && doneCount === 0) { status = 'quiet'; }
  else { status = 'on_track'; }
  return { status, reason: bits.join(', ') };
}

async function staffAvailability(db, userId) {
  const { data: a } = await db.from('app_agent_profiles')
    .select('availability, availability_until').eq('user_id', userId).single();
  let av = a?.availability || 'normal';
  if (a?.availability_until && new Date(a.availability_until) < new Date()) av = 'normal';
  return av;
}

// Per-staff signals for a workspace, worst-first (at_risk → overloaded → … → on_track).
export async function computeStaffSignals(db, workspaceId) {
  const { data: members } = await db.from('workspace_members').select('user_id').eq('workspace_id', workspaceId);
  const ids = (members || []).map(m => m.user_id);
  if (!ids.length) return [];
  const { data: profs } = await db.from('profiles').select('id, name, title, role').in('id', ids);
  const profOf = Object.fromEntries((profs || []).map(p => [p.id, p]));
  const today = todayISO();

  const out = [];
  for (const userId of ids) {
    const { data: tasks } = await db.from('tasks')
      .select('status, due_date').eq('workspace_id', workspaceId).eq('assignee_id', userId);
    const all = tasks || [];
    const open = all.filter(t => t.status !== 'done');
    const overdueCount = open.filter(t => t.due_date && t.due_date < today).length;
    const doneCount = all.filter(t => t.status === 'done').length;
    const availability = await staffAvailability(db, userId);
    const { status, reason } = deriveStaffStatus({ openCount: open.length, overdueCount, doneCount, availability });
    const p = profOf[userId] || {};
    out.push({
      user_id: userId, name: p.name || 'Teammate', title: p.title || p.role || '',
      status, reason, openCount: open.length, overdueCount, doneCount,
    });
  }
  const rank = { at_risk: 0, overloaded: 1, quiet: 2, away: 3, on_track: 4 };
  out.sort((a, b) => (rank[a.status] ?? 9) - (rank[b.status] ?? 9));
  return out;
}

// Observe → act. AUTO (safe): the brain durably remembers EVERY staffer's signal
// (pattern history) — no human, no outward effect. PROPOSE (approve-first): for
// anyone at_risk/overloaded, draft an inbox alert to the admins with a concrete
// suggestion. It proposes; the human decides.
export async function observeStaffAndPropose(db, workspaceId) {
  const signals = await computeStaffSignals(db, workspaceId);

  // AUTO: remember the observation for everyone (builds the pattern over time).
  for (const s of signals) {
    await recordObservation(db, workspaceId, {
      domain: 'staff', subjectType: 'user', subjectId: s.user_id, signal: s.status,
      value: s.overdueCount, meta: { open: s.openCount, done: s.doneCount },
    });
  }

  const flagged = signals.filter(s => s.status === 'at_risk' || s.status === 'overloaded');
  if (!flagged.length) return { flagged: 0, proposed: 0 };

  const recipients = await adminRecipients(db, workspaceId);
  let proposed = 0;
  for (const s of flagged) {
    const verb = s.status === 'at_risk' ? 'may be falling behind' : 'looks overloaded';
    const suggestion = s.status === 'at_risk'
      ? `Consider a check-in with ${s.name}, or reprioritizing their ${s.overdueCount} overdue item(s).`
      : `Consider reassigning some of ${s.name}'s ${s.openCount} open items.`;
    proposed += await proposeToInbox(db, workspaceId, recipients, {
      kind: 'staff_signal', subjectId: s.user_id,
      title: `${s.name} ${verb}`, body: `${s.reason}. ${suggestion}`,
      metadata: { status: s.status },
    });
  }
  return { flagged: flagged.length, proposed };
}
