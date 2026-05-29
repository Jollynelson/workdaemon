-- Add permission_level to profiles
-- 1 = Copilot (read-only), 2 = Assistant (confirm before act), 3 = Autonomous
alter table public.profiles
  add column if not exists permission_level smallint not null default 2;
