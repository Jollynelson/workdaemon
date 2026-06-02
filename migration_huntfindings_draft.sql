-- Auto-draft layer: store a ready-to-use asset (e.g. social post) the brain
-- drafts for a content-worthy finding, for the affected role to approve/send.
-- Run in Supabase SQL Editor.

alter table public.hunt_findings
  add column if not exists draft text;

comment on column public.hunt_findings.draft is
  'Optional ready-to-use draft (e.g. social post copy) the brain generated for a '
  'content-worthy finding. Surfaced to the affected role to approve, refine or send.';
