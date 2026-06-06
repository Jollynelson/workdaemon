-- Autonomous Role Agents (Growth Agent first). See
-- docs/specs/WorkDaemon_Growth_Agent_Spec.md. Additive — safe for live data.
-- Run: node scripts/run_migration.mjs migration_agents.sql

-- ── Agent definitions ────────────────────────────────────────────────────────
create table if not exists public.agents (
  id            uuid primary key default gen_random_uuid(),
  workspace_id  uuid not null references public.workspaces(id) on delete cascade,
  created_by    uuid references auth.users(id) on delete set null,
  name          text not null,
  role          text not null default 'sales'
                check (role in ('sales','social','support','research','custom')),
  objective     text not null,
  kpi           jsonb not null default '{}'::jsonb,            -- {metric,target,window}
  channels      text[] not null default '{}',                 -- ['email','x','linkedin']
  autonomy      text not null default 'approve_first'
                check (autonomy in ('approve_first','auto_send')),
  -- per-channel auto-send grants the agent has *earned* (subset of channels)
  auto_channels text[] not null default '{}',
  schedule      text not null default '0 8 * * *',             -- cron; daily 8am default
  config        jsonb not null default '{}'::jsonb,            -- icp, caps, persona, etc.
  status        text not null default 'active'
                check (status in ('active','paused')),
  last_run_at   timestamptz,
  next_run_at   timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index if not exists agents_ws on public.agents (workspace_id, status);
create index if not exists agents_due on public.agents (status, next_run_at);

-- ── Run log (one row per loop execution) ─────────────────────────────────────
create table if not exists public.agent_runs (
  id            uuid primary key default gen_random_uuid(),
  agent_id      uuid not null references public.agents(id) on delete cascade,
  workspace_id  uuid not null references public.workspaces(id) on delete cascade,
  status        text not null default 'running'
                check (status in ('running','done','error')),
  phase         text,                                          -- plan|research|score|draft|queue|send|measure
  metrics       jsonb not null default '{}'::jsonb,            -- {found,scored,drafted,queued,sent}
  log           text,
  error         text,
  started_at    timestamptz not null default now(),
  finished_at   timestamptz
);
create index if not exists agent_runs_agent on public.agent_runs (agent_id, started_at desc);

-- ── Discovered prospects ─────────────────────────────────────────────────────
create table if not exists public.outreach_targets (
  id            uuid primary key default gen_random_uuid(),
  agent_id      uuid not null references public.agents(id) on delete cascade,
  workspace_id  uuid not null references public.workspaces(id) on delete cascade,
  company       text,
  person_name   text,
  title         text,
  email         text,
  x_handle      text,
  linkedin_url  text,
  website       text,
  source_url    text,
  research      text,                                          -- snippet that grounds the draft
  score         numeric(4,2) default 0,                        -- ICP fit 0..1
  status        text not null default 'new'
                check (status in ('new','queued','contacted','replied','won','lost','skipped')),
  dedupe_key    text,                                          -- normalized company/domain for dedupe
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (agent_id, dedupe_key)
);
create index if not exists outreach_targets_agent on public.outreach_targets (agent_id, status, score desc);

-- ── Drafted / queued / sent messages ─────────────────────────────────────────
create table if not exists public.outreach_messages (
  id            uuid primary key default gen_random_uuid(),
  agent_id      uuid not null references public.agents(id) on delete cascade,
  workspace_id  uuid not null references public.workspaces(id) on delete cascade,
  target_id     uuid references public.outreach_targets(id) on delete cascade,
  channel       text not null check (channel in ('email','x','linkedin')),
  to_address    text,                                          -- email/handle/url
  subject       text,
  body          text not null,
  status        text not null default 'draft'
                check (status in ('draft','approved','sending','sent','failed','rejected','replied')),
  provider_id   text,                                          -- ESP/API message id
  approved_by   uuid references auth.users(id) on delete set null,
  error         text,
  created_at    timestamptz not null default now(),
  sent_at       timestamptz,
  replied_at    timestamptz
);
create index if not exists outreach_messages_agent on public.outreach_messages (agent_id, status, created_at desc);
create index if not exists outreach_messages_ws on public.outreach_messages (workspace_id, status);

-- ── Compliance: suppression list (opt-outs + hard bounces) ───────────────────
create table if not exists public.suppression_list (
  id            uuid primary key default gen_random_uuid(),
  workspace_id  uuid not null references public.workspaces(id) on delete cascade,
  channel       text not null,
  address       text not null,                                 -- email/handle, normalized lowercase
  reason        text,                                          -- unsubscribe|bounce|complaint|manual
  created_at    timestamptz not null default now(),
  unique (workspace_id, channel, address)
);
create index if not exists suppression_ws on public.suppression_list (workspace_id, channel);

-- ── RLS: workspace members read; writes go through the service-role engine ────
alter table public.agents             enable row level security;
alter table public.agent_runs         enable row level security;
alter table public.outreach_targets   enable row level security;
alter table public.outreach_messages  enable row level security;
alter table public.suppression_list   enable row level security;

create policy "agents_member_select" on public.agents
  for select using (workspace_id in (
    select workspace_id from public.workspace_members where user_id = auth.uid()));
create policy "agent_runs_member_select" on public.agent_runs
  for select using (workspace_id in (
    select workspace_id from public.workspace_members where user_id = auth.uid()));
create policy "outreach_targets_member_select" on public.outreach_targets
  for select using (workspace_id in (
    select workspace_id from public.workspace_members where user_id = auth.uid()));
create policy "outreach_messages_member_select" on public.outreach_messages
  for select using (workspace_id in (
    select workspace_id from public.workspace_members where user_id = auth.uid()));
create policy "suppression_member_select" on public.suppression_list
  for select using (workspace_id in (
    select workspace_id from public.workspace_members where user_id = auth.uid()));
