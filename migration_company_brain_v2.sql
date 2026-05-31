-- Company Brain v2 — Interaction Learning + Hunt Engine
-- Run in Supabase SQL Editor after all existing migrations

-- ── agent_profiles: per-user agent configuration ──────────────────────────────
create table if not exists public.agent_profiles (
  id                uuid primary key default gen_random_uuid(),
  user_id           uuid references auth.users(id) on delete cascade unique,
  workspace_id      uuid references public.workspaces(id) on delete cascade,
  access_level      text not null default 'junior'
                    check (access_level in ('junior','manager','director','executive')),
  permitted_tools   jsonb default '["slack","notion","google_drive"]'::jsonb,
  trust_score       numeric(4,2) default 1.00
                    check (trust_score between 0.0 and 2.0),
  interaction_count integer default 0,
  last_calibration  timestamptz,
  created_at        timestamptz default now(),
  updated_at        timestamptz default now()
);

create index if not exists agent_profiles_workspace
  on public.agent_profiles (workspace_id);

alter table public.agent_profiles enable row level security;

-- Users can see their own profile
create policy "agent_profiles_own_select" on public.agent_profiles
  for select using (user_id = auth.uid());

create policy "agent_profiles_own_insert" on public.agent_profiles
  for insert with check (user_id = auth.uid());

create policy "agent_profiles_own_update" on public.agent_profiles
  for update using (user_id = auth.uid());

-- Workspace members can read each other's profiles (admin overview)
create policy "agent_profiles_workspace_select" on public.agent_profiles
  for select using (
    workspace_id in (
      select workspace_id from public.workspace_members where user_id = auth.uid()
    )
  );

-- ── brain_interactions: rich interaction log for 3-level learning ─────────────
create table if not exists public.brain_interactions (
  id                  uuid primary key default gen_random_uuid(),
  user_id             uuid references auth.users(id) on delete cascade,
  workspace_id        uuid references public.workspaces(id) on delete cascade,
  user_role           text,
  access_level        text,
  user_message        text not null,
  topic_tags          text[],
  suggestion_acted_on boolean,
  session_hour        smallint check (session_hour between 0 and 23),
  message_length      integer,
  created_at          timestamptz default now()
);

create index if not exists brain_interactions_workspace_created
  on public.brain_interactions (workspace_id, created_at desc);

create index if not exists brain_interactions_user_created
  on public.brain_interactions (user_id, created_at desc);

alter table public.brain_interactions enable row level security;

create policy "brain_interactions_own_select" on public.brain_interactions
  for select using (user_id = auth.uid());

create policy "brain_interactions_own_insert" on public.brain_interactions
  for insert with check (user_id = auth.uid());

-- ── hunt_findings: brain-detected patterns across the 5 hunting modes ─────────
create table if not exists public.hunt_findings (
  id              uuid primary key default gen_random_uuid(),
  workspace_id    uuid references public.workspaces(id) on delete cascade,
  hunt_mode       text not null
                  check (hunt_mode in ('threat','waste','opportunity','performance','knowledge')),
  pattern         text not null,
  occurrences     integer default 1,
  affected_roles  text[],
  severity        text default 'info'
                  check (severity in ('info','warning','critical')),
  recommendation  text,
  resolved        boolean default false,
  pushed_to_inbox boolean default false,
  created_at      timestamptz default now(),
  updated_at      timestamptz default now()
);

create index if not exists hunt_findings_workspace_active
  on public.hunt_findings (workspace_id, resolved, severity, created_at desc);

alter table public.hunt_findings enable row level security;

-- Workspace members can read findings for their workspace
create policy "hunt_findings_workspace_select" on public.hunt_findings
  for select using (
    workspace_id in (
      select workspace_id from public.workspace_members where user_id = auth.uid()
    )
  );

-- Service role can insert/update (done via adminClient in API)
