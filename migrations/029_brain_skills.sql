-- Brain Skill Library — the "Skills" pillar of a Hermes-style agent, held by the
-- Company Brain and passed to daemons at runtime (injected into in-app daemon
-- prompts AND served over the read-only MCP surface to the Hermes agent).
-- Skills are SKILL.md-style instruction sets the daemon interprets at runtime
-- (the agentskills.io model) — NOT fine-tuned into weights. Additive + idempotent.
--   node scripts/run_migration.mjs migration_brain_skills.sql

create table if not exists public.brain_skills (
  id            uuid primary key default gen_random_uuid(),
  workspace_id  uuid references public.workspaces(id) on delete cascade,  -- NULL = global/platform skill (all companies)
  slug          text not null,
  name          text not null,
  pillar        text not null default 'skills',  -- memory|skills|soul|crons|self_improvement|research|content|knowledge|devops|productivity|growth
  category      text,
  trigger_description text not null,              -- "when to use this" (SKILL.md description → drives selection)
  body          text not null,                   -- the playbook the daemon applies
  tags          text[] not null default '{}',
  source_url    text,
  learned_from  text not null default 'seed'     -- seed|experience|import
                check (learned_from in ('seed','experience','import')),
  confidence    numeric(4,2) not null default 0.7,
  usage_count   int not null default 0,
  status        text not null default 'active'
                check (status in ('active','archived')),
  created_by    uuid references auth.users(id) on delete set null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

-- One slug per scope: global skills unique on slug; workspace skills unique per (workspace, slug).
create unique index if not exists brain_skills_slug_global on public.brain_skills (slug) where workspace_id is null;
create unique index if not exists brain_skills_slug_ws on public.brain_skills (workspace_id, slug) where workspace_id is not null;
create index if not exists brain_skills_lookup on public.brain_skills (status, pillar);
create index if not exists brain_skills_ws on public.brain_skills (workspace_id, status);

-- RLS: any member may read their workspace's skills + all global skills; writes go through the service-role engine.
alter table public.brain_skills enable row level security;
drop policy if exists "brain_skills_select" on public.brain_skills;
create policy "brain_skills_select" on public.brain_skills
  for select using (
    workspace_id is null
    or workspace_id in (select workspace_id from public.workspace_members where user_id = auth.uid()));
