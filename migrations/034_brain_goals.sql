-- Brain Goals + brain-assigned daemon skills (2026-06-10).
-- The Company Brain sets ambitious goals for the company the moment a workspace
-- is created, and role-scoped goals for each staff daemon at onboarding. It
-- tracks progress from real activity, raises the bar when a goal is achieved,
-- and escalates when one stalls. daemon_skills records the skill set the brain
-- assigns to each staff member's daemon at onboarding.
-- Additive + idempotent.
--   node scripts/run_migration.mjs 034_brain_goals.sql

create table if not exists public.brain_goals (
  id             uuid primary key default gen_random_uuid(),
  workspace_id   uuid not null references public.workspaces(id) on delete cascade,
  user_id        uuid references auth.users(id) on delete cascade,   -- NULL = company-level goal
  scope          text not null default 'company' check (scope in ('company','staff')),
  title          text not null,
  description    text,
  metric         text,                       -- how progress is measured
  target         text,                       -- definition of done / target value
  horizon_days   int not null default 30,
  due_at         timestamptz,
  ambition       text not null default 'stretch'
                 check (ambition in ('baseline','stretch','moonshot')),
  progress       int not null default 0 check (progress between 0 and 100),
  status         text not null default 'active'
                 check (status in ('active','achieved','missed','retired')),
  origin         text not null default 'brain' check (origin in ('brain','human')),
  parent_goal_id uuid references public.brain_goals(id) on delete set null,  -- raise-the-bar chain
  rationale      text,                       -- why the brain set this goal
  review_note    text,                       -- latest review assessment
  last_review_at timestamptz,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create index if not exists brain_goals_ws   on public.brain_goals (workspace_id, status);
create index if not exists brain_goals_user on public.brain_goals (user_id, status);

alter table public.brain_goals enable row level security;
drop policy if exists "brain_goals_select" on public.brain_goals;
create policy "brain_goals_select" on public.brain_goals
  for select using (
    workspace_id in (select workspace_id from public.workspace_members where user_id = auth.uid()));

-- ── Brain-assigned skills per staff daemon ────────────────────────────────────
-- At onboarding the brain picks (and where needed, generates) the skill set for
-- this person's role and pins it to their daemon. relevantSkills() pins these
-- in every prompt for that user.
create table if not exists public.daemon_skills (
  id            uuid primary key default gen_random_uuid(),
  workspace_id  uuid not null references public.workspaces(id) on delete cascade,
  user_id       uuid not null references auth.users(id) on delete cascade,
  skill_slug    text not null,
  reason        text,                        -- why the brain assigned it
  assigned_by   text not null default 'brain' check (assigned_by in ('brain','admin','self')),
  created_at    timestamptz not null default now(),
  unique (user_id, skill_slug)
);
create index if not exists daemon_skills_ws on public.daemon_skills (workspace_id);

alter table public.daemon_skills enable row level security;
drop policy if exists "daemon_skills_select" on public.daemon_skills;
create policy "daemon_skills_select" on public.daemon_skills
  for select using (
    workspace_id in (select workspace_id from public.workspace_members where user_id = auth.uid()));

-- Extend learned_from: 'assigned' (brain-generated role skills at onboarding) +
-- 'custom' (FIXES a latent prod bug — the add_skill action has been inserting
-- learned_from='custom', which the 030 constraint rejected).
alter table public.brain_skills drop constraint if exists brain_skills_learned_from_check;
alter table public.brain_skills add constraint brain_skills_learned_from_check
  check (learned_from in ('seed','experience','import','discovered','assigned','custom'));
