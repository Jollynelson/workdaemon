-- Cross-staff pattern detection (additive). Implements the detected_patterns
-- table from WorkDaemon_FINAL_BuildSpec.md §5/§11, scoped to workspace_id (the
-- live app's tenant key) with auth.users ids. The Brain clusters last-30-day
-- interactions; ≥3 distinct staff on a topic → a typed pattern, surfaced to
-- managers/executives anonymised (counts + roles, never names).
--
-- Run: node scripts/run_migration.mjs migration_detected_patterns.sql

create table if not exists public.app_detected_patterns (
  id             uuid primary key default gen_random_uuid(),
  workspace_id   uuid references public.workspaces(id) on delete cascade,
  pattern_type   text not null,
  -- repeated_question | shared_blocker | workflow_gap | knowledge_gap |
  -- cross_team_dependency | risk_signal
  title          text not null,
  detail         text not null,
  evidence       jsonb,                       -- {tag, staff_count, roles}
  staff_involved jsonb default '[]'::jsonb,    -- user_ids (stored; never surfaced by name)
  confidence     numeric(4,2) not null default 0.5,
  status         text not null default 'open', -- open | surfaced | resolved
  escalated_to   uuid references auth.users(id) on delete set null,
  created_at     timestamptz not null default now(),
  resolved_at    timestamptz
);
create index if not exists app_detected_patterns_ws
  on public.app_detected_patterns (workspace_id, status, created_at desc);

alter table public.app_detected_patterns enable row level security;
-- Workspace members can read patterns for their workspace; service role writes.
create policy "app_detected_patterns_member_select" on public.app_detected_patterns
  for select using (
    workspace_id in (select workspace_id from public.workspace_members where user_id = auth.uid())
  );
