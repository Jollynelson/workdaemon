-- Ingestion sink (FINAL §17 / Master §12 "ingestion"). The normalized document
-- store every connector writes into; the daemon grounds answers on it (keyword
-- retrieval — the pgvector store the spec mentions, approximated without a vector
-- DB). Additive. Run: node scripts/run_migration.mjs migration_ingestion.sql

create table if not exists public.workspace_documents (
  id           uuid primary key default gen_random_uuid(),
  workspace_id uuid references public.workspaces(id) on delete cascade,
  source       text not null,                 -- notion | github | gdrive | gmail | slack | manual
  external_id  text not null,                 -- provider id (dedup key)
  doc_type     text,                          -- page | issue | doc | file | message
  title        text,
  content      text,                          -- normalized plain text (capped on write)
  url          text,
  author       text,
  metadata     jsonb default '{}'::jsonb,
  updated_at   timestamptz not null default now(),
  created_at   timestamptz not null default now(),
  unique (workspace_id, source, external_id)
);
create index if not exists workspace_documents_ws on public.workspace_documents (workspace_id, source);

alter table public.workspace_documents enable row level security;
create policy "workspace_documents_member_select" on public.workspace_documents
  for select using (workspace_id in (select workspace_id from public.workspace_members where user_id = auth.uid()));
