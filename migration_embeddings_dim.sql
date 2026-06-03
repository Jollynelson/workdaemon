-- Switch the embedding store to the Modal-served model's dimension.
-- nomic-embed-text = 768-dim (vs OpenAI text-embedding-3-small = 1536). Safe to
-- alter: no real vectors exist yet (all null). After deploying the Modal
-- embeddings endpoint, run the reindex action to populate. Run:
--   node scripts/run_migration.mjs migration_embeddings_dim.sql

drop index if exists workspace_documents_embedding;

alter table public.workspace_documents
  alter column embedding type vector(768);

create index if not exists workspace_documents_embedding
  on public.workspace_documents using hnsw (embedding vector_cosine_ops);

-- Recreate the matcher at the new dimension (arg type change = drop + create).
drop function if exists public.match_documents(uuid, vector, int);
create or replace function public.match_documents(p_workspace uuid, p_embedding vector(768), p_count int default 4)
returns table (source text, doc_type text, title text, content text, url text, similarity float)
language sql stable as $$
  select source, doc_type, title, content, url, 1 - (embedding <=> p_embedding) as similarity
  from public.workspace_documents
  where workspace_id = p_workspace and embedding is not null
  order by embedding <=> p_embedding
  limit p_count;
$$;
