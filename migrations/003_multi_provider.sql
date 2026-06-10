-- Multi-provider API keys table
-- Run in Supabase SQL Editor

create table if not exists public.workspace_api_keys (
  id           uuid default gen_random_uuid() primary key,
  workspace_id uuid references public.workspaces(id) on delete cascade not null,
  provider     text not null,
  api_key      text,
  endpoint     text,
  model        text,
  use_case     text not null default 'reasoning',
  label        text,
  created_at   timestamptz default now() not null,
  updated_at   timestamptz default now() not null,
  unique (workspace_id, provider, use_case)
);

-- Migrate existing single OpenRouter key if present
insert into public.workspace_api_keys (workspace_id, provider, api_key, model, use_case)
select id, 'openrouter', openrouter_key, openrouter_model, 'reasoning'
from public.workspaces
where openrouter_key is not null
on conflict (workspace_id, provider, use_case) do nothing;

-- RLS: workspace members can read, admins can write (API enforces write via service role)
alter table public.workspace_api_keys enable row level security;

create policy "members can read workspace keys"
  on public.workspace_api_keys for select
  using (
    workspace_id in (
      select workspace_id from public.workspace_members where user_id = auth.uid()
    )
  );
