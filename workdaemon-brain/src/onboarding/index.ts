// WorkDaemon Brain — Fast Onboarding Engine
// Runs on company signup — builds the company model in ~1 hour
// So every Daemon is already smart from day one

import { GoogleDriveConnector } from '../connectors/gdrive.js';
import { Embedder }             from '../embedder/ollama.js';
import { VectorStore }          from '../store/qdrant.js';
import { PostgresStore }        from '../store/postgres.js';
import { ModelRouter }          from '../models/router.js';
import { Chunker }              from '../chunker/index.js';
import { config }               from '../config.js';
import type { CompanyModel, RawDocument } from '../types.js';

export class OnboardingEngine {
  constructor(
    private gdrive:   GoogleDriveConnector,
    private embedder: Embedder,
    private vector:   VectorStore,
    private postgres: PostgresStore,
    private router:   ModelRouter,
    private chunker:  Chunker,
  ) {}

  // ── Main onboarding flow ─────────────────────────────────────────────────
  async run(): Promise<CompanyModel> {
    console.log(`\n🧠 WorkDaemon Brain — Onboarding: ${config.company.name}`);
    console.log('━'.repeat(60));

    // ── Phase 1: Deep scan all connected tools ────────────────────────────
    console.log('\n📂 Phase 1 — Deep scanning Google Drive...');
    const docs = await this.scan_all_tools();

    // ── Phase 2: Embed and store everything ──────────────────────────────
    console.log(`\n⚡ Phase 2 — Embedding ${docs.length} documents...`);
    await this.embed_and_store(docs);

    // ── Phase 3: Build the company model via Claude ───────────────────────
    console.log('\n🤖 Phase 3 — Building company intelligence model...');
    const model = await this.build_company_model(docs);

    // ── Phase 4: Save and finalise ────────────────────────────────────────
    await this.postgres.save_company_model(model);
    await this.postgres.update_last_ingested();
    await this.postgres.set_cursor('gdrive', new Date().toISOString());

    console.log('\n✅ Onboarding complete!');
    console.log(`   • ${docs.length} documents ingested`);
    console.log(`   • ${model.org_structure.length} people mapped`);
    console.log(`   • ${model.active_projects.length} active projects found`);
    console.log(`   • ${model.key_decisions.length} key decisions extracted`);
    console.log(`   • ${model.blockers.length} current blockers identified`);
    console.log(`   • ${model.glossary.length} company terms learned`);
    console.log('\n🚀 All Daemons are now context-aware and ready.\n');

    return model;
  }

  // ── Scan all connected tools ─────────────────────────────────────────────
  private async scan_all_tools(): Promise<RawDocument[]> {
    let all_docs: RawDocument[] = [];

    // Google Drive
    try {
      const gdrive_docs = await this.gdrive.full_scan((count, doc) => {
        process.stdout.write(`\r   Scanned ${count} files... (latest: ${doc.title.slice(0,40)})`);
      });
      all_docs = all_docs.concat(gdrive_docs);
      console.log(`\n   ✓ Google Drive: ${gdrive_docs.length} documents`);
    } catch (err) {
      console.warn(`\n   ⚠ Google Drive scan failed: ${err}`);
    }

    // Future connectors: Notion, Slack, Gmail added here
    return all_docs;
  }

  // ── Chunk, embed, and upsert all documents into Qdrant ──────────────────
  private async embed_and_store(docs: RawDocument[]): Promise<void> {
    let total_chunks = 0;

    for (const doc of docs) {
      // Chunk the document
      const chunks = this.chunker.chunk(doc, config.company.id);
      if (chunks.length === 0) continue;

      // Delete any existing chunks for this doc (clean re-ingest)
      await this.vector.delete_by_source_id(doc.source_id);

      // Embed all chunks
      const texts      = chunks.map(c => c.content);
      const embeddings = await this.embedder.embed_batch(texts, 32);

      // Store in Qdrant
      await this.vector.upsert(chunks, embeddings);

      // Register in Postgres
      await this.postgres.upsert_document({
        source:       doc.source,
        source_id:    doc.source_id,
        title:        doc.title,
        url:          doc.url,
        author_email: doc.author,
        chunk_count:  chunks.length,
        meta:         doc.meta,
      });

      total_chunks += chunks.length;
      process.stdout.write(
        `\r   Embedded ${total_chunks} chunks from ${docs.indexOf(doc) + 1}/${docs.length} docs...`
      );
    }

    console.log(`\n   ✓ Total chunks stored: ${total_chunks}`);
  }

