-- Per-staff, per-integration seeding / readiness status with TWO tracks, so the
-- UI can show a freshly connected source filling up to 100% on both:
--   brain  = shared history ingested into the company knowledge store (sees it)
--   daemon = the staff's own daemon wired + caught up on their personal slice (acts on it)
create table if not exists integration_seeds (
  id            uuid primary key default gen_random_uuid(),
  workspace_id  uuid not null,
  user_id       uuid not null,
  provider      text not null,

  -- 🧠 Brain track — shared ingest (channels/threads/files; never personal DMs)
  brain_status  text not null default 'pending',   -- pending | seeding | ready | error
  brain_stage   text,
  brain_done    int  not null default 0,
  brain_total   int  not null default 0,

  -- 🤖 Daemon track — per-staff act-readiness + catch-up on their own slice
  daemon_status text not null default 'pending',   -- pending | seeding | ready | needs_reconnect | error
  daemon_stage  text,
  daemon_done   int  not null default 0,
  daemon_total  int  not null default 0,

  doc_count     int  not null default 0,           -- docs the brain ingested
  error         text,
  started_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),

  unique (workspace_id, user_id, provider)
);

create index if not exists integration_seeds_ws_user_idx on integration_seeds (workspace_id, user_id);
