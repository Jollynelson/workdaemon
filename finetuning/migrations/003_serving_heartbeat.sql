-- Serving warmth heartbeat — the readiness gate for instant chat.
--
-- The GPU serving class scales to zero, so the backend must know whether a
-- company's model is already warm before routing a turn to it (a cold call
-- hangs ~150s). The serving app upserts a row here whenever a company is warmed
-- (startup preload, explicit /api/serve/warm, or any live chat turn); the
-- readiness probe (GET /api/serve/ready) reads it without touching the GPU.

create table if not exists serving_heartbeat (
  company_id  uuid primary key,
  warmed_at   timestamptz not null default now()
);
