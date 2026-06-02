-- WorkDaemon Database Schema
-- Run this in your Supabase SQL Editor

-- ── Extensions ───────────────────────────────────────────────────────────────
create extension if not exists "pgcrypto";

-- ── Workspaces ────────────────────────────────────────────────────────────────
create table public.workspaces (
  id           uuid primary key default gen_random_uuid(),
  name         text not null,
  size         text,
  industry     text,
  owner_id     uuid references auth.users(id) on delete set null,
  invite_code  text unique default encode(gen_random_bytes(8), 'hex'),
  created_at   timestamptz default now()
);

-- ── Profiles (extends auth.users) ────────────────────────────────────────────
create table public.profiles (
  id           uuid references auth.users(id) on delete cascade primary key,
  name         text,
  title        text,
  role         text,
  industry     text,
  workspace_id uuid references public.workspaces(id),
  onboarded    boolean default false,
  created_at   timestamptz default now(),
  updated_at   timestamptz default now()
);

-- ── Workspace Members ─────────────────────────────────────────────────────────
create table public.workspace_members (
  workspace_id uuid references public.workspaces(id) on delete cascade,
  user_id      uuid references auth.users(id) on delete cascade,
  role         text default 'member',  -- 'admin' | 'member'
  joined_at    timestamptz default now(),
  primary key (workspace_id, user_id)
);

-- ── Tasks ─────────────────────────────────────────────────────────────────────
create table public.tasks (
  id           uuid primary key default gen_random_uuid(),
  workspace_id uuid references public.workspaces(id) on delete cascade,
  title        text not null,
  description  text,
  status       text default 'todo',  -- 'todo' | 'in_progress' | 'done'
  priority     text default 'P3',   -- 'P0' | 'P1' | 'P2' | 'P3'
  assignee_id  uuid references auth.users(id) on delete set null,
  created_by   uuid references auth.users(id) on delete set null,
  due_date     date,
  created_at   timestamptz default now(),
  updated_at   timestamptz default now()
);

-- ── Inbox Items ───────────────────────────────────────────────────────────────
create table public.inbox_items (
  id           uuid primary key default gen_random_uuid(),
  workspace_id uuid references public.workspaces(id) on delete cascade,
  user_id      uuid references auth.users(id) on delete cascade,
  type         text,    -- 'task' | 'mention' | 'alert' | 'update'
  source       text,   -- 'github' | 'slack' | 'daemon' | 'gmail'
  title        text,
  body         text,
  read         boolean default false,
  metadata     jsonb,
  created_at   timestamptz default now()
);

-- ── Workspace Invites ─────────────────────────────────────────────────────────
create table public.workspace_invites (
  id           uuid primary key default gen_random_uuid(),
  workspace_id uuid references public.workspaces(id) on delete cascade,
  email        text not null,
  invited_by   uuid references auth.users(id) on delete set null,
  accepted     boolean default false,
  created_at   timestamptz default now(),
  unique (workspace_id, email)
);

-- ── Row Level Security ────────────────────────────────────────────────────────
alter table public.profiles         enable row level security;
alter table public.workspaces       enable row level security;
alter table public.workspace_members enable row level security;
alter table public.tasks            enable row level security;
alter table public.inbox_items      enable row level security;
alter table public.workspace_invites enable row level security;

-- Profiles: own row only
create policy "profiles_select" on public.profiles for select using (auth.uid() = id);
create policy "profiles_insert" on public.profiles for insert with check (auth.uid() = id);
create policy "profiles_update" on public.profiles for update using (auth.uid() = id);

-- Workspaces: owners and members
create policy "workspaces_select" on public.workspaces for select using (
  owner_id = auth.uid() or
  id in (select workspace_id from public.workspace_members where user_id = auth.uid())
);
create policy "workspaces_insert" on public.workspaces for insert with check (owner_id = auth.uid());
create policy "workspaces_update" on public.workspaces for update using (owner_id = auth.uid());

-- Workspace members: members of the same workspace
create policy "members_select" on public.workspace_members for select using (
  workspace_id in (select workspace_id from public.workspace_members where user_id = auth.uid())
);
create policy "members_insert" on public.workspace_members for insert with check (
  workspace_id in (select id from public.workspaces where owner_id = auth.uid())
);

-- Tasks: workspace members
create policy "tasks_select" on public.tasks for select using (
  workspace_id in (select workspace_id from public.workspace_members where user_id = auth.uid())
);
create policy "tasks_insert" on public.tasks for insert with check (
  workspace_id in (select workspace_id from public.workspace_members where user_id = auth.uid())
);
create policy "tasks_update" on public.tasks for update using (
  workspace_id in (select workspace_id from public.workspace_members where user_id = auth.uid())
);

-- Inbox: own items only
create policy "inbox_select" on public.inbox_items for select using (user_id = auth.uid());
create policy "inbox_update" on public.inbox_items for update using (user_id = auth.uid());

-- Invites: workspace admins only
create policy "invites_select" on public.workspace_invites for select using (
  workspace_id in (select workspace_id from public.workspace_members where user_id = auth.uid() and role = 'admin')
);

-- ── Auto-create profile on signup ─────────────────────────────────────────────
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer as $$
begin
  insert into public.profiles (id, name)
  values (new.id, new.raw_user_meta_data->>'name')
  on conflict (id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();
