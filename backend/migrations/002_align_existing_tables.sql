-- Align pre-existing WorkDaemon tables (from the older app schema) with the
-- FINAL build spec. Idempotent: ADD COLUMN IF NOT EXISTS only — no data touched.
-- interactions/tasks/pushes were empty at apply time; companies keeps its rows.

-- ── interactions: add the Brain-visibility + cross-agent columns ──
alter table interactions add column if not exists mcp_servers_used     jsonb default '[]';
alter table interactions add column if not exists context_chunks       jsonb;
alter table interactions add column if not exists triggered_by_task_id uuid;
alter table interactions add column if not exists generated_task_ids   jsonb default '[]';
alter table interactions add column if not exists brain_pattern_flags  jsonb default '[]';

-- ── tasks: the old table was workspace-scoped; bring it to the cross-agent shape ──
alter table tasks add column if not exists company_id      uuid references companies(id) on delete cascade;
alter table tasks add column if not exists brief           text;
alter table tasks add column if not exists from_staff_id   uuid;
alter table tasks add column if not exists to_staff_id     uuid;
alter table tasks add column if not exists parent_task_id  uuid references tasks(id) on delete set null;
alter table tasks add column if not exists chain_position  int not null default 0;
alter table tasks add column if not exists due_at          timestamptz;
alter table tasks add column if not exists output          text;
alter table tasks add column if not exists output_artifacts jsonb default '[]';
alter table tasks add column if not exists next_agent_id   uuid;
alter table tasks add column if not exists routed_by_brain boolean not null default true;
alter table tasks add column if not exists brain_context   jsonb;

-- ── pushes: cross-agent + finding/pattern linkage ──
alter table pushes add column if not exists pattern_id     uuid references detected_patterns(id) on delete set null;
alter table pushes add column if not exists task_id        uuid references tasks(id) on delete set null;
alter table pushes add column if not exists kind           text not null default 'brain_insight';
alter table pushes add column if not exists draft_artifact text;
alter table pushes add column if not exists read_at        timestamptz;

-- helpful indexes for the new task columns
create index if not exists tasks_company_to_status on tasks (company_id, to_staff_id, status);
create index if not exists tasks_company_from_status on tasks (company_id, from_staff_id, status);

-- The old pushes.finding_id FK pointed at the legacy cb_hunt_findings table.
-- Repoint it at the FINAL-spec hunt_findings so pushes can reference hunt output.
do $$
declare ref text;
begin
  select ccu.table_name into ref
  from information_schema.table_constraints tc
  join information_schema.constraint_column_usage ccu on tc.constraint_name = ccu.constraint_name
  where tc.table_name = 'pushes' and tc.constraint_name = 'pushes_finding_id_fkey';
  if ref is not null and ref <> 'hunt_findings' then
    alter table pushes drop constraint pushes_finding_id_fkey;
    alter table pushes add constraint pushes_finding_id_fkey
      foreign key (finding_id) references hunt_findings(id) on delete set null;
  end if;
end $$;
