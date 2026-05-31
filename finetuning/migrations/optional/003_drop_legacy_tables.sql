-- Company Brain — drop legacy WorkDaemon finetuning tables.
--
-- DESTRUCTIVE AND IRREVERSIBLE. Only run once the pipeline has fully migrated to
-- the canonical `companies` / `interactions` / `training_signals` schema (002)
-- and you have confirmed nothing still reads the legacy tables.
--
-- Applied only via:  python scripts/run_migration.py --drop-legacy
-- (Back up first if these tables hold data you might want.)
--
-- NOTE: model_versions is intentionally KEPT — it is shared by the canonical
-- pipeline (each company's adapter audit trail lives there).

-- Drop in FK-dependency order. feedback_signals + self_critiques reference
-- query_logs, so they go first. CASCADE guards against any lingering deps.
drop table if exists feedback_signals    cascade;
drop table if exists self_critiques       cascade;
drop table if exists query_logs           cascade;
drop table if exists company_terminology  cascade;  -- replaced by cb_company_terminology
drop table if exists workspaces           cascade;  -- replaced by companies
