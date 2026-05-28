// WorkDaemon Brain — Main Entry Point
// The Brain class wires all components together
// Exposes: query(), ingest(), onboard(), correct()

import { Embedder }              from './embedder/ollama.js';
import { VectorStore }           from './store/qdrant.js';
import { PostgresStore }         from './store/postgres.js';
import { ModelRouter }           from './models/router.js';
import { QueryEngine }           from './query/rag.js';
import { Chunker }               from './chunker/index.js';
import { GoogleDriveConnector }  from './connectors/gdrive.js';
import { OnboardingEngine }      from './onboarding/index.js';
import { config }                from './config.js';
import type { BrainQuery, BrainAnswer, CompanyModel } from './types.js';

export class WorkDaemonBrain {
  private embedder:   Embedder;
  private vector:     VectorStore;
  private postgres:   PostgresStore;
  private router:     ModelRouter;
  private query_eng:  QueryEngine;
  private chunker:    Chunker;
  private gdrive:     GoogleDriveConnector;
  private onboarding: OnboardingEngine;

  private poll_timer?: NodeJS.Timeout;
  private ready = false;

  constructor() {
    // Wire up all components
    this.embedder  = new Embedder();
    this.vector    = new VectorStore();
    this.postgres  = new PostgresStore();
    this.router    = new ModelRouter();
    this.chunker   = new Chunker();
    this.gdrive    = new GoogleDriveConnector();

    this.query_eng = new QueryEngine(
      this.embedder,
      this.vector,
      this.postgres,
      this.router,
    );

    this.onboarding = new OnboardingEngine(
      this.gdrive,
      this.embedder,
      this.vector,
      this.postgres,
      this.router,
      this.chunker,
    );
  }

  // ── Boot — initialise all stores and verify services ─────────────────────
  async boot(): Promise<void> {
    console.log('\n🧠 WorkDaemon Brain booting...');

    // Verify Ollama is running
    const ollama_ok = await this.embedder.health_check();
    if (!ollama_ok) {
      throw new Error(
        'Ollama not available. Run: docker-compose up -d && ollama pull nomic-embed-text'
      );
    }

    // Initialise stores
    await this.postgres.init();
    await this.vector.init();

    const chunk_count = await this.vector.count();
    console.log(`✓ Brain ready — ${chunk_count.toLocaleString()} chunks in knowledge base`);

    this.ready = true;
  }

  // ── Run first-time onboarding ─────────────────────────────────────────────
  async onboard(): Promise<CompanyModel> {
    this.ensure_ready();
    return this.onboarding.run();
  }

  // ── Answer a question from a Daemon or employee ───────────────────────────
  async query(input: BrainQuery): Promise<BrainAnswer> {
    this.ensure_ready();
    return this.query_eng.query(input);
  }

  // ── Delta sync — pull new content from all tools ──────────────────────────
  async sync(): Promise<void> {
    this.ensure_ready();
    console.log('[Brain] Running delta sync...');

    // Google Drive delta
    const gdrive_cursor = await this.postgres.get_cursor('gdrive');

    const { docs, next_cursor } = await this.gdrive.delta_sync(gdrive_cursor);

    for (const doc of docs) {
      const chunks     = this.chunker.chunk(doc, config.company.id);
      const texts      = chunks.map(c => c.content);
      const embeddings = await this.embedder.embed_batch(texts);

      await this.vector.delete_by_source_id(doc.source_id);
      await this.vector.upsert(chunks, embeddings);
      await this.postgres.upsert_document({
        source:       doc.source,
        source_id:    doc.source_id,
        title:        doc.title,
        url:          doc.url,
        author_email: doc.author,
        chunk_count:  chunks.length,
      });
    }

    await this.postgres.set_cursor('gdrive', next_cursor);
    await this.postgres.update_last_ingested();

    if (docs.length > 0) {
      console.log(`[Brain] Synced ${docs.length} updated documents`);
    }
  }

  // ── Start continuous ingestion loop ───────────────────────────────────────
  start_continuous_sync(): void {
    this.ensure_ready();
    console.log(
      `[Brain] Continuous sync started — every ${config.brain.poll_interval_ms / 60000} minutes`
    );

    const run = async () => {
      try {
        await this.sync();
      } catch (err) {
        console.error('[Brain] Sync error:', err);
      }
    };

    // Run immediately, then on interval
    run();
    this.poll_timer = setInterval(run, config.brain.poll_interval_ms);
  }

  // ── Accept a correction from an employee ──────────────────────────────────
  async correct(correction: {
    query:           string;
    wrong_answer?:   string;
    correct_answer:  string;
    corrected_by:    string;
  }): Promise<void> {
    this.ensure_ready();

    await this.postgres.add_correction(correction);

    // Add the correction itself as a high-priority chunk in the Brain
    const correction_doc = {
      source_id:  `correction-${Date.now()}`,
      source:     'correction' as const,
      title:      `Correction: ${correction.query.slice(0, 60)}`,
      content:    `Q: ${correction.query}\nCorrect answer: ${correction.correct_answer}`,
      author:     correction.corrected_by,
      updated_at: new Date().toISOString(),
      meta:       { type: 'correction', corrected_by: correction.corrected_by },
    };

    const chunks     = this.chunker.chunk(correction_doc, config.company.id);
    const embeddings = await this.embedder.embed_batch(chunks.map(c => c.content));
    await this.vector.upsert(chunks, embeddings);

    console.log(
      `[Brain] Correction recorded by ${correction.corrected_by}`
    );
  }

  // ── Get current company model ─────────────────────────────────────────────
  async get_company_model(): Promise<CompanyModel | null> {
    return this.postgres.get_company_model();
  }

  // ── Graceful shutdown ─────────────────────────────────────────────────────
  async shutdown(): Promise<void> {
    if (this.poll_timer) clearInterval(this.poll_timer);
    await this.postgres.close();
    console.log('[Brain] Shutdown complete');
  }

  private ensure_ready(): void {
    if (!this.ready) throw new Error('Brain not booted. Call brain.boot() first.');
  }
}

// ── Singleton export for use across WorkDaemon ───────────────────────────────
export const brain = new WorkDaemonBrain();
