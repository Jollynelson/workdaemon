-- Fine-tuning pipeline tables.
-- Every table is scoped by company_id; enforce RLS at the application layer
-- via SUPABASE_SERVICE_KEY and explicit WHERE company_id = $1 filters.

create table if not exists query_logs (
  id             uuid primary key default gen_random_uuid(),
  company_id     uuid not null,
  user_id        uuid not null,
  query_text     text not null,
  answer_text    text not null,
  context_chunks jsonb,
  model_used     text,
  created_at     timestamptz not null default now()
);
create index if not exists query_logs_company_created
  on query_logs (company_id, created_at);

create table if not exists feedback_signals (
  id                 uuid primary key default gen_random_uuid(),
  company_id         uuid not null,
  query_log_id       uuid not null references query_logs(id),
  thumb              smallint,           -- 1 up, -1 down, null none
  followed_up        boolean default false,
  ragas_faithfulness float,
  ragas_relevance    float,
  created_at         timestamptz not null default now()
);
create index if not exists feedback_signals_company_created
  on feedback_signals (company_id, created_at);

create table if not exists self_critiques (
  id              uuid primary key default gen_random_uuid(),
  company_id      uuid not null,
  query_log_id    uuid not null references query_logs(id),
  was_complete    boolean,
  missing_context text,
  improved_answer text,
  critique_score  float,
  created_at      timestamptz not null default now()
);
create index if not exists self_critiques_company_created
  on self_critiques (company_id, created_at);

create table if not exists company_terminology (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null,
  term        text not null,
  definition  text not null,
  source      text,
  created_at  timestamptz not null default now()
);
create index if not exists company_terminology_company
  on company_terminology (company_id);

create table if not exists model_versions (
  id           uuid primary key default gen_random_uuid(),
  company_id   uuid not null,
  version      int not null,
  hf_repo      text not null,
  hf_revision  text not null,
  eval_score   float,
  deployed     boolean default false,
  num_examples int,
  trained_at   timestamptz not null default now()
);
create index if not exists model_versions_company_version
  on model_versions (company_id, version);
