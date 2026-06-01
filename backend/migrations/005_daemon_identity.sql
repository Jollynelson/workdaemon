-- Daemon character: per-staff name, what the daemon calls the user, and an
-- editable persona ("soul"). All nullable — a daemon with none set falls back to
-- a default personality and offers to be named on first session.

alter table agent_profiles add column if not exists daemon_name    text;
alter table agent_profiles add column if not exists preferred_name text;
alter table agent_profiles add column if not exists persona        text;
