-- Hunt finding → cross-daemon task (FINAL §9.1 Flow 3: Brain-initiated routing).
-- Additive: link a brain-routed task back to the hunt finding that spawned it,
-- so we can dedup (one task per finding) and trace provenance.
-- Run: node scripts/run_migration.mjs migration_task_from_finding.sql

alter table public.tasks
  add column if not exists source_finding_id uuid references public.hunt_findings(id) on delete set null;

create index if not exists tasks_source_finding on public.tasks (workspace_id, source_finding_id);
