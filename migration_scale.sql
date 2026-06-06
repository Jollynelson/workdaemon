-- Scale: make the nightly brain sweep cover ALL workspaces instead of the first
-- 25-50. Adds a cursor column so the cron processes least-recently-scanned
-- workspaces within a wall-clock budget, and indexes the codebase global scan.
-- Additive — safe for live data. Run: node scripts/run_migration.mjs migration_scale.sql

-- Cursor for the round-robin sweep: oldest (or never) scanned go first.
alter table public.workspaces add column if not exists last_scanned_at timestamptz;
create index if not exists workspaces_scan_cursor on public.workspaces (last_scanned_at nulls first);

-- Speeds runCodebaseImprover's cross-workspace (workspace_id null) error scan.
create index if not exists learning_signals_domain_created
  on public.learning_signals (domain, created_at desc);
