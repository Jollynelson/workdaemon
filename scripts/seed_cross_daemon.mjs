// Seed cross-daemon communication scenarios into the Cobalt demo (additive).
// Showcases the three patterns from workdaemon-cross-daemon-communication.md:
//   1. Capacity-flag push-back (Scenario 3) — visible across two logins
//   2. Output→input handoff chain (Marketing → Sales)
//   3. Company-wide broadcast (HR parental-leave — doc's exact example)
// Idempotent: clears prior cross-daemon seed rows before re-seeding.
// Run: node scripts/seed_cross_daemon.mjs
import { readFileSync } from 'node:fs';
for (const l of readFileSync(new URL('../.env', import.meta.url), 'utf8').split('\n')) { const m = l.match(/^([A-Z0-9_]+)=(.*)$/); if (m) process.env[m[1]] = m[2].replace(/^"|"$/g, ''); }
process.env.SUPABASE_URL ||= process.env.NEXT_PUBLIC_SUPABASE_URL;
const { adminClient } = await import('../api/_lib/supabase.js');
const db = adminClient();

const ids = JSON.parse(readFileSync(new URL('../demo_cobalt_ids.json', import.meta.url), 'utf8'));
const WS = ids.workspace;
const U = ids.users;
const maya = U['maya@cobalt-hq.com'], daniel = U['daniel@cobalt-hq.com'], priya = U['priya@cobalt-hq.com'];
const marcus = U['marcus@cobalt-hq.com'], sofia = U['sofia@cobalt-hq.com'], aisha = U['aisha@cobalt-hq.com'], tom = U['tom@cobalt-hq.com'];
const now = Date.now(), DAY = 864e5;
const ago = (h) => new Date(now - h * 36e5).toISOString();
const inDays = (d) => new Date(now + d * DAY).toISOString().slice(0, 10);

// ── Clean prior cross-daemon seed (safe: only this workspace, only marked rows) ──
await db.from('daemon_events').delete().eq('workspace_id', WS);
await db.from('inbox_items').delete().eq('workspace_id', WS).eq('metadata->>cd_seed', 'true');
await db.from('tasks').delete().eq('workspace_id', WS).eq('routed_by_brain', true);
await db.from('app_agent_profiles').update({ availability: 'normal', availability_reason: null, availability_until: null }).eq('workspace_id', WS);
console.log('cleared prior cross-daemon seed');

const ev = (e) => db.from('daemon_events').insert({ workspace_id: WS, status: 'pending', created_at: ago(e.h ?? 2), ...e, h: undefined });
const inbox = (r) => db.from('inbox_items').insert({ workspace_id: WS, source: 'daemon', read: false, created_at: ago(r.h ?? 2), ...r, h: undefined, metadata: { ...(r.metadata || {}), cd_seed: true } });

// ── Scenario 1: Priya is overloaded, and her daemon pushed back on an assignment ─
// Priya's daemon publishes HIGH_LOAD (owns the P0 Close Automation GA blocker).
await db.from('app_agent_profiles').update({
  availability: 'high_load',
  availability_reason: 'Owns the P0 Close Automation multi-entity GA blocker (2 design partners waiting) + 3 open tasks',
  availability_until: inDays(5),
}).eq('user_id', priya);

// Maya assigned Priya a new task; routed by her daemon.
const { data: task1 } = await db.from('tasks').insert({
  workspace_id: WS, title: 'Scope the Q4 multi-currency module', status: 'todo', priority: 'P1',
  description: 'Pre-work so multi-currency can start the day Close Automation hits GA.',
  brief: 'Define data model + FX-rate source + close-impact for multi-currency. Needed to start Q4 build immediately after GA.',
  assignee_id: priya, from_user_id: maya, created_by: maya, due_date: inDays(4), routed_by_brain: true, created_at: ago(3),
}).select().single();

await ev({ from_user_id: maya, to_user_id: priya, type: 'assignment', task_id: task1.id, h: 3,
  payload: { title: task1.title, priority: 'P1', brief: task1.brief } });
await inbox({ user_id: priya, type: 'task', title: 'Maya assigned you: Scope the Q4 multi-currency module',
  body: task1.brief, h: 3, metadata: { task_id: task1.id, event_type: 'assignment', priority: 'P1', from: 'Maya Okafor' } });

