-- Per-company tool/data-source connections (FINAL spec §12 + tools).
-- Tokens are encrypted at rest (Fernet) by the backend before insert; the DB
-- never sees plaintext. One row per (company, provider).

create table if not exists integrations (
  id            uuid primary key default gen_random_uuid(),
  company_id    uuid not null references companies(id) on delete cascade,
  provider      text not null,            -- notion | slack | gdrive | github | ...
  access_token  text,                     -- encrypted (Fernet); never plaintext
  metadata      jsonb default '{}',       -- workspace id, scopes, etc. (non-secret)
  status        text not null default 'connected',  -- connected | error | revoked
  last_ingested_at timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (company_id, provider)
);
create index if not exists integrations_company on integrations (company_id);

alter table integrations enable row level security;
alter table integrations force row level security;
