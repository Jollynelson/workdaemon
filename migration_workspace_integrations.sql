-- Native OAuth connectors: per-workspace connected tools (Slack, Google, ...).
-- Tokens are stored ENCRYPTED (AES-256-GCM via api/_lib/security.encryptSecret),
-- never in plaintext. One connection per (workspace, provider). Run in Supabase.

create table if not exists public.workspace_integrations (
  id               uuid primary key default gen_random_uuid(),
  workspace_id     uuid not null references public.workspaces(id) on delete cascade,
  provider         text not null,                       -- 'slack', 'google', 'github', ...
  status           text not null default 'connected'
                   check (status in ('connected','error','revoked')),
  access_token     text,                                -- encrypted
  refresh_token    text,                                -- encrypted (nullable)
  token_expires_at timestamptz,
  scopes           text[],
  external_account text,                                -- team / account name on the provider
  metadata         jsonb default '{}'::jsonb,
  connected_by     uuid references auth.users(id) on delete set null,
  created_at       timestamptz default now(),
  updated_at       timestamptz default now(),
  unique (workspace_id, provider)
);

create index if not exists workspace_integrations_ws
  on public.workspace_integrations (workspace_id);

alter table public.workspace_integrations enable row level security;

-- Members can see which tools are connected (never the tokens — the API never
-- returns them; writes happen only via the service-role in the OAuth handler).
create policy "workspace_integrations_member_select" on public.workspace_integrations
  for select using (
    workspace_id in (select workspace_id from public.workspace_members where user_id = auth.uid())
  );
