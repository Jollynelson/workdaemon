-- Generalize "agents" into autonomous DAEMONS (n8n-style, knowledge-native).
-- Additive + idempotent — safe for live data.
--   node scripts/run_migration.mjs migration_daemons_general.sql
--
-- An outreach agent (kind='outreach') keeps using outreach_targets/outreach_messages.
-- A knowledge daemon (kind='knowledge') reads the Company Brain on a schedule and
-- proposes ACTIONS into daemon_actions for approval — drafts, tasks, notes, messages.

-- ── kind discriminator on the existing agents table ──────────────────────────
alter table public.agents
  add column if not exists kind text not null default 'outreach';
-- widen the role check so knowledge daemons aren't forced into a sales role
alter table public.agents drop constraint if exists agents_role_check;
alter table public.agents add constraint agents_role_check
  check (role in ('sales','social','support','research','custom','knowledge'));
alter table public.agents drop constraint if exists agents_kind_check;
alter table public.agents add constraint agents_kind_check
  check (kind in ('outreach','knowledge'));

-- ── General proposed-action queue (the approve-first surface for knowledge daemons) ──
create table if not exists public.daemon_actions (
  id            uuid primary key default gen_random_uuid(),
  agent_id      uuid not null references public.agents(id) on delete cascade,
  workspace_id  uuid not null references public.workspaces(id) on delete cascade,
  run_id        uuid references public.agent_runs(id) on delete set null,
  type          text not null
                check (type in ('task','note','message','draft','alert')),
  title         text not null,
  body          text,
  payload       jsonb not null default '{}'::jsonb,    -- type-specific: {assignee_role,channel,to,...}
  rationale     text,                                   -- why the daemon proposed this (brain-grounded)
  status        text not null default 'proposed'
                check (status in ('proposed','approved','rejected','done','failed')),
  approved_by   uuid references auth.users(id) on delete set null,
  result        text,
  created_at    timestamptz not null default now(),
  acted_at      timestamptz
);
create index if not exists daemon_actions_agent on public.daemon_actions (agent_id, status, created_at desc);
create index if not exists daemon_actions_ws on public.daemon_actions (workspace_id, status, created_at desc);

alter table public.daemon_actions enable row level security;
drop policy if exists "daemon_actions_member_select" on public.daemon_actions;
create policy "daemon_actions_member_select" on public.daemon_actions
  for select using (workspace_id in (
    select workspace_id from public.workspace_members where user_id = auth.uid()));
