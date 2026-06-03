-- Push calibration (Master §10.2 / FINAL push/calibration.py — "back off if a
-- staff member ignores a push type"). Track whether a push was acted on (not just
-- read) so the Brain can stop pushing categories a user consistently ignores.
-- Additive. Run: node scripts/run_migration.mjs migration_push_calibration.sql

alter table public.inbox_items
  add column if not exists acted_on boolean default false,
  add column if not exists acted_at timestamptz;

create index if not exists inbox_items_calib on public.inbox_items (user_id, created_at desc);
