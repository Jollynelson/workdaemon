-- WorkDaemon — FINAL build spec, Section 5.
-- Every table carries company_id; RLS enabled as a backstop (the FastAPI backend
-- uses the service role and scopes every query by company_id in db.py).

create extension if not exists "pgcrypto";

-- ── COMPANIES + STAFF ──────────────────────────────────────────────────────────

create table if not exists companies (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  slug        text unique not null,
  tier        text not null default 'pro',
  created_at  timestamptz not null default now()
);

create table if not exists staff (
  id            uuid primary key default gen_random_uuid(),
  company_id    uuid not null references companies(id) on delete cascade,
  name          text not null,
  email         text not null,
  role          text not null,
  department    text not null,
  access_level  text not null,               -- junior|manager|director|executive
  status        text not null default 'active',
  created_at    timestamptz not null default now(),
  unique (company_id, email)
);
create index if not exists staff_company on staff (company_id);

-- Own-runtime agent (no Hermes): the model is shared (DeepSeek Flash); what makes
-- an agent distinct is its system prompt + memory namespace + permitted tools.
create table if not exists agent_profiles (
  id                uuid primary key default gen_random_uuid(),
  company_id        uuid not null references companies(id) on delete cascade,
  staff_id          uuid not null references staff(id) on delete cascade,
  memory_namespace  text not null,           -- "user_{staff_id}_{company_id}"
  permitted_tools   jsonb not null default '[]',
  system_prompt     text,                    -- cached; rebuilt with fresh context per convo
  trust_score       float not null default 1.0,
  interaction_count int not null default 0,
  last_active       timestamptz,
  status            text not null default 'active',
  created_at        timestamptz not null default now(),
  unique (company_id, staff_id)
);

-- ── INTERACTIONS (the Brain's visibility layer) ─────────────────────────────────

create table if not exists interactions (
  id                    uuid primary key default gen_random_uuid(),
  company_id            uuid not null references companies(id) on delete cascade,
  staff_id              uuid not null references staff(id) on delete cascade,
  role                  text not null,
  user_message          text not null,
  agent_response        text not null,
  tools_called          jsonb default '[]',
  mcp_servers_used      jsonb default '[]',
  context_chunks        jsonb,
  triggered_by_task_id  uuid,
  generated_task_ids    jsonb default '[]',
  suggestion_acted_on   boolean,
  sentiment             text,
  brain_pattern_flags   jsonb default '[]',
  created_at            timestamptz not null default now()
);
create index if not exists interactions_company_created on interactions (company_id, created_at);
create index if not exists interactions_company_staff on interactions (company_id, staff_id, created_at);

-- ── ACTIVITY FEED (Brain's live company view) ───────────────────────────────────

create table if not exists activity_events (
  id            uuid primary key default gen_random_uuid(),
  company_id    uuid not null references companies(id) on delete cascade,
  staff_id      uuid references staff(id) on delete set null,
  event_type    text not null,
  payload       jsonb not null,
  visible_to    text not null default 'brain',  -- brain|executives|managers|all
  created_at    timestamptz not null default now()
);
create index if not exists activity_company_created on activity_events (company_id, created_at);
create index if not exists activity_company_type on activity_events (company_id, event_type, created_at);

-- ── CROSS-AGENT TASKS ────────────────────────────────────────────────────────────

create table if not exists tasks (
  id              uuid primary key default gen_random_uuid(),
  company_id      uuid not null references companies(id) on delete cascade,
  title           text not null,
  description     text,
  brief           text,
  from_staff_id   uuid references staff(id) on delete set null,
  to_staff_id     uuid not null references staff(id) on delete cascade,
  parent_task_id  uuid references tasks(id) on delete set null,
  chain_position  int not null default 0,
  status          text not null default 'pending',
  -- pending|delivered|accepted|in_progress|completed|handed_off|blocked|flagged
  priority        text not null default 'normal',
  due_at          timestamptz,
  output          text,
  output_artifacts jsonb default '[]',
  next_agent_id   uuid references staff(id) on delete set null,
  routed_by_brain boolean not null default true,
  brain_context   jsonb,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index if not exists tasks_company_to_status on tasks (company_id, to_staff_id, status);
create index if not exists tasks_company_from_status on tasks (company_id, from_staff_id, status);
create index if not exists tasks_company_parent on tasks (company_id, parent_task_id);

-- ── CROSS-STAFF PATTERNS (Brain detection) ──────────────────────────────────────

create table if not exists detected_patterns (
  id              uuid primary key default gen_random_uuid(),
  company_id      uuid not null references companies(id) on delete cascade,
  pattern_type    text not null,
  title           text not null,
  detail          text not null,
  evidence        jsonb,
  staff_involved  jsonb default '[]',
  confidence      float not null default 0.5,
  status          text not null default 'open',
  escalated_to    uuid references staff(id) on delete set null,
  created_at      timestamptz not null default now()
);
create index if not exists patterns_company_status on detected_patterns (company_id, status, created_at);

-- ── HUNT FINDINGS + PUSHES ───────────────────────────────────────────────────────

create table if not exists hunt_findings (
  id            uuid primary key default gen_random_uuid(),
  company_id    uuid not null references companies(id) on delete cascade,
  mode          text not null,               -- threat|waste|opportunity|performance|knowledge
  title         text not null,
  detail        text not null,
  evidence      jsonb,
  confidence    float not null default 0.5,
  depth         text not null default 'fast',  -- fast|deep
  brain_model   text,                        -- which DeepSeek tier produced it
  target_role   text,
  target_staff  uuid references staff(id) on delete set null,
  status        text not null default 'open',
  created_at    timestamptz not null default now()
);
create index if not exists findings_company_status on hunt_findings (company_id, status, created_at);

create table if not exists pushes (
  id                  uuid primary key default gen_random_uuid(),
  company_id          uuid not null references companies(id) on delete cascade,
  staff_id            uuid not null references staff(id) on delete cascade,
  finding_id          uuid references hunt_findings(id) on delete set null,
  pattern_id          uuid references detected_patterns(id) on delete set null,
  task_id             uuid references tasks(id) on delete set null,
  kind                text not null,
  message             text not null,
  recommended_action  text,
  draft_artifact      text,
  delivered_at        timestamptz,
  read_at             timestamptz,
  acted_on            boolean,
  created_at          timestamptz not null default now()
);
create index if not exists pushes_company_staff on pushes (company_id, staff_id, delivered_at);

-- ── KNOWLEDGE + LEARNING ──────────────────────────────────────────────────────────

create table if not exists company_terminology (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null references companies(id) on delete cascade,
  term        text not null,
  definition  text not null,
  source      text,
  created_at  timestamptz not null default now()
);

create table if not exists training_signals (
  id              uuid primary key default gen_random_uuid(),
  company_id      uuid not null references companies(id) on delete cascade,
  interaction_id  uuid references interactions(id) on delete set null,
  kind            text not null,             -- positive_pair|critique|terminology|brain_distillation
  prompt          text not null,
  target          text not null,
  score           float,
  created_at      timestamptz not null default now()
);
create index if not exists training_company_created on training_signals (company_id, created_at);

-- ── ROW-LEVEL SECURITY (backstop; backend uses service role + scoped queries) ─────
do $$
declare t text;
begin
  foreach t in array array[
    'companies','staff','agent_profiles','interactions','activity_events','tasks',
    'detected_patterns','hunt_findings','pushes','company_terminology','training_signals'
  ] loop
    execute format('alter table %I enable row level security', t);
    execute format('alter table %I force row level security', t);
  end loop;
end $$;
