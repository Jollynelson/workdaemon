-- Run this in Supabase SQL Editor
-- Adds unique slug column to workspaces for subdomain support

alter table public.workspaces
  add column if not exists slug text unique;
