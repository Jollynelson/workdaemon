-- WorkDaemon Brain — Postgres Schema
-- Handles: knowledge graph, behaviour graph, query cache, corrections

-- ── Companies ───────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS companies (
  id            TEXT PRIMARY KEY,           -- slug e.g. "acme-corp"
  name          TEXT NOT NULL,
  plan_tier     TEXT DEFAULT 'free',        -- free | pro | enterprise
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  last_ingested TIMESTAMPTZ,
  meta          JSONB DEFAULT '{}'
);

-- ── Employees ───────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS employees (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id     TEXT REFERENCES companies(id) ON DELETE CASCADE,
  name           TEXT NOT NULL,
  email          TEXT NOT NULL,
  role           TEXT,
  daemon_level   INTEGER DEFAULT 1,         -- 1 | 2 | 3
  channel_pref   TEXT DEFAULT 'slack',      -- slack | teams | email | whatsapp
  created_at     TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(company_id, email)
);

-- ── Ingested Documents (metadata only — vectors in Qdrant) ──────────────────
CREATE TABLE IF NOT EXISTS documents (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id    TEXT REFERENCES companies(id) ON DELETE CASCADE,
  source        TEXT NOT NULL,              -- gdrive | notion | slack | gmail
  source_id     TEXT NOT NULL,             -- external ID from the tool
  title         TEXT,
  url           TEXT,
  author_email  TEXT,
  chunk_count   INTEGER DEFAULT 0,
  ingested_at   TIMESTAMPTZ DEFAULT NOW(),
  updated_at    TIMESTAMPTZ DEFAULT NOW(),
  meta          JSONB DEFAULT '{}',
  UNIQUE(company_id, source, source_id)
);

-- ── Knowledge Graph (entities and relationships) ────────────────────────────
CREATE TABLE IF NOT EXISTS kg_entities (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id  TEXT REFERENCES companies(id) ON DELETE CASCADE,
  type        TEXT NOT NULL,               -- person | project | decision | task | team
  name        TEXT NOT NULL,
  properties  JSONB DEFAULT '{}',
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  updated_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS kg_relations (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id   TEXT REFERENCES companies(id) ON DELETE CASCADE,
  from_id      UUID REFERENCES kg_entities(id) ON DELETE CASCADE,
  to_id        UUID REFERENCES kg_entities(id) ON DELETE CASCADE,
  relation     TEXT NOT NULL,              -- owns | works_on | decided | assigned_to | blocked_by
  weight       FLOAT DEFAULT 1.0,
  properties   JSONB DEFAULT '{}',
  created_at   TIMESTAMPTZ DEFAULT NOW()
);

-- ── Behaviour Graph (learned patterns from Daemon actions) ──────────────────
CREATE TABLE IF NOT EXISTS behaviour_events (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id    TEXT REFERENCES companies(id) ON DELETE CASCADE,
  actor_email   TEXT NOT NULL,
  action        TEXT NOT NULL,             -- assigned_task | sent_message | completed | escalated
  target_email  TEXT,
  context       JSONB DEFAULT '{}',
  occurred_at   TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS behaviour_patterns (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id    TEXT REFERENCES companies(id) ON DELETE CASCADE,
  pattern_type  TEXT NOT NULL,             -- delegation | capacity | communication | timing
  description   TEXT NOT NULL,            -- human-readable learned pattern
  confidence    FLOAT DEFAULT 0.5,
  evidence_count INTEGER DEFAULT 1,
  last_seen     TIMESTAMPTZ DEFAULT NOW(),
  properties    JSONB DEFAULT '{}'
);

-- ── Correction Memory (Brain learns from mistakes) ──────────────────────────
CREATE TABLE IF NOT EXISTS corrections (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id     TEXT REFERENCES companies(id) ON DELETE CASCADE,
  original_query TEXT NOT NULL,
  wrong_answer   TEXT,
  correct_answer TEXT NOT NULL,
  corrected_by   TEXT NOT NULL,            -- employee email
  applied        BOOLEAN DEFAULT FALSE,    -- has this been re-embedded
  created_at     TIMESTAMPTZ DEFAULT NOW()
);

-- ── Query Cache (reduce model calls) ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS query_cache (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id    TEXT REFERENCES companies(id) ON DELETE CASCADE,
  query_hash    TEXT NOT NULL,
  query_text    TEXT NOT NULL,
  answer        TEXT NOT NULL,
  model_used    TEXT NOT NULL,
  tokens_used   INTEGER DEFAULT 0,
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  expires_at    TIMESTAMPTZ NOT NULL,
  hit_count     INTEGER DEFAULT 0,
  UNIQUE(company_id, query_hash)
);

-- ── Ingestion Cursors (track what's been synced per tool) ───────────────────
CREATE TABLE IF NOT EXISTS ingestion_cursors (
  company_id    TEXT REFERENCES companies(id) ON DELETE CASCADE,
  source        TEXT NOT NULL,
  cursor_value  TEXT,                      -- last synced timestamp or page token
  last_run      TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (company_id, source)
);

-- ── Indexes ─────────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_documents_company ON documents(company_id, source);
CREATE INDEX IF NOT EXISTS idx_kg_entities_company ON kg_entities(company_id, type);
CREATE INDEX IF NOT EXISTS idx_kg_relations_from ON kg_relations(company_id, from_id);
CREATE INDEX IF NOT EXISTS idx_behaviour_events_company ON behaviour_events(company_id, actor_email);
CREATE INDEX IF NOT EXISTS idx_behaviour_patterns_company ON behaviour_patterns(company_id, pattern_type);
CREATE INDEX IF NOT EXISTS idx_query_cache_company ON query_cache(company_id, query_hash);
CREATE INDEX IF NOT EXISTS idx_corrections_company ON corrections(company_id, applied);
