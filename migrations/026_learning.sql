-- Self-Improvement substrate: signals → insights → adaptation.
-- One shared loop behind four surfaces (agents, daemons, brain, codebase).
-- Additive — safe for live data. Run: node scripts/run_migration.mjs migration_learning.sql

-- ── Append-only outcome / feedback events ────────────────────────────────────
-- domain: which surface produced the signal.
-- subject_type/subject_id: what the signal is about (an outreach_message, a
--   daemon_message, a brain finding, a code error fingerprint).
-- signal: the verb (approved|rejected|edited|sent|opened|replied|up|down|stale|error…).
-- value: optional magnitude (edit distance, score, occurrence count).
create table if not exists public.learning_signals (
  id            uuid primary key default gen_random_uuid(),
  workspace_id  uuid references public.workspaces(id) on delete cascade,
  domain        text not null check (domain in ('agent','daemon','brain','codebase')),
  subject_type  text not null,
  subject_id    text,
  signal        text not null,
  value         numeric,
  meta          jsonb not null default '{}'::jsonb,
  created_at    timestamptz not null default now()
);
create index if not exists learning_signals_ws on public.learning_signals (workspace_id, domain, created_at desc);
create index if not exists learning_signals_subject on public.learning_signals (subject_type, subject_id);

-- ── Distilled, applied learnings (the part behavior actually reads) ───────────
-- scope: who/what the insight applies to ({agent_id}|{user_id}|{role}|{}).
-- status: proposed → active (applied to behavior) → retired (superseded/stale).
-- evidence: the counts that justify it, for transparency + decay.
create table if not exists public.learning_insights (
  id            uuid primary key default gen_random_uuid(),
  workspace_id  uuid references public.workspaces(id) on delete cascade,
  domain        text not null check (domain in ('agent','daemon','brain','codebase')),
  scope         jsonb not null default '{}'::jsonb,
  insight       text not null,
  kind          text,                                          -- variant_weight|query_rank|style|health…
  confidence    numeric not null default 0.5,                  -- 0..1
  evidence      jsonb not null default '{}'::jsonb,
  status        text not null default 'active'
                check (status in ('proposed','active','retired')),
  applied_at    timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index if not exists learning_insights_lookup
  on public.learning_insights (workspace_id, domain, status, updated_at desc);

-- ── Brain confidence: additive column so the brain can score its own knowledge ─
alter table public.hunt_findings   add column if not exists confidence numeric;
alter table public.hunt_findings   add column if not exists audited_at timestamptz;

-- ── Agent attribution: which variant drafted a message, which query found a target
alter table public.outreach_messages add column if not exists variant_id text;
alter table public.outreach_targets  add column if not exists source_query text;

-- ── RLS: workspace members read; writes go through the service-role engine ────
alter table public.learning_signals  enable row level security;
alter table public.learning_insights enable row level security;

create policy "learning_signals_member_select" on public.learning_signals
  for select using (workspace_id in (
    select workspace_id from public.workspace_members where user_id = auth.uid()));
create policy "learning_insights_member_select" on public.learning_insights
  for select using (workspace_id in (
    select workspace_id from public.workspace_members where user_id = auth.uid()));
