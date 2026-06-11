-- Daemon outbox (2026-06-11): daemon-initiated chat messages.
-- The daemon can now reach out FIRST: scheduled reminders ("message me by 3pm
-- about X"), report-backs, and important hunt findings are queued here and
-- delivered INTO THE CHAT — immediately if the user is online (60s poll), or
-- the next time they open their daemon. Nothing a user is meant to see can be
-- missed: undelivered rows persist until swept.
-- Additive + idempotent.
--   node scripts/run_migration.mjs migrations/035_daemon_outbox.sql

create table if not exists public.daemon_outbox (
  id            uuid primary key default gen_random_uuid(),
  workspace_id  uuid not null references public.workspaces(id) on delete cascade,
  user_id       uuid not null references auth.users(id) on delete cascade,
  kind          text not null default 'reminder'
                check (kind in ('reminder','report','finding','update')),
  title         text,
  message       text not null,            -- the daemon's message, pre-written
  blocks        jsonb,                    -- optional rich blocks (overrides message rendering)
  deliver_at    timestamptz not null default now(),
  source        text,                     -- e.g. 'user_request' | 'hunt_finding:<id>' | 'agent:<id>'
  status        text not null default 'pending'
                check (status in ('pending','delivered','cancelled')),
  delivered_at  timestamptz,
  created_at    timestamptz not null default now()
);
create index if not exists daemon_outbox_due
  on public.daemon_outbox (user_id, status, deliver_at);
create index if not exists daemon_outbox_ws
  on public.daemon_outbox (workspace_id, status);

alter table public.daemon_outbox enable row level security;
drop policy if exists "daemon_outbox_select" on public.daemon_outbox;
create policy "daemon_outbox_select" on public.daemon_outbox
  for select using (user_id = auth.uid());
