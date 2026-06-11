-- 038_company_prefetch.sql — eager onboarding seeding. The moment a user types a
-- work email, we derive the domain and research the company (website + socials +
-- web) BEFORE the workspace exists, stashing the result keyed by the user. When
-- they finish onboarding, setup merges this into the new workspace's Brain context
-- — so company-name + location become confirmation of data we already have.
create table if not exists public.company_prefetch (
  user_id    uuid primary key,
  domain     text,
  company    text,
  status     text not null default 'pending',  -- pending | ready | error
  intel      jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
