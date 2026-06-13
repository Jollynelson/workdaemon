-- Worker daemons: ad-hoc, task-scoped sub-daemons the user's daemon spins up to
-- perform a delegated piece of work, then supervises to completion. A worker
-- reports to its OWNER (the supervising staff member); the supervisor daemon sees
-- its workers' status in chat, and a cron re-runs/escalates overdue ones.
create table if not exists worker_daemons (
  id             uuid primary key default gen_random_uuid(),
  workspace_id   uuid not null,
  owner_id       uuid not null,                          -- supervising staff (worker reports here)
  objective      text not null,                          -- the self-contained sub-task
  status         text not null default 'queued',         -- queued | running | done | failed | needs_review
  result         text,                                   -- the worker's output
  attempts       int  not null default 0,
  max_attempts   int  not null default 2,
  deadline_at    timestamptz,                            -- when it's expected done (drives supervision)
  last_checked_at timestamptz,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create index if not exists worker_daemons_owner_idx  on worker_daemons (workspace_id, owner_id, status);
create index if not exists worker_daemons_active_idx on worker_daemons (status, deadline_at);
