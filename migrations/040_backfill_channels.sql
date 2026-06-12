-- Resumable deep-history backfill state, one row per channel. The worker walks a
-- channel's FULL history across many short invocations by persisting the Slack
-- pagination `cursor` after every page — so years of conversations load even
-- though each serverless run is capped at ~60s. Deep pages are written as
-- separate `channel-<id>-b<n>` docs (the regular ingest's reconcile leaves these
-- alone), so backfill and the recent/real-time sync never fight.
create table if not exists backfill_channels (
  id             uuid primary key default gen_random_uuid(),
  workspace_id   uuid not null,
  provider       text not null default 'slack',
  channel_id     text not null,
  channel_name   text,
  visibility     text not null default 'public',
  allowed_users  uuid[] not null default '{}',
  cursor         text,                       -- Slack next_cursor; null = start
  skip_remaining int  not null default 0,    -- recent msgs already covered by the live ingest
  next_chunk     int  not null default 0,    -- next `-b<n>` doc index to write
  messages       int  not null default 0,    -- deep messages indexed so far
  status         text not null default 'pending', -- pending | running | done | error
  error          text,
  started_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  unique (workspace_id, provider, channel_id)
);
create index if not exists backfill_channels_active_idx on backfill_channels (workspace_id, status);
