-- Daemon chat history + adaptive memory
-- Run in Supabase SQL Editor

-- ── daemon_messages: persistent chat history per user ─────────────────────────
create table if not exists public.daemon_messages (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid references auth.users(id) on delete cascade,
  workspace_id uuid references public.workspaces(id) on delete cascade,
  role         text not null check (role in ('user', 'daemon')),
  content      text not null,
  created_at   timestamptz default now()
);

create index if not exists daemon_messages_user_created
  on public.daemon_messages (user_id, created_at desc);

alter table public.daemon_messages enable row level security;

create policy "daemon_messages_select" on public.daemon_messages
  for select using (user_id = auth.uid());

create policy "daemon_messages_insert" on public.daemon_messages
  for insert with check (user_id = auth.uid());

-- ── daemon_memory: what the daemon has learned about the user ─────────────────
create table if not exists public.daemon_memory (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid references auth.users(id) on delete cascade,
  workspace_id uuid references public.workspaces(id) on delete cascade,
  key          text not null,
  value        text not null,
  memory_type  text not null default 'preference',
  updated_at   timestamptz default now(),
  unique (user_id, key)
);

create index if not exists daemon_memory_user_updated
  on public.daemon_memory (user_id, updated_at desc);

alter table public.daemon_memory enable row level security;

create policy "daemon_memory_select" on public.daemon_memory
  for select using (user_id = auth.uid());

create policy "daemon_memory_insert" on public.daemon_memory
  for insert with check (user_id = auth.uid());

create policy "daemon_memory_update" on public.daemon_memory
  for update using (user_id = auth.uid());
