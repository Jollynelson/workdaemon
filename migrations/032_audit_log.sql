-- Audit log for My Daemon (personal chat) tool executions (IA §6.4). Autonomous
-- daemon work already lives in daemon_actions; this captures the per-user actions
-- run from the chat (staged_action / action_confirm approvals) so the admin Audit
-- Log shows the full picture: who did what, on which tool, with what result.
create table if not exists public.audit_log (
  id           uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  user_id      uuid references auth.users(id) on delete set null,
  source       text not null default 'daemon',  -- 'daemon' = My Daemon chat action
  action       text not null,                    -- human label, e.g. "Post to Slack"
  exec_name    text,                             -- executor id, e.g. slack.post
  tool         text,                             -- provider, e.g. slack / google
  result       text not null default 'success',  -- 'success' | 'failed'
  latency_ms   integer,
  detail       text,
  created_at   timestamptz not null default now()
);
create index if not exists audit_log_ws on public.audit_log (workspace_id, created_at desc);
alter table public.audit_log enable row level security;
