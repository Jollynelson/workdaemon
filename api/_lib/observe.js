// The brain's autonomous observe → act loop, run on the daily scan per ACTIVE
// workspace. Pluggable: each detector observes a slice of what the brain remembers,
// AUTO-records the observation (pattern history, no human), and PROPOSES (approve-
// first) anything that warrants a human decision. Add a detector here → it joins
// the loop. This is the spine the north star's "sees → predicts → positions" grows on.
import { observeStaffAndPropose } from './staff_signals.js';
import { recordObservation, proposeToInbox, adminRecipients, tierFor } from './autonomy.js';

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

// "Gone quiet" — a tracked thing (deal, opportunity, customer/important thread) that
// was active but has had no activity in `days`. Generic over workspace_documents.updated_at.
// Guards against nagging a DORMANT source: only flags stale items when the source still
// has recent activity (i.e. this one went quiet while others kept moving).
export async function detectGoneQuiet(db, workspaceId, { docTypes, days = 14, kind, noun }) {
  const cutoffT = Date.parse(daysAgoISO(days));
  const { data: docs } = await db.from('workspace_documents')
    .select('title, doc_type, updated_at')
    .eq('workspace_id', workspaceId).in('doc_type', docTypes)
    .order('updated_at', { ascending: true }).limit(200);
  const all = docs || [];
  const ts = (d) => (d.updated_at ? Date.parse(d.updated_at) : NaN);
  const sourceActive = all.some(d => ts(d) >= cutoffT);          // still in use?
  const stale = sourceActive ? all.filter(d => ts(d) < cutoffT).slice(0, 5) : [];

  await recordObservation(db, workspaceId, {
    domain: kind, subjectType: 'workspace', subjectId: workspaceId,
    signal: stale.length ? 'quiet' : 'ok', value: stale.length,
  });
  if (!stale.length) return { quiet: 0, proposed: 0 };

  const recipients = await adminRecipients(db, workspaceId);
  const list = stale.map(d => `• ${d.title || 'untitled'} (quiet since ${String(d.updated_at).slice(0, 10)})`).join('\n');
  const proposed = await proposeToInbox(db, workspaceId, recipients, {
    kind, subjectId: workspaceId,
    title: `${stale.length} ${noun}${stale.length === 1 ? '' : 's'} gone quiet`,
    body: `No activity in ${days}+ days:\n${list}`,
    metadata: { count: stale.length },
  });
  return { quiet: stale.length, proposed };
}

// AUTO-tier action (the first the brain runs WITHOUT approval): an internal digest of
// what it observed this cycle. Informational, no outward effect. Gated by tierFor so
// the kill-switch (BRAIN_AUTONOMY=propose_only) silences it; deduped to one at a time.
export async function postDailyDigest(db, workspaceId, lines) {
  if (tierFor('daily_digest') !== 'auto' || !lines.length) return { posted: 0 };
  const recipients = await adminRecipients(db, workspaceId);
  const posted = await proposeToInbox(db, workspaceId, recipients, {
    kind: 'daily_digest', subjectId: workspaceId,
    title: 'Brain daily digest', body: lines.join('\n'), metadata: { auto: true },
  });
  return { posted };
}

// Run every detector for a workspace, then auto-post a digest of what was noticed.
// Each step is best-effort — one failing never blocks the others or the scan.
export async function observeWorkspace(db, workspaceId) {
  const out = {};
  out.staff = await observeStaffAndPropose(db, workspaceId).catch((e) => ({ error: e.message }));
  out.deadlines = await detectSlippingDeadlines(db, workspaceId).catch((e) => ({ error: e.message }));
  out.deals = await detectGoneQuiet(db, workspaceId,
    { docTypes: ['deal', 'opportunity'], kind: 'deal_cold', noun: 'deal' }).catch((e) => ({ error: e.message }));
  out.threads = await detectGoneQuiet(db, workspaceId,
    { docTypes: ['email_thread', 'channel'], kind: 'thread_quiet', noun: 'thread' }).catch((e) => ({ error: e.message }));

  const lines = [];
  if (out.staff?.flagged) lines.push(`• ${out.staff.flagged} teammate(s) need attention`);
  if (out.deadlines?.slipped) lines.push(`• ${out.deadlines.slipped} deadline(s) slipping`);
  if (out.deals?.quiet) lines.push(`• ${out.deals.quiet} deal(s) gone cold`);
  if (out.threads?.quiet) lines.push(`• ${out.threads.quiet} thread(s) gone quiet`);
  out.digest = lines.length
    ? await postDailyDigest(db, workspaceId, ['What I noticed today:', ...lines]).catch((e) => ({ error: e.message }))
    : { posted: 0 };
  return out;
}
