// The brain's autonomous observe → act loop, run on the daily scan per ACTIVE
// workspace. Pluggable: each detector observes a slice of what the brain remembers,
// AUTO-records the observation (pattern history, no human), and PROPOSES (approve-
// first) anything that warrants a human decision. Add a detector here → it joins
// the loop. This is the spine the north star's "sees → predicts → positions" grows on.
import { observeStaffAndPropose } from './staff_signals.js';
import { recordObservation, proposeToInbox, adminRecipients, tierFor } from './autonomy.js';
import { runContinuousLearning } from './continuous_learning.js';
import { getFreshAccessToken } from './oauth.js';
import { googleRecentEvents, microsoftRecentEvents } from './calendar.js';
import { queueFindingDelivery } from './outbox.js';
import { retrieveDocuments } from './ingestion.js';

const daysAgoISO = (n) => new Date(Date.now() - n * 86400000).toISOString().slice(0, 10);

// Ground a proposal in a real company document: retrieve the most relevant doc
// for `query` and return its title as a short source citation the UI shows as a
// "# Source" chip — i.e. the brain "found a document about it". null if nothing
// matches (the alert simply ships ungrounded). Workspace-public docs only (no
// user scope), so an admin-facing alert never cites a restricted document.
async function groundCitation(db, workspaceId, query) {
  try {
    const { visible } = await retrieveDocuments(db, workspaceId, query || '', null, 1);
    const title = visible?.[0]?.title;
    return title ? String(title).slice(0, 60) : null;
  } catch { return null; }
}

