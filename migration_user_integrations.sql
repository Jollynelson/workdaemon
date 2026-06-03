-- Per-staff OAuth tokens (Phase 2 — "everyone connects their own daemon").
-- workspace_integrations holds the workspace BOT connection (one per provider);
-- this holds each STAFF member's own USER token, so the Brain can read what that
-- person can see (incl. their private channels) WITHOUT inviting a bot. Documents
-- ingested this way are scoped to channel members (migration_doc_access.sql).
-- Additive. Run: node scripts/run_migration.mjs migration_user_integrations.sql

create table if not exists public.user_integrations (
  id               uuid primary key default gen_random_uuid(),
  workspace_id     uuid references public.workspaces(id) on delete cascade,
  user_id          uuid references auth.users(id) on delete cascade,
  provider         text not null,
  user_token       text,                       -- encrypted (AES-GCM)
  scopes           text[] not null default '{}',
  external_account text,
  metadata         jsonb not null default '{}'::jsonb,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique (workspace_id, user_id, provider)
);
create index if not exists user_integrations_ws on public.user_integrations (workspace_id, provider);

alter table public.user_integrations enable row level security;
create policy "user_integrations_own_select" on public.user_integrations
  for select using (user_id = auth.uid());
