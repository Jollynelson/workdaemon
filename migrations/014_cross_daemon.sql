-- Cross-Daemon Communication (additive — safe for the live Cobalt demo).
-- Implements the capability from workdaemon-cross-daemon-communication.md within
-- the live Vercel+Supabase stack: a shared event bus (daemon_events), task
-- handoff/routing metadata on the existing tasks table, and a per-staff
-- availability signal on app_agent_profiles. Nothing here modifies or drops
-- existing columns/rows — all adds are nullable or defaulted.
--
-- Run in Supabase SQL editor (or psql over DATABASE_URL_UNPOOLED).

-- ── Daemon event bus ──────────────────────────────────────────────────────────
-- Every cross-daemon signal (assignment, capacity flag, counter-proposal,
-- acceptance, broadcast, availability) is a row here. Daemons read events tagged
-- to their owner and surface them. The Brain (this table + inbox_items) is the
-- single source of truth; daemons never talk to each other directly.
create table if not exists public.daemon_events (
  id            uuid primary key default gen_random_uuid(),
  workspace_id  uuid references public.workspaces(id) on delete cascade,
  from_user_id  uuid references auth.users(id) on delete set null,
  to_user_id    uuid references auth.users(id) on delete cascade,  -- null = company-wide broadcast
  type          text not null,
  -- assignment | accepted | flag | counter_proposal | broadcast | availability | handoff
  task_id       uuid references public.tasks(id) on delete cascade,
  payload       jsonb default '{}'::jsonb,
  status        text default 'pending',  -- pending | surfaced | resolved
  created_at    timestamptz default now(),
  resolved_at   timestamptz
);
create index if not exists daemon_events_inbox
  on public.daemon_events (workspace_id, to_user_id, status, created_at desc);
create index if not exists daemon_events_from
  on public.daemon_events (workspace_id, from_user_id, created_at desc);

alter table public.daemon_events enable row level security;
-- Recipient (or broadcast) and sender can see the event; service role bypasses RLS.
create policy "daemon_events_recipient_select" on public.daemon_events
  for select using (
    to_user_id = auth.uid()
    or from_user_id = auth.uid()
    or (to_user_id is null and workspace_id in (
      select workspace_id from public.workspace_members where user_id = auth.uid()))
  );

-- ── Task handoff / routing metadata (additive) ───────────────────────────────
alter table public.tasks
  add column if not exists from_user_id    uuid references auth.users(id) on delete set null,
  add column if not exists brief            text,
  add column if not exists next_assignee_id uuid references auth.users(id) on delete set null,
  add column if not exists routed_by_brain  boolean default false,
  add column if not exists output           text,
  add column if not exists parent_task_id   uuid references public.tasks(id) on delete set null;

-- ── Per-staff availability signal (additive) ─────────────────────────────────
-- A daemon publishes its owner's capacity so other daemons can reason before
-- assigning. 'normal' is the default so existing rows behave unchanged.
alter table public.app_agent_profiles
  add column if not exists availability        text default 'normal'
                            check (availability in ('normal','high_load','away')),
  add column if not exists availability_reason text,
  add column if not exists availability_until  timestamptz;