// Continuous self-teaching is web+LLM-backed, so cap how many workspaces actually
// research per scan invocation (this module persists within one process/run). Roles
// rotate across runs; cheap interval-gated no-ops don't count toward the cap.
let _learnedThisRun = 0;
const LEARN_PER_RUN = Number(process.env.LEARN_PER_RUN || 2);

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
  const source = await groundCitation(db, workspaceId, slipped.map(t => t.title).filter(Boolean).join(' '));
  const proposed = await proposeToInbox(db, workspaceId, recipients, {
    kind: 'deadlines_slipping', subjectId: workspaceId,
    title: `${slipped.length} deadline${slipped.length === 1 ? '' : 's'} slipping`,
    body: `Past due by more than ${GRACE} day(s), not done:\n${worst}`,
    metadata: { count: slipped.length }, source,
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
  const source = await groundCitation(db, workspaceId, stale.map(d => d.title).filter(Boolean).join(' '));
  const proposed = await proposeToInbox(db, workspaceId, recipients, {
    kind, subjectId: workspaceId,
    title: `${stale.length} ${noun}${stale.length === 1 ? '' : 's'} gone quiet`,
    body: `No activity in ${days}+ days:\n${list}`,
    metadata: { count: stale.length }, source,
  });
  return { quiet: stale.length, proposed };
}

// Pure: is a goal at risk? Uses progress vs. time-to-due and pace vs. the horizon.
export function goalRisk(goal, now = Date.now()) {
  const progress = Number(goal.progress) || 0;
  if (progress >= 100) return { risk: 'done', reason: 'complete' };
  if (!goal.due_at) return { risk: 'unknown', reason: 'no due date' };
  const daysLeft = Math.round((Date.parse(goal.due_at) - now) / 864e5);
  if (Number.isNaN(daysLeft)) return { risk: 'unknown', reason: 'no due date' };
  if (daysLeft < 0) return { risk: 'overdue', reason: `${-daysLeft}d overdue at ${progress}%` };
  if (daysLeft <= 7 && progress < 75) return { risk: 'at_risk', reason: `due in ${daysLeft}d at ${progress}%` };
  const horizon = Number(goal.horizon_days) || 30;
  const expected = Math.round(Math.min(1, Math.max(0, (horizon - daysLeft) / horizon)) * 100);
  if (progress + 25 < expected) return { risk: 'behind', reason: `${progress}% vs ~${expected}% expected pace` };
  return { risk: 'on_track', reason: `${progress}%` };
}

// Goals trending to miss — ties the goals engine into the observe loop. Auto-remembers
// every goal's risk; proposes a deduped digest of the ones off track.
export async function detectGoalsAtRisk(db, workspaceId) {
  const { data: goals } = await db.from('brain_goals')
    .select('id, title, progress, due_at, horizon_days, scope, status')
    .eq('workspace_id', workspaceId).eq('status', 'active').limit(100);
  const flagged = [];
  for (const g of goals || []) {
    const { risk, reason } = goalRisk(g);
    await recordObservation(db, workspaceId, {
      domain: 'goal', subjectType: 'goal', subjectId: g.id, signal: risk, value: Number(g.progress) || 0,
    });
    if (risk === 'overdue' || risk === 'at_risk' || risk === 'behind') flagged.push({ ...g, risk, reason });
  }
  if (!flagged.length) return { at_risk: 0, proposed: 0 };
  const recipients = await adminRecipients(db, workspaceId);
  const list = flagged.slice(0, 6).map(g => `• ${g.title} — ${g.reason}`).join('\n');
  const source = await groundCitation(db, workspaceId, flagged.map(g => g.title).filter(Boolean).join(' '));
  const proposed = await proposeToInbox(db, workspaceId, recipients, {
    kind: 'goals_at_risk', subjectId: workspaceId,
    title: `${flagged.length} goal${flagged.length === 1 ? '' : 's'} trending to miss`,
    body: `Off track:\n${list}`, metadata: { count: flagged.length }, source,
  });
  return { at_risk: flagged.length, proposed };
}

// HR owner(s) for a workspace — the member(s) whose role/title reads as HR/People,
// else the workspace admins (a local resolver so this module stays independent of
// brain.js's role router — no circular import).
const HR_RE = /\b(hr|human\s*resources|people|talent|chief\s*people|recruit)\b/i;
async function hrRecipients(db, workspaceId) {
  const { data: members } = await db.from('workspace_members').select('user_id').eq('workspace_id', workspaceId);
  const ids = (members || []).map(m => m.user_id);
  if (ids.length) {
    const { data: profs } = await db.from('profiles').select('id, role, title').in('id', ids);
    const hr = (profs || []).filter(p => HR_RE.test(`${p.role || ''} ${p.title || ''}`)).map(p => p.id);
    if (hr.length) return hr;
  }
  return adminRecipients(db, workspaceId);
}

// Onboarding/induction-type sessions (broadenable; this is the seam where the
// brain could later self-author the patterns it watches for).
const SESSION_RE = /\b(onboard(ing)?|orientation|induction|new[\s-]?(hire|starter|joiner)|first[\s-]?day|welcome\s+session)\b/i;
// A required attendee who did NOT accept once the event has ended = no-show signal.
// 'accepted'/'tentative' read as showed/intended; 'declined' or 'needsAction'
// (never responded) read as missed. Self/organizer/optional/resource excluded.
const isNoShow = (a) => a.email && !a.self && !a.organizer && !a.optional && !a.resource
  && (a.responseStatus === 'declined' || a.responseStatus === 'needsAction');

// Calendar providers that expose per-attendee RSVP (so "missed = didn't show" is
// detectable structurally). Tools without RSVP (Notion, a native calendar, etc.)
// are covered by detectMissedSessionsFromConversation instead — together they
// mean a missed session is caught no matter where the calendar lives.
const RSVP_PROVIDERS = [
  { provider: 'google', read: googleRecentEvents },
  { provider: 'microsoft', read: microsoftRecentEvents },
];

// MISSED ONBOARDING SESSIONS — reads recently-ENDED events WITH RSVP from EVERY
// connected calendar provider (Google, Microsoft 365, …), finds onboarding-type
// sessions whose required attendees didn't show, and notifies BOTH the HR owner
// AND the staff member who missed it (inbox for both, plus a chat ping for the
// staff). Deduped per event+attendee. Silent no-op when no RSVP-capable calendar
// is connected. The first "scheduled-commitment" detector — the generalizable
// shape behind "the brain notices when something that should've happened didn't".
export async function detectMissedSessions(db, workspaceId) {
  const sinceDays = Number(process.env.MISSED_SESSION_WINDOW_DAYS || 2);
  // Union recent RSVP events across every connected provider; one provider
  // erroring (or not connected) never blocks the others.
  let events = [];
  let anyProvider = false;
  for (const { provider, read } of RSVP_PROVIDERS) {
    const token = await getFreshAccessToken(db, workspaceId, provider).catch(() => null);
    if (!token) continue;
    anyProvider = true;
    try { events = events.concat(await read(token, { sinceDays })); }
    catch (e) { console.warn('[observe] %s recent events:', provider, e.message); }
  }
  if (!anyProvider) return { checked: 0, missed: 0, proposed: 0 };

  const now = Date.now();
  const sessions = (events || []).filter(e => SESSION_RE.test(e.title) && e.end && Date.parse(e.end) < now);
  if (!sessions.length) {
    await recordObservation(db, workspaceId, { domain: 'onboarding', subjectType: 'workspace', subjectId: workspaceId, signal: 'clear', value: 0 });
    return { checked: events?.length || 0, missed: 0, proposed: 0 };
  }

  // Map workspace member emails → user_id (auth.users is the only email source;
  // profiles has none). Mirrors the Slack member resolver.
  const { data: members } = await db.from('workspace_members').select('user_id').eq('workspace_id', workspaceId);
  const memberIds = new Set((members || []).map(m => m.user_id));
  const emailToId = {};
  if (memberIds.size) {
    const { data: au } = await db.auth.admin.listUsers({ page: 1, perPage: 200 }).catch(() => ({ data: null }));
    for (const u of (au?.users || [])) {
      if (u.email && memberIds.has(u.id)) emailToId[u.email.toLowerCase()] = u.id;
    }
  }

  const hrOwners = await hrRecipients(db, workspaceId);
  let missed = 0, proposed = 0;
  for (const ev of sessions) {
    // Ground in a company doc once per session (e.g. the onboarding SOP/policy).
    const source = await groundCitation(db, workspaceId, `${ev.title} onboarding policy`);
    for (const a of (ev.attendees || []).filter(isNoShow)) {
      missed++;
      const who = a.displayName || a.email;
      const when = String(ev.start || ev.end).slice(0, 10);
      const staffId = emailToId[(a.email || '').toLowerCase()] || null;
      const subj = `${ev.id}:${(a.email || '').toLowerCase()}`;

      // → HR (exclude the missing staffer if they happen to be the HR owner).
      // Carries a confirm-first action: one tap creates the reschedule task.
      proposed += await proposeToInbox(db, workspaceId, hrOwners.filter(id => id !== staffId), {
        kind: 'missed_onboarding', subjectId: `hr:${subj}`,
        title: `${who} missed onboarding: ${ev.title}`,
        body: `${who} did not attend "${ev.title}" (${when}) — RSVP was "${a.responseStatus}". Reschedule and confirm their onboarding is back on track.`,
        metadata: {
          event_id: ev.id, attendee: a.email, staff_id: staffId, response: a.responseStatus, audience: 'hr',
          action: { kind: 'reschedule_onboarding', label: 'Reschedule onboarding', who, when, session: ev.title },
        }, source,
      });

      // → the staff member directly (only when they're a resolvable platform user).
      if (staffId) {
        proposed += await proposeToInbox(db, workspaceId, [staffId], {
          kind: 'missed_onboarding_self', subjectId: `self:${subj}`,
          title: 'You missed an onboarding session',
          body: `"${ev.title}" (${when}) went ahead without you. I've flagged HR to help you reschedule — reply here if you'd like me to find a new slot.`,
          metadata: { event_id: ev.id, audience: 'staff' }, source,
        });
        await queueFindingDelivery(db, {
          workspaceId, userIds: [staffId],
          headline: `You missed "${ev.title}" (${when})`,
          recommendation: 'I flagged HR to help reschedule. Want me to find a new slot?',
        }).catch(() => {});
      }
    }
  }
  await recordObservation(db, workspaceId, { domain: 'onboarding', subjectType: 'workspace', subjectId: workspaceId, signal: missed ? 'missed' : 'clear', value: missed });
  return { checked: sessions.length, missed, proposed };
}

// Stalled approvals — daemon actions awaiting a human decision for too long.
// Same "scheduled-commitment" shape as the missed-session detector: a thing that
// should have been decided wasn't. Cheap to add precisely because the shape is
// reusable (query the overdue set → record → propose one grounded digest).
export async function detectStalledApprovals(db, workspaceId) {
  const STALE_DAYS = Number(process.env.APPROVAL_STALE_DAYS || 3);
  const cutoff = new Date(Date.now() - STALE_DAYS * 86400000).toISOString();
  const { data: acts } = await db.from('daemon_actions')
    .select('id, title, type, created_at')
    .eq('workspace_id', workspaceId).eq('status', 'pending')
    .lte('created_at', cutoff).order('created_at', { ascending: true }).limit(20);
  const stalled = acts || [];

  await recordObservation(db, workspaceId, {
    domain: 'approval', subjectType: 'workspace', subjectId: workspaceId,
    signal: stalled.length ? 'stalled' : 'clear', value: stalled.length,
  });
  if (!stalled.length) return { stalled: 0, proposed: 0 };

  const recipients = await adminRecipients(db, workspaceId);
  const list = stalled.slice(0, 5).map(a => `• ${a.title || a.type || 'Action'} (waiting since ${String(a.created_at).slice(0, 10)})`).join('\n');
  const source = await groundCitation(db, workspaceId, stalled.map(a => a.title).filter(Boolean).join(' '));
  const proposed = await proposeToInbox(db, workspaceId, recipients, {
    kind: 'approvals_stalled', subjectId: workspaceId,
    title: `${stalled.length} approval${stalled.length === 1 ? '' : 's'} waiting ${STALE_DAYS}+ days`,
    body: `Pending your decision:\n${list}`,
    metadata: { count: stalled.length }, source,
  });
  return { stalled: stalled.length, proposed };
}

// Absence language + a session noun co-occurring in ONE sentence = a no-show
// mentioned in conversation. Same sentence keeps it precise (a long transcript
// that says "onboarding" in one place and "didn't show" elsewhere won't trip).
const ABSENCE_RE = /\b(no[\s-]?shows?|didn'?t\s+show|did\s+not\s+show|didn'?t\s+attend|did\s+not\s+attend|failed\s+to\s+attend|didn'?t\s+make\s+it|missing\s+from|absent\s+from|weren'?t\s+there|wasn'?t\s+there|skipped|missed)\b/i;
const CONV_SESSION_RE = /\b(onboard(ing)?|orientation|induction|new[\s-]?(hire|starter|joiner)|training|first[\s-]?day|welcome\s+session)\b/i;
const hashStr = (s) => { let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0; return (h >>> 0).toString(36); };
export function noShowQuotes(text) {
  if (!text) return [];
  const out = [];
  for (const raw of String(text).split(/[\n.!?]+/)) {
    const line = raw.trim().replace(/\s+/g, ' ');
    if (line.length < 8 || line.length > 240) continue;
    if (CONV_SESSION_RE.test(line) && ABSENCE_RE.test(line)) out.push(line);
  }
  return out;
}

// MISSED SESSIONS FROM CONVERSATION — the brain noticing a no-show the way a
// person would: from what's SAID, not just calendar RSVP. Scans recent daemon
// chats, Slack, and ingested docs (meeting transcripts / notes) for "someone
// missed onboarding/training" language, then raises the SAME grounded, confirm-
// first HR alert as the calendar detector. Best-effort on WHO (keyword); LLM
// extraction is the next enhancement. Complements detectMissedSessions.
export async function detectMissedSessionsFromConversation(db, workspaceId) {
  const sinceDays = Number(process.env.CONV_MISSED_WINDOW_DAYS || 3);
  const cutoff = new Date(Date.now() - sinceDays * 86400000).toISOString();
  const [biRes, slackRes, docRes] = await Promise.all([
    db.from('brain_interactions').select('user_message, created_at').eq('workspace_id', workspaceId).gte('created_at', cutoff).order('created_at', { ascending: false }).limit(200),
    db.from('slack_messages').select('text, created_at').eq('workspace_id', workspaceId).gte('created_at', cutoff).order('created_at', { ascending: false }).limit(200),
    db.from('workspace_documents').select('content, doc_type, updated_at').eq('workspace_id', workspaceId).in('doc_type', ['conversation', 'channel', 'page', 'transcript', 'meeting']).order('updated_at', { ascending: false }).limit(40),
  ]);
  const texts = [
    ...(biRes.data || []).map(r => r.user_message),
    ...(slackRes.data || []).map(r => r.text),
    ...(docRes.data || []).map(r => r.content),
  ];
  const quotes = [];
  const seen = new Set();
  for (const t of texts) {
    for (const q of noShowQuotes(t)) {
      const key = hashStr(q.toLowerCase());
      if (seen.has(key)) continue;
      seen.add(key);
      quotes.push({ quote: q, key });
    }
  }

  await recordObservation(db, workspaceId, {
    domain: 'onboarding_conv', subjectType: 'workspace', subjectId: workspaceId,
    signal: quotes.length ? 'mentioned' : 'clear', value: quotes.length,
  });
  if (!quotes.length) return { mentioned: 0, proposed: 0 };

  const hrOwners = await hrRecipients(db, workspaceId);
  let proposed = 0;
  for (const { quote, key } of quotes.slice(0, 5)) {
    const source = await groundCitation(db, workspaceId, quote);
    proposed += await proposeToInbox(db, workspaceId, hrOwners, {
      kind: 'missed_session_mentioned', subjectId: `conv:${key}`,
      title: 'Possible missed session mentioned',
      body: `Heard in conversation: "${quote}"\n\nSomeone may have missed a session — confirm who and reschedule if needed.`,
      metadata: {
        audience: 'hr', quote,
        action: { kind: 'reschedule_onboarding', label: 'Reschedule onboarding', session: 'onboarding', who: 'the attendee(s)' },
      }, source,
    });
  }
  return { mentioned: quotes.length, proposed };
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
  out.goals = await detectGoalsAtRisk(db, workspaceId).catch((e) => ({ error: e.message }));
  out.onboarding = await detectMissedSessions(db, workspaceId).catch((e) => ({ error: e.message }));
  out.onboardingConv = await detectMissedSessionsFromConversation(db, workspaceId).catch((e) => ({ error: e.message }));
  out.approvals = await detectStalledApprovals(db, workspaceId).catch((e) => ({ error: e.message }));

  // AUTO self-teaching: research one role's current best practices into the skill
  // library — bounded per run, round-robin across roles/runs.
  if (_learnedThisRun < LEARN_PER_RUN) {
    out.learning = await runContinuousLearning(db, workspaceId).catch((e) => ({ error: e.message }));
    if (out.learning?.ran && out.learning?.learned) _learnedThisRun++;
  }

  const lines = [];
  if (out.staff?.flagged) lines.push(`• ${out.staff.flagged} teammate(s) need attention`);
  if (out.deadlines?.slipped) lines.push(`• ${out.deadlines.slipped} deadline(s) slipping`);
  if (out.deals?.quiet) lines.push(`• ${out.deals.quiet} deal(s) gone cold`);
  if (out.threads?.quiet) lines.push(`• ${out.threads.quiet} thread(s) gone quiet`);
  if (out.goals?.at_risk) lines.push(`• ${out.goals.at_risk} goal(s) trending to miss`);
  if (out.onboarding?.missed) lines.push(`• ${out.onboarding.missed} missed onboarding session(s) — HR + staff notified`);
  if (out.onboardingConv?.mentioned) lines.push(`• ${out.onboardingConv.mentioned} possible missed session(s) heard in conversation`);
  if (out.approvals?.stalled) lines.push(`• ${out.approvals.stalled} approval(s) waiting too long`);
  if (out.learning?.learned) lines.push(`• taught myself ${out.learning.learned} new ${out.learning.role} skill(s)`);
  out.digest = lines.length
    ? await postDailyDigest(db, workspaceId, ['What I noticed today:', ...lines]).catch((e) => ({ error: e.message }))
    : { posted: 0 };
  return out;
}
