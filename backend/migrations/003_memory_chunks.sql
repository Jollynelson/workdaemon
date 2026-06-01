-- RAG storage (FINAL spec §12): per-company/per-user vector memory.
-- Activates the "facts → retrieval" half so the brain actually knows company data.
-- Embedding dim = 384 (local fastembed BAAI/bge-small-en-v1.5). If EMBEDDING_PROVIDER
-- is switched to OpenAI text-embedding-3-small (1536), this must be re-created at 1536.

create extension if not exists vector;

create table if not exists memory_chunks (
  id          uuid primary key default gen_random_uuid(),
  namespace   text not null,            -- company_{id} | user_{staff}_{company}
  content     text not null,
  embedding   vector(384) not null,
  metadata    jsonb default '{}',
  created_at  timestamptz not null default now()
);

create index if not exists memory_chunks_namespace on memory_chunks (namespace);
-- ANN index for cosine similarity search
create index if not exists memory_chunks_embedding on memory_chunks
  using ivfflat (embedding vector_cosine_ops) with (lists = 100);

alter table memory_chunks enable row level security;
alter table memory_chunks force row level security;

-- Similarity search within a single namespace (the store calls this RPC).
-- query_embedding is passed as a JSON-array TEXT and cast to vector inside —
-- PostgREST can't bind a vector(384) param through its schema cache, so text +
-- cast is the reliable calling convention. The namespace arg is the company
-- scoping (caller always passes exactly one company's namespace).
create or replace function match_memory(
  p_namespace text,
  query_embedding text,
  match_count int default 8
)
returns table (id uuid, content text, metadata jsonb, similarity float)
language sql stable
as $$
  select mc.id, mc.content, mc.metadata,
         1 - (mc.embedding <=> query_embedding::vector) as similarity
  from memory_chunks mc
  where mc.namespace = p_namespace
  order by mc.embedding <=> query_embedding::vector
  limit match_count;
$$;
