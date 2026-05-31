-- Company Brain — canonical schema (spec Section 5)
-- Run after 001_finetuning_tables.sql
-- Every table carries company_id; RLS enforced at application layer via
-- service-role key + explicit WHERE company_id = $1 in every query.

-- ── companies ─────────────────────────────────────────────────────────────────
create table if not exists companies (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  slug       text unique not null,
  tier       text not null default 'pro',  -- free | pro | enterprise
  created_at timestamptz not null default now()
);

-- ── staff ─────────────────────────────────────────────────────────────────────
create table if not exists staff (
  id            uuid primary key default gen_random_uuid(),
  company_id    uuid not null references companies(id) on delete cascade,
  name          text not null,
  email         text not null,
  role          text not null,
  department    text not null,
  access_level  text not null default 'junior'
                check (access_level in ('junior','manager','director','executive')),
  tenure_start  date,
  status        text not null default 'active'
                check (status in ('active','inactive')),
  created_at    timestamptz not null default now(),
  unique (company_id, email)
);
create index if not exists staff_company on staff (company_id);

-- ── agent_profiles ────────────────────────────────────────────────────────────
create table if not exists agent_profiles (
  id                uuid primary key default gen_random_uuid(),
  company_id        uuid not null references companies(id) on delete cascade,
  staff_id          uuid not null references staff(id) on delete cascade,
  memory_namespace  text not null,  -- user_{staff_id}_{company_id}
  permitted_tools   jsonb not null default '[]',
  system_prompt     text,           -- cached; rebuilt with fresh context each convo
  trust_score       float not null default 1.0
                    check (trust_score between 0.0 and 2.0),
  interaction_count int not null default 0,
  last_active       timestamptz,
  status            text not null default 'active'
                    check (status in ('active','inactive','archived')),
  created_at        timestamptz not null default now(),
  unique (company_id, staff_id)
);
create index if not exists agent_profiles_company on agent_profiles (company_id, status);

-- ── interactions (the unique learning channel) ────────────────────────────────
create table if not exists interactions (
  id                  uuid primary key default gen_random_uuid(),
  company_id          uuid not null references companies(id) on delete cascade,
  staff_id            uuid not null references staff(id) on delete cascade,
  role                text not null,
  user_message        text not null,
  agent_response      text not null,
  tools_called        jsonb default '[]',
  context_used        jsonb,            -- which vector chunks were injected
  suggestion_acted_on boolean,          -- null=n/a, true/false = trust signal
  sentiment           text,             -- frustrated|neutral|positive|disengaged
  session_hour        smallint,         -- 0-23 for work-pattern analysis
  created_at          timestamptz not null default now()
);
create index if not exists interactions_company_created
  on interactions (company_id, created_at desc);
create index if not exists interactions_staff_created
  on interactions (company_id, staff_id, created_at desc);

-- ── training_signals ──────────────────────────────────────────────────────────
-- Derived from interactions + feedback. The dataset builder reads this table.
create table if not exists training_signals (
  id              uuid primary key default gen_random_uuid(),
  company_id      uuid not null references companies(id) on delete cascade,
  interaction_id  uuid references interactions(id),
  kind            text not null,   -- positive_pair | critique_correction | terminology | role_behavior
  prompt          text not null,
  target          text not null,
  score           float,           -- 0..1 quality score
  used_in_version int,             -- which model_versions.version consumed it
  created_at      timestamptz not null default now()
);
create index if not exists training_signals_company_created
  on training_signals (company_id, created_at desc);
create index if not exists training_signals_unused
  on training_signals (company_id, used_in_version) where used_in_version is null;

-- ── company_terminology ───────────────────────────────────────────────────────
create table if not exists cb_company_terminology (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null references companies(id) on delete cascade,
  term        text not null,
  definition  text not null,
  source      text,
  created_at  timestamptz not null default now()
);
create index if not exists cb_terminology_company on cb_company_terminology (company_id);

-- ── hunt_findings ─────────────────────────────────────────────────────────────
create table if not exists cb_hunt_findings (
  id           uuid primary key default gen_random_uuid(),
  company_id   uuid not null references companies(id) on delete cascade,
  mode         text not null
               check (mode in ('threat','waste','opportunity','performance','knowledge')),
  title        text not null,
  detail       text not null,
  evidence     jsonb,          -- interaction IDs, tool data, etc.
  confidence   float not null default 0.5
               check (confidence between 0.0 and 1.0),
  target_role  text,           -- which role this is for
  target_staff uuid references staff(id),
  status       text not null default 'open'
               check (status in ('open','pushed','acted','dismissed')),
  created_at   timestamptz not null default now()
);
create index if not exists cb_hunt_findings_company_status
  on cb_hunt_findings (company_id, status, created_at desc);

-- ── pushes ────────────────────────────────────────────────────────────────────
create table if not exists pushes (
  id                 uuid primary key default gen_random_uuid(),
  company_id         uuid not null references companies(id) on delete cascade,
  staff_id           uuid not null references staff(id) on delete cascade,
  finding_id         uuid references cb_hunt_findings(id),
  message            text not null,
  recommended_action text,
  delivered_at       timestamptz,
  acted_on           boolean,
  created_at         timestamptz not null default now()
);
create index if not exists pushes_company_staff
  on pushes (company_id, staff_id, created_at desc);
create index if not exists pushes_undelivered
  on pushes (company_id, staff_id) where delivered_at is null;

-- ── model_versions (extended from existing table) ─────────────────────────────
-- Existing model_versions table already has company_id column from migration 001.
-- Add base_score column if not present.
alter table model_versions
  add column if not exists base_score float;

-- ── vector store tables (pgvector) ───────────────────────────────────────────
-- Each namespace is a row filter; no separate tables per namespace.
create extension if not exists vector;

create table if not exists vector_documents (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null,
  namespace   text not null,  -- 'company_{id}' or 'user_{staff_id}_{company_id}'
  content     text not null,
  embedding   vector(1536),   -- text-embedding-3-small dimension
  metadata    jsonb default '{}',
  created_at  timestamptz not null default now()
);
create index if not exists vector_docs_namespace
  on vector_documents (company_id, namespace);
-- IVFFlat index — create after loading sufficient data
-- create index vector_docs_embedding on vector_documents using ivfflat (embedding vector_cosine_ops) with (lists = 100);
