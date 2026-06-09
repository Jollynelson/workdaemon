-- Allow autonomously-discovered skills (the brain finds + learns skills from the
-- web on its own). Additive + idempotent.
--   node scripts/run_migration.mjs migration_brain_skills_discovered.sql
alter table public.brain_skills drop constraint if exists brain_skills_learned_from_check;
alter table public.brain_skills add constraint brain_skills_learned_from_check
  check (learned_from in ('seed','experience','import','discovered'));
