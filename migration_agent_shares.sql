-- Team Daemon sharing (IA §5.2.3). An autonomous daemon (agents row) can be
-- shared with specific people or the whole company, each at an access level.
-- Access levels: viewer < user < editor < owner (the creator is the implicit owner).
create table if not exists public.agent_shares (
  id            uuid primary key default gen_random_uuid(),
  agent_id      uuid not null references public.agents(id) on delete cascade,
  workspace_id  uuid not null references public.workspaces(id) on delete cascade,
  shared_with   uuid references auth.users(id) on delete cascade,  -- null = company-wide
  company_wide  boolean not null default false,
  access_level  text not null default 'viewer'
                check (access_level in ('viewer','user','editor','owner')),
  created_by    uuid references auth.users(id) on delete set null,
  created_at    timestamptz not null default now()
);
-- One share row per (agent, person) and one company-wide row per agent.
create unique index if not exists agent_shares_person on public.agent_shares (agent_id, shared_with) where shared_with is not null;
create unique index if not exists agent_shares_company on public.agent_shares (agent_id) where company_wide;
create index if not exists agent_shares_with on public.agent_shares (shared_with);
alter table public.agent_shares enable row level security;
