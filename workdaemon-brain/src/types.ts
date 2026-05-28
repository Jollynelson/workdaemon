// WorkDaemon Brain — Shared Types

// ── Document chunk stored in Qdrant ─────────────────────────────────────────
export interface BrainChunk {
  id:          string;           // UUID
  company_id:  string;
  source:      DataSource;
  source_id:   string;           // External ID from the tool
  title:       string;
  content:     string;           // The actual text content of this chunk
  author:      string;           // Email of the author/owner
  url?:        string;           // Link back to original
  chunk_index: number;           // Position in parent document
  created_at:  string;           // ISO8601
  updated_at:  string;           // ISO8601
  meta:        Record<string, unknown>;
}

// ── Supported data sources ───────────────────────────────────────────────────
export type DataSource = 'gdrive' | 'notion' | 'slack' | 'gmail' | 'github' | 'jira' | 'correction';

// ── Raw document from a connector ───────────────────────────────────────────
export interface RawDocument {
  source_id:  string;
  source:     DataSource;
  title:      string;
  content:    string;
  author:     string;
  url?:       string;
  updated_at: string;
  meta:       Record<string, unknown>;
}

// ── Brain query input ────────────────────────────────────────────────────────
export interface BrainQuery {
  company_id:   string;
  question:     string;
  asked_by?:    string;           // Employee email — for personalisation
  top_k?:       number;
  use_cache?:   boolean;
}

// ── Brain query result ───────────────────────────────────────────────────────
export interface BrainAnswer {
  answer:       string;
  sources:      SourceRef[];
  model_used:   'llama' | 'claude';
  tokens_used:  number;
  cached:       boolean;
  latency_ms:   number;
}

// ── Source reference returned with answers ───────────────────────────────────
export interface SourceRef {
  title:    string;
  url?:     string;
  source:   DataSource;
  excerpt:  string;             // Short snippet from the chunk
}

// ── Behaviour event logged to Postgres ──────────────────────────────────────
export interface BehaviourEvent {
  company_id:   string;
  actor_email:  string;
  action:       BehaviourAction;
  target_email?: string;
  context:      Record<string, unknown>;
}

export type BehaviourAction =
  | 'assigned_task'
  | 'completed_task'
  | 'sent_message'
  | 'escalated'
  | 'flagged_blocker'
  | 'queried_brain'
  | 'corrected_brain';

// ── Company model built during onboarding ───────────────────────────────────
export interface CompanyModel {
  org_structure:  OrgNode[];
  active_projects: ProjectSummary[];
  key_decisions:  DecisionEntry[];
  blockers:       BlockerEntry[];
  glossary:       GlossaryTerm[];
  built_at:       string;
}

export interface OrgNode {
  email:    string;
  name:     string;
  role:     string;
  reports_to?: string;
  teams:    string[];
}

export interface ProjectSummary {
  name:    string;
  status:  'active' | 'blocked' | 'completed' | 'planned';
  owner:   string;
  team:    string[];
  summary: string;
}

export interface DecisionEntry {
  decision:    string;
  made_by:     string;
  made_at:     string;
  context:     string;
  impact:      string;
}

export interface BlockerEntry {
  description: string;
  blocked_who: string;
  blocking_what: string;
  since:       string;
}

export interface GlossaryTerm {
  term:       string;
  definition: string;          // What it means in THIS company
  examples:   string[];
}

// ── Model router result ──────────────────────────────────────────────────────
export interface ModelResponse {
  text:        string;
  model:       'llama' | 'claude';
  tokens_used: number;
}
