-- Realtime push (workdaemon-cross-daemon-communication.md — "notified immediately").
-- Add inbox_items + daemon_events to the Supabase Realtime publication so the
-- client gets INSERTs over a websocket (RLS-scoped to the user) the instant a
-- daemon assigns/flags/broadcasts or the Brain routes a task — no polling.
-- Guarded so re-runs are safe. Run: node scripts/run_migration.mjs migration_realtime.sql

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'inbox_items'
  ) then
    alter publication supabase_realtime add table public.inbox_items;
  end if;
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'daemon_events'
  ) then
    alter publication supabase_realtime add table public.daemon_events;
  end if;
end $$;