  // ── Build structured company model using Claude ──────────────────────────
  private async build_company_model(docs: RawDocument[]): Promise<CompanyModel> {
    // Prepare a representative sample of company content for Claude
    // Focus on docs likely to contain org info, projects, decisions
    const priority_docs = this.prioritise_docs(docs);
    const raw_content = priority_docs
      .map(d => `=== ${d.title} ===\n${d.content.slice(0, 3000)}`)
      .join('\n\n');

    const instruction = `
Analyse this company's internal documents and extract the following.
Return ONLY a valid JSON object matching this exact schema — no prose, no markdown fences:

{
  "org_structure": [
    {
      "email": "string",
      "name": "string",
      "role": "string",
      "reports_to": "string or null",
      "teams": ["string"]
    }
  ],
  "active_projects": [
    {
      "name": "string",
      "status": "active|blocked|completed|planned",
      "owner": "string (email)",
      "team": ["email"],
      "summary": "string (1-2 sentences)"
    }
  ],
  "key_decisions": [
    {
      "decision": "string",
      "made_by": "string",
      "made_at": "string (ISO date or approximate)",
      "context": "string (why was this decided)",
      "impact": "string (what changed as a result)"
    }
  ],
  "blockers": [
    {
      "description": "string",
      "blocked_who": "string",
      "blocking_what": "string",
      "since": "string (approximate date)"
    }
  ],
  "glossary": [
    {
      "term": "string",
      "definition": "string (what it means in THIS company specifically)",
      "examples": ["string"]
    }
  ],
  "built_at": "${new Date().toISOString()}"
}

Focus on:
- Real people with email addresses (not generic roles)
- Projects that are clearly in progress right now
- Decisions made in the last 6 months
- Terms that have specific meaning in this company (not generic business terms)
- Blockers that appear unresolved

If you cannot find enough information for a field, return an empty array for that field.
Do NOT invent data — only extract what is clearly present in the documents.
`;

    try {
      const raw_json = await this.router.analyse_company(raw_content, instruction);
      const model    = JSON.parse(this.clean_json(raw_json)) as CompanyModel;
      return model;
    } catch (err) {
      console.warn(`[Onboarding] Company model parse failed: ${err}`);
      // Return empty model — brain still works via RAG, just without the structured layer
      return {
        org_structure:   [],
        active_projects: [],
        key_decisions:   [],
        blockers:        [],
        glossary:        [],
        built_at:        new Date().toISOString(),
      };
    }
  }

  // ── Prioritise docs most likely to contain org/project/decision info ─────
  private prioritise_docs(docs: RawDocument[]): RawDocument[] {
    const priority_keywords = [
      'team', 'project', 'roadmap', 'decision', 'meeting', 'org',
      'handbook', 'process', 'policy', 'strategy', 'okr', 'goal',
      'q1', 'q2', 'q3', 'q4', 'plan', 'overview', 'structure',
    ];

    const scored = docs.map(doc => {
      const text  = (doc.title + ' ' + doc.content.slice(0, 500)).toLowerCase();
      const score = priority_keywords.filter(kw => text.includes(kw)).length;
      return { doc, score };
    });

    return scored
      .sort((a, b) => b.score - a.score)
      .slice(0, 50) // top 50 most relevant docs for the model build
      .map(s => s.doc);
  }

  // ── Clean JSON response from Claude ─────────────────────────────────────
  private clean_json(text: string): string {
    return text
      .replace(/```json\n?/g, '')
      .replace(/```\n?/g, '')
      .trim();
  }
}
