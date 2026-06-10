-- Per-staff access control on ingested documents (Master §14 / FINAL §13).
-- A document is either 'public' (anyone in the workspace) or 'restricted' to a
-- set of staff (e.g. a private Slack channel → its members). Retrieval is scoped
-- to the asker: you can't pull content from a room you're not in. The Brain may
-- still see a restricted doc EXISTS (to suggest "ask <member>") but never leaks
-- its content. Additive. Run: node scripts/run_migration.mjs migration_doc_access.sql

alter table public.workspace_documents
  add column if not exists visibility    text not null default 'public',  -- public | restricted
  add column if not exists allowed_users uuid[] not null default '{}';     -- staff who may see a restricted doc

-- Re-create the matcher with an asker filter: only public docs, or restricted
-- docs the asker is a member of.
drop function if exists public.match_documents(uuid, vector, int);
drop function if exists public.match_documents(uuid, vector, uuid, int);
create or replace function public.match_documents(p_workspace uuid, p_embedding vector(768), p_user uuid, p_count int default 4)
returns table (source text, doc_type text, title text, content text, url text, similarity float)
language sql stable as $$
  select source, doc_type, title, content, url, 1 - (embedding <=> p_embedding) as similarity
  from public.workspace_documents
  where workspace_id = p_workspace and embedding is not null
    and (visibility = 'public' or p_user = any(allowed_users))
  order by embedding <=> p_embedding
  limit p_count;
$$;
