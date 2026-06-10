-- Semantic retrieval for ingested documents (FINAL §3 vector store). Upgrades the
-- keyword grounding to pgvector cosine similarity. Additive — keyword retrieval
-- stays as the fallback when embeddings/the key are absent.
-- Run: node scripts/run_migration.mjs migration_pgvector.sql

create extension if not exists vector;

alter table public.workspace_documents
  add column if not exists embedding vector(1536);   -- text-embedding-3-small

create index if not exists workspace_documents_embedding
  on public.workspace_documents using hnsw (embedding vector_cosine_ops);

-- Top-K documents for a workspace by cosine similarity to a query embedding.
create or replace function public.match_documents(p_workspace uuid, p_embedding vector(1536), p_count int default 4)
returns table (source text, doc_type text, title text, content text, url text, similarity float)
language sql stable as $$
  select source, doc_type, title, content, url, 1 - (embedding <=> p_embedding) as similarity
  from public.workspace_documents
  where workspace_id = p_workspace and embedding is not null
  order by embedding <=> p_embedding
  limit p_count;
$$;
