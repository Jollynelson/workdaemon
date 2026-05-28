// WorkDaemon Brain — RAG Query Engine
// The full retrieval-augmented generation pipeline:
// question → embed → search Qdrant → route to model → cache → return answer

import { Embedder }     from '../embedder/ollama.js';
import { VectorStore }  from '../store/qdrant.js';
import { PostgresStore } from '../store/postgres.js';
import { ModelRouter }  from '../models/router.js';
import type { BrainQuery, BrainAnswer, SourceRef } from '../types.js';

export class QueryEngine {
  private embedder: Embedder;
  private vector:   VectorStore;
  private postgres: PostgresStore;
  private router:   ModelRouter;

  constructor(
    embedder: Embedder,
    vector:   VectorStore,
    postgres: PostgresStore,
    router:   ModelRouter,
  ) {
    this.embedder = embedder;
    this.vector   = vector;
    this.postgres = postgres;
    this.router   = router;
  }

  // ── Main query entry point ───────────────────────────────────────────────
  async query(input: BrainQuery): Promise<BrainAnswer> {
    const start = Date.now();

    // 1. Check cache first
    if (input.use_cache !== false) {
      const cached = await this.postgres.cache_get(input.question);
      if (cached) {
        console.log(`[Query] Cache hit: "${input.question.slice(0, 60)}..."`);
        return { ...cached, latency_ms: Date.now() - start };
      }
    }

    // 2. Embed the question
    const query_vector = await this.embedder.embed_query(input.question);

    // 3. Retrieve most relevant chunks from Qdrant
    const chunks = await this.vector.search(
      query_vector,
      input.top_k ?? 8,
    );

    if (chunks.length === 0) {
      return {
        answer:      `I couldn't find relevant information in ${process.env.COMPANY_NAME}'s knowledge base for that question.`,
        sources:     [],
        model_used:  'llama',
        tokens_used: 0,
        cached:      false,
        latency_ms:  Date.now() - start,
      };
    }

    // 4. Build context strings for the model
    const context_texts = chunks.map(c =>
      `[Source: ${c.title} | ${c.source} | ${c.author}]\n${c.content}`
    );

    // 5. Route to appropriate model (Llama or Claude)
    const model_response = await this.router.complete(
      input.question,
      context_texts,
    );

    // 6. Build source references
    const sources: SourceRef[] = chunks
      .slice(0, 3) // top 3 sources in response
      .map(c => ({
        title:   c.title,
        url:     c.url,
        source:  c.source,
        excerpt: c.content.slice(0, 200) + '...',
      }));

    const answer: BrainAnswer = {
      answer:      model_response.text,
      sources,
      model_used:  model_response.model,
      tokens_used: model_response.tokens_used,
      cached:      false,
      latency_ms:  Date.now() - start,
    };

    // 7. Cache the answer for future identical/similar queries
    await this.postgres.cache_set(input.question, answer);

    // 8. Log behaviour event
    if (input.asked_by) {
      await this.postgres.log_behaviour({
        company_id:  input.company_id,
        actor_email: input.asked_by,
        action:      'queried_brain',
        context: {
          question:    input.question,
          model_used:  answer.model_used,
          tokens_used: answer.tokens_used,
          chunks_used: chunks.length,
        },
      });
    }

    console.log(
      `[Query] Answered in ${answer.latency_ms}ms via ${answer.model_used} ` +
      `using ${chunks.length} chunks — ${answer.tokens_used} tokens`
    );

    return answer;
  }
}