// Priya's daemon flagged a capacity risk back to Maya (Scenario 3 counter-proposal).
const flagReason = 'Priya is at high load — she owns the P0 Close Automation GA blocker with 2 design partners waiting this week. Adding multi-currency scoping now risks slipping GA.';
const flagSuggest = 'Hold multi-currency scoping until after GA (next week), or pull Daniel in for the data-model + FX-source parts so Priya only owns close-impact.';
await ev({ from_user_id: priya, to_user_id: maya, type: 'flag', task_id: task1.id, h: 2,
  payload: { title: task1.title, reason: flagReason, suggestion: flagSuggest } });
await inbox({ user_id: maya, type: 'alert', title: "⚠ Priya's daemon flagged a capacity risk: Scope the Q4 multi-currency module",
  body: flagReason + '\n\nSuggested: ' + flagSuggest, h: 2, metadata: { task_id: task1.id, event_type: 'flag', severity: 'warning', from: 'Priya Raman' } });

// ── Scenario 2: Output→input handoff (Marketing → Sales) ─────────────────────────
const { data: done } = await db.from('tasks').insert({
  workspace_id: WS, title: "Ship 'switch from Ramp' landing page", status: 'done', priority: 'P1',
  description: 'Comparison page targeting Ramp price-hike refugees.',
  assignee_id: sofia, from_user_id: marcus, created_by: marcus, routed_by_brain: true,
  output: 'Live at /switch-from-ramp. Leads with the Ramp price hike + Close Automation. 3 proof points (Northwind 40% expansion, 9→7 day close, SOC 2 in progress). CTA: book a migration call.',
  due_date: inDays(-1), created_at: ago(72),
}).select().single();

const { data: task2 } = await db.from('tasks').insert({
  workspace_id: WS, title: 'Run the Ramp-switch outbound to the 6 stalled deals', status: 'todo', priority: 'P1',
  description: "Sofia's landing page is live — use it as the hook to revive the stalled Ramp-eval deals.",
  brief: "From Sofia: /switch-from-ramp is live (Ramp price hike + Close Automation angle, Northwind/close-time/SOC2 proof). Use it as the outbound hook for the 6 stalled Ramp-eval deals.",
  assignee_id: marcus, from_user_id: sofia, created_by: sofia, parent_task_id: done.id, next_assignee_id: null,
  routed_by_brain: true, due_date: inDays(3), created_at: ago(2),
}).select().single();

await ev({ from_user_id: sofia, to_user_id: marcus, type: 'handoff', task_id: task2.id, h: 2,
  payload: { title: task2.title, from_task: done.title, output: done.output } });
await inbox({ user_id: marcus, type: 'task', title: "Sofia completed 'switch from Ramp' page — it's in your queue",
  body: task2.brief, h: 2, metadata: { task_id: task2.id, event_type: 'handoff', priority: 'P1', from: 'Sofia Reyes' } });

// ── Scenario 3: Company-wide broadcast (HR — doc's parental-leave example) ────────
const policy = 'New parental-leave policy: 16 weeks fully paid for all parents, effective 1 July. Applies to every Cobalt employee regardless of tenure. Details + how to plan coverage in the People handbook.';
await ev({ from_user_id: aisha, to_user_id: null, type: 'broadcast', h: 5, payload: { message: policy, from: 'Aisha Khan' } });
for (const uid of [maya, daniel, priya, marcus, sofia, tom]) {
  await inbox({ user_id: uid, type: 'update', title: 'Broadcast from Aisha Khan', body: policy, h: 5,
    metadata: { event_type: 'broadcast', from: 'Aisha Khan' } });
}

console.log('✓ cross-daemon scenarios seeded:');
console.log('  • Priya HIGH_LOAD + Maya→Priya assignment + Priya→Maya capacity flag');
console.log('  • Sofia→Marcus handoff (landing page → outbound)');
console.log('  • Aisha company-wide parental-leave broadcast (6 recipients)');
console.log('\nDemo: log in as Priya (sees overload+assignment), Maya (sees the flag),');
console.log('      Marcus (sees the handoff), anyone (sees the broadcast, personalised by role).');
