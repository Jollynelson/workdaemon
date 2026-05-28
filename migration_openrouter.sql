-- Run in Supabase SQL Editor
-- Adds OpenRouter config columns to workspaces

alter table public.workspaces
  add column if not exists openrouter_key   text,
  add column if not exists openrouter_model text;
