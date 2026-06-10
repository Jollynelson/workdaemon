-- Company knowledge graph (FINAL §3: "Neo4j or Postgres recursive — people,
-- decisions, projects, relationships"). Postgres approximation, additive.
-- Nodes (person/project/customer/competitor/risk/task) + typed edges
-- (owns/routed/addresses/affects/...). Rebuilt from the live structured data.
-- Run: node scripts/run_migration.mjs migration_knowledge_graph.sql

create table if not exists public.app_graph_nodes (
  id           uuid primary key default gen_random_uuid(),
  workspace_id uuid references public.workspaces(id) on delete cascade,
  node_key     text not null,            -- stable: 'person:<uid>', 'risk:<id>', 'project:<slug>'…
  node_type    text not null,            -- person|project|customer|competitor|risk|task|pattern
  label        text not null,
  meta         jsonb default '{}'::jsonb,
  updated_at   timestamptz not null default now(),
  unique (workspace_id, node_key)
);
create index if not exists app_graph_nodes_ws on public.app_graph_nodes (workspace_id, node_type);

create table if not exists public.app_graph_edges (
  id           uuid primary key default gen_random_uuid(),
  workspace_id uuid references public.workspaces(id) on delete cascade,
  src_key      text not null,
  dst_key      text not null,
  rel          text not null,            -- owns|routed|addresses|affects|involves|focuses_on
  meta         jsonb default '{}'::jsonb,
  updated_at   timestamptz not null default now(),
  unique (workspace_id, src_key, dst_key, rel)
);
create index if not exists app_graph_edges_ws on public.app_graph_edges (workspace_id);

alter table public.app_graph_nodes enable row level security;
alter table public.app_graph_edges enable row level security;
create policy "app_graph_nodes_member_select" on public.app_graph_nodes
  for select using (workspace_id in (select workspace_id from public.workspace_members where user_id = auth.uid()));
create policy "app_graph_edges_member_select" on public.app_graph_edges
  for select using (workspace_id in (select workspace_id from public.workspace_members where user_id = auth.uid()));
