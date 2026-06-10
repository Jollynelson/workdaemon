-- Workspace location / primary market — feeds the proactive brain scanner.
-- Run in Supabase SQL Editor.

alter table public.workspaces
  add column if not exists location text;

comment on column public.workspaces.location is
  'Primary market / location (e.g. "Lagos, Nigeria"). Auto-detected from IP at '
  'signup, user-confirmable. Used to scope external-news scanning in the brain.';
