-- Profile page fields (IA §7): per-user daemon display name, the context brief
-- the daemon reads every session, and notification preferences.
alter table public.profiles
  add column if not exists daemon_name   text,
  add column if not exists context_brief text,
  add column if not exists notif_prefs   jsonb not null default '{}'::jsonb;
