// WorkDaemon Brain — Postgres Store
// Knowledge graph, query cache, behaviour events, corrections

import pg from 'pg';
import { config } from '../config.js';
import type {
  BrainAnswer, BehaviourEvent, CompanyModel
} from '../types.js';
import crypto from 'crypto';

const { Pool } = pg;

export class PostgresStore {
  private pool: pg.Pool;

  constructor() {
    this.pool = new Pool({ connectionString: config.database.url });
  }

  async init(): Promise<void> {
    // Ensure company record exists
    await this.pool.query(
      `INSERT INTO companies (id, name) VALUES ($1, $2)
       ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name`,
      [config.company.id, config.company.name]
    );
    console.log(`[Postgres] Company record ready: ${config.company.id}`);
  }

  // ── Query Cache ──────────────────────────────────────────────────────────
  async cache_get(question: string): Promise<BrainAnswer | null> {
    const hash = this.hash_query(question);
    const result = await this.pool.query(
      `SELECT answer, model_used, tokens_used
       FROM query_cache
       WHERE company_id = $1
         AND query_hash = $2
         AND expires_at > NOW()`,
      [config.company.id, hash]
    );

    if (result.rows.length === 0) return null;

    // Increment hit count
    await this.pool.query(
      `UPDATE query_cache SET hit_count = hit_count + 1
       WHERE company_id = $1 AND query_hash = $2`,
      [config.company.id, hash]
    );

    const row = result.rows[0];
    return {
      answer:      row.answer,
      sources:     [],
      model_used:  row.model_used,
      tokens_used: row.tokens_used,
      cached:      true,
      latency_ms:  0,
    };
  }

  async cache_set(question: string, answer: BrainAnswer): Promise<void> {
    const hash = this.hash_query(question);
    const expires = new Date(Date.now() + config.brain.cache_ttl_seconds * 1000);

    await this.pool.query(
      `INSERT INTO query_cache
         (company_id, query_hash, query_text, answer, model_used, tokens_used, expires_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (company_id, query_hash)
       DO UPDATE SET
         answer = EXCLUDED.answer,
         model_used = EXCLUDED.model_used,
         tokens_used = EXCLUDED.tokens_used,
         expires_at = EXCLUDED.expires_at,
         hit_count = query_cache.hit_count + 1`,
      [
        config.company.id, hash, question,
        answer.answer, answer.model_used,
        answer.tokens_used, expires,
      ]
    );
  }

  // ── Ingestion Cursors ────────────────────────────────────────────────────
  async get_cursor(source: string): Promise<string | null> {
    const result = await this.pool.query(
      `SELECT cursor_value FROM ingestion_cursors
       WHERE company_id = $1 AND source = $2`,
      [config.company.id, source]
    );
    return result.rows[0]?.cursor_value ?? null;
  }

  async set_cursor(source: string, cursor: string): Promise<void> {
    await this.pool.query(
      `INSERT INTO ingestion_cursors (company_id, source, cursor_value, last_run)
       VALUES ($1, $2, $3, NOW())
       ON CONFLICT (company_id, source)
       DO UPDATE SET cursor_value = $3, last_run = NOW()`,
      [config.company.id, source, cursor]
    );
  }

  // ── Document Registry ────────────────────────────────────────────────────
  async upsert_document(doc: {
    source: string; source_id: string; title: string;
    url?: string; author_email?: string; chunk_count: number;
    meta?: Record<string, unknown>;
  }): Promise<void> {
    await this.pool.query(
      `INSERT INTO documents
         (company_id, source, source_id, title, url, author_email, chunk_count, meta)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       ON CONFLICT (company_id, source, source_id)
       DO UPDATE SET
         title = EXCLUDED.title,
         chunk_count = EXCLUDED.chunk_count,
         updated_at = NOW(),
         meta = EXCLUDED.meta`,
      [
        config.company.id, doc.source, doc.source_id,
        doc.title, doc.url ?? '', doc.author_email ?? '',
        doc.chunk_count, JSON.stringify(doc.meta ?? {}),
      ]
    );
  }

  // ── Behaviour Events ─────────────────────────────────────────────────────
  async log_behaviour(event: BehaviourEvent): Promise<void> {
    await this.pool.query(
      `INSERT INTO behaviour_events
         (company_id, actor_email, action, target_email, context)
       VALUES ($1, $2, $3, $4, $5)`,
      [
        event.company_id,
        event.actor_email,
        event.action,
        event.target_email ?? null,
        JSON.stringify(event.context),
      ]
    );
  }

  // ── Corrections ──────────────────────────────────────────────────────────
  async add_correction(correction: {
    query: string; wrong_answer?: string;
    correct_answer: string; corrected_by: string;
  }): Promise<void> {
    await this.pool.query(
      `INSERT INTO corrections
         (company_id, original_query, wrong_answer, correct_answer, corrected_by)
       VALUES ($1, $2, $3, $4, $5)`,
      [
        config.company.id,
        correction.query,
        correction.wrong_answer ?? null,
        correction.correct_answer,
        correction.corrected_by,
      ]
    );
    // Bust cache for this query
    const hash = this.hash_query(correction.query);
    await this.pool.query(
      `DELETE FROM query_cache WHERE company_id = $1 AND query_hash = $2`,
      [config.company.id, hash]
    );
  }

  // ── Company Model (onboarding output) ───────────────────────────────────
  async save_company_model(model: CompanyModel): Promise<void> {
    await this.pool.query(
      `INSERT INTO kg_entities (company_id, type, name, properties)
       VALUES ($1, 'company_model', $2, $3)
       ON CONFLICT DO NOTHING`,
      [config.company.id, 'company_model_v1', JSON.stringify(model)]
    );
  }

  async get_company_model(): Promise<CompanyModel | null> {
    const result = await this.pool.query(
      `SELECT properties FROM kg_entities
       WHERE company_id = $1 AND type = 'company_model'
       ORDER BY created_at DESC LIMIT 1`,
      [config.company.id]
    );
    return result.rows[0]?.properties ?? null;
  }

  async update_last_ingested(): Promise<void> {
    await this.pool.query(
      `UPDATE companies SET last_ingested = NOW() WHERE id = $1`,
      [config.company.id]
    );
  }

  async close(): Promise<void> {
    await this.pool.end();
  }

  private hash_query(question: string): string {
    return crypto
      .createHash('sha256')
      .update(question.toLowerCase().trim())
      .digest('hex')
      .slice(0, 32);
  }
}
