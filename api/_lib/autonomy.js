// Autonomy tiering for the brain's observe → act loop.
//
//   AUTO    — safe, internal, reversible: the brain remembering / updating its own
//             knowledge. Executed directly, no human. (recordObservation → learning_signals)
//   PROPOSE — consequential or outward: touches a person/customer, sends, reassigns.
//             Drafted into the approve-first queue (inbox_items); a human approves.
//
// Policy (BRAIN_AUTONOMY): 'tiered' (default) honors per-kind tiers; 'propose_only'
// forces every action to propose (recording is always safe and still happens).
// BRAIN_AUTO_KINDS is an allow-list of action kinds permitted to auto-execute their
// *action* (beyond recording) — empty by default: nothing outward auto-fires yet.
// Widening autonomy later = add a proven-safe kind here, no code change.
import { recordSignal } from './learning.js';

const POLICY = (process.env.BRAIN_AUTONOMY || 'tiered').toLowerCase();
// Safe actions allowed to auto-execute (no approval): the internal daily digest
// (informational) and equipping a daemon with a skill the brain taught itself
// (additive + reversible). Widen by adding proven-safe kinds here / via BRAIN_AUTO_KINDS.
const AUTO_KINDS = new Set(
  (process.env.BRAIN_AUTO_KINDS || 'daily_digest,equip_learned_skill').split(',').map(s => s.trim()).filter(Boolean),
);

export function tierFor(kind) {
  if (POLICY === 'propose_only') return 'propose';
  return AUTO_KINDS.has(kind) ? 'auto' : 'propose';
}

// AUTO (always safe): the brain durably remembers an observation so it can see the
// PATTERN over time (e.g. "at_risk 3 weeks running"). No human, no outward effect.
export async function recordObservation(db, workspaceId, { domain, subjectType, subjectId, signal, value = null, meta = {} }) {
  await recordSignal(db, { workspaceId, domain, subjectType, subjectId, signal, value, meta });
}

// Workspace admins (fallback: first member) — who consequential proposals go to.
export async function adminRecipients(db, workspaceId) {
  const { data: members } = await db.from('workspace_members')
    .select('user_id, role').eq('workspace_id', workspaceId);
  let r = (members || []).filter(m => /admin|owner/i.test(m.role || '')).map(m => m.user_id);
  if (!r.length) r = (members || []).map(m => m.user_id).slice(0, 1);
  return r;
}

// PROPOSE (approve-first): draft an inbox alert to recipients, deduped against an
// existing UNREAD alert of the same kind+subject so the brain never nags. Returns
// how many were inserted (0 = deduped).
export async function proposeToInbox(db, workspaceId, recipients, { kind, subjectId = null, title, body, metadata = {} }) {
  const { data: existing } = await db.from('inbox_items')
    .select('id').eq('workspace_id', workspaceId).eq('read', false)
    .contains('metadata', { kind, subject_id: subjectId }).limit(1);
  if (existing && existing.length) return 0;
  let n = 0;
  for (const rid of recipients || []) {
    await db.from('inbox_items').insert({
      workspace_id: workspaceId, user_id: rid, type: 'alert', source: 'daemon',
      title, body, metadata: { ...metadata, kind, subject_id: subjectId }, read: false,
    });
    n++;
  }
  return n;
}
