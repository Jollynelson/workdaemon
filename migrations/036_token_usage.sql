-- 036_token_usage.sql — per-call LLM token metering for the Overview Token Usage
-- widget (IA §9). One row per model call; aggregated by workspace + month.
-- Counts are exact when the provider returns usage, else estimated (chars/4).
create table if not exists public.token_usage (
  id                bigint generated always as identity primary key,
  workspace_id      uuid not null,
  user_id           uuid,
  provider          text,
  model             text,
  prompt_tokens     integer not null default 0,
  completion_tokens integer not null default 0,
  total_tokens      integer not null default 0,
  created_at        timestamptz not null default now()
);

create index if not exists token_usage_ws_created_idx on public.token_usage (workspace_id, created_at desc);
create index if not exists token_usage_ws_user_idx     on public.token_usage (workspace_id, user_id);
