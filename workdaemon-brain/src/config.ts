// WorkDaemon Brain — Configuration
// Loads and validates all environment variables in one place

import 'dotenv/config';

function require_env(key: string): string {
  const val = process.env[key];
  if (!val) throw new Error(`Missing required environment variable: ${key}`);
  return val;
}

function optional_env(key: string, fallback: string): string {
  return process.env[key] ?? fallback;
}

export const config = {
  // ── Company Identity ──────────────────────────────────────────────────────
  company: {
    id:   require_env('COMPANY_ID'),
    name: require_env('COMPANY_NAME'),
  },

  // ── Qdrant ────────────────────────────────────────────────────────────────
  qdrant: {
    url:     optional_env('QDRANT_URL', 'http://localhost:6333'),
    api_key: optional_env('QDRANT_API_KEY', ''),
    // Each company gets its own collection: workdaemon_{company_id}
    collection: `workdaemon_${process.env.COMPANY_ID ?? 'default'}`,
    vector_size: 768, // nomic-embed-text output dimension
  },

  // ── Ollama ────────────────────────────────────────────────────────────────
  ollama: {
    url:         optional_env('OLLAMA_URL', 'http://localhost:11434'),
    embed_model: optional_env('OLLAMA_EMBED_MODEL', 'nomic-embed-text'),
  },

  // ── Model Providers ───────────────────────────────────────────────────────
  models: {
    groq_api_key:      optional_env('GROQ_API_KEY', ''),
    anthropic_api_key: optional_env('ANTHROPIC_API_KEY', ''),
    // Simple queries → Llama 3.1 70B via Groq (free)
    llama_model:    'llama-3.1-70b-versatile',
    // Complex queries → Claude Sonnet (BYOK on paid tier)
    claude_model:   'claude-sonnet-4-20250514',
    // Queries longer than this go to Claude Sonnet
    complex_threshold: parseInt(optional_env('COMPLEX_QUERY_THRESHOLD', '150')),
  },

  // ── Google Drive ──────────────────────────────────────────────────────────
  gdrive: {
    client_email: optional_env('GDRIVE_CLIENT_EMAIL', ''),
    private_key:  optional_env('GDRIVE_PRIVATE_KEY', '').replace(/\\n/g, '\n'),
    drive_id:     optional_env('GDRIVE_DRIVE_ID', ''), // empty = My Drive
    // File types to ingest (MIME types)
    supported_types: [
      'application/vnd.google-apps.document',        // Google Docs
      'application/vnd.google-apps.spreadsheet',     // Google Sheets
      'application/vnd.google-apps.presentation',    // Google Slides
      'application/pdf',
      'text/plain',
      'text/markdown',
    ],
  },

  // ── Postgres ──────────────────────────────────────────────────────────────
  database: {
    url: optional_env('DATABASE_URL', 'postgresql://workdaemon:password@localhost:5432/workdaemon'),
  },

  // ── Brain Settings ────────────────────────────────────────────────────────
  brain: {
    chunk_size:           parseInt(optional_env('CHUNK_SIZE', '400')),
    chunk_overlap:        parseInt(optional_env('CHUNK_OVERLAP', '64')),
    top_k_results:        parseInt(optional_env('TOP_K_RESULTS', '8')),
    cache_ttl_seconds:    parseInt(optional_env('CACHE_TTL_SECONDS', '1800')),
    poll_interval_ms:     parseInt(optional_env('INGEST_POLL_INTERVAL_MS', '900000')),
    // Minimum similarity score for retrieved chunks (0–1)
    similarity_threshold: 0.72,
  },
} as const;

export type Config = typeof config;
