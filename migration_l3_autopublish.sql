-- Level 3 (Autonomous) publishing: when a workspace opts in and configures an
-- outbound webhook, the brain auto-publishes content drafts and reports back,
-- instead of waiting for human confirmation. Run in Supabase SQL Editor.

alter table public.workspaces
  add column if not exists auto_publish boolean not null default false;

alter table public.workspaces
  add column if not exists publish_webhook_url text;

-- Track which findings the brain has already auto-published (avoid re-posting).
alter table public.hunt_findings
  add column if not exists auto_published boolean not null default false;

comment on column public.workspaces.auto_publish is
  'Level 3 autonomous publishing: when true (and publish_webhook_url is set), the '
  'brain auto-posts content drafts via the webhook and reports, no human confirm.';
comment on column public.workspaces.publish_webhook_url is
  'Outbound webhook the brain POSTs auto-approved content to (Zapier/Make/Slack/n8n → socials).';
