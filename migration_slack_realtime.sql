-- Real-time Slack ingestion (Events API). Messages stream in via the events
-- endpoint → stored here so the daemon can reference them, @mentions become
-- inbox alerts, and the brain pulse detects arguments/decisions. Run in Supabase.

create table if not exists public.slack_messages (
  id           uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  channel_id   text not null,
  channel_name text,
  slack_user   text,                 -- author's Slack user id
  text         text,
  ts           text not null,        -- Slack message ts (unique per channel)
  thread_ts    text,
  mentions     text[] default '{}',  -- Slack user ids @mentioned
  event_id     text,
  created_at   timestamptz default now(),
  unique (workspace_id, channel_id, ts)
);
create index if not exists slack_messages_ws_created
  on public.slack_messages (workspace_id, created_at desc);

-- Slack user → WorkDaemon member map (resolved lazily by email) so a mention
-- can be routed to the right person's daemon/inbox.
create table if not exists public.slack_user_map (
  workspace_id  uuid not null references public.workspaces(id) on delete cascade,
  slack_user_id text not null,
  user_id       uuid references auth.users(id) on delete set null,  -- WorkDaemon user (nullable if no match)
  email         text,
  real_name     text,
  updated_at    timestamptz default now(),
  primary key (workspace_id, slack_user_id)
);

alter table public.slack_messages enable row level security;
alter table public.slack_user_map enable row level security;
-- Workspace members can read the stream / map; writes are service-role only.
create policy "slack_messages_member_select" on public.slack_messages
  for select using (workspace_id in (select workspace_id from public.workspace_members where user_id = auth.uid()));
create policy "slack_user_map_member_select" on public.slack_user_map
  for select using (workspace_id in (select workspace_id from public.workspace_members where user_id = auth.uid()));
