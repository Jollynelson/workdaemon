-- The Vercel app's per-user agent profile (access level, trust, interaction
-- count). The name `agent_profiles` was already taken in prod by the Modal
-- backend's own (incompatible: company_id/staff_id) table, so the app's
-- `migration_company_brain_v2.sql` silently never reshaped it — meaning the
-- live app's access-level / trust / interaction-learning had never worked
-- (queries by user_id/access_level errored → fell back to 'junior' defaults).
-- This gives the Vercel app its OWN table; code now points here. Run in Supabase.

create table if not exists public.app_agent_profiles (
  user_id           uuid primary key references auth.users(id) on delete cascade,
  workspace_id      uuid references public.workspaces(id) on delete cascade,
  access_level      text not null default 'junior'
                    check (access_level in ('junior','manager','director','executive')),
  permitted_tools   jsonb default '["slack","notion","google_drive"]'::jsonb,
  trust_score       numeric(4,2) default 1.00 check (trust_score between 0.0 and 2.0),
  interaction_count integer default 0,
  last_calibration  timestamptz,
  created_at        timestamptz default now(),
  updated_at        timestamptz default now()
);

create index if not exists app_agent_profiles_workspace
  on public.app_agent_profiles (workspace_id);

alter table public.app_agent_profiles enable row level security;

create policy "app_agent_profiles_own_select" on public.app_agent_profiles
  for select using (user_id = auth.uid());
create policy "app_agent_profiles_own_upsert" on public.app_agent_profiles
  for insert with check (user_id = auth.uid());
create policy "app_agent_profiles_own_update" on public.app_agent_profiles
  for update using (user_id = auth.uid());
-- Workspace members can read each other's profiles (admin overview).
create policy "app_agent_profiles_ws_select" on public.app_agent_profiles
  for select using (
    workspace_id in (select workspace_id from public.workspace_members where user_id = auth.uid())
  );
