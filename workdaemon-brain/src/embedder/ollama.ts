// WorkDaemon Brain — Embedder
// Converts text into vectors using nomic-embed-text via Ollama
// Zero cost — fully self-hosted

import { Ollama } from 'ollama';
import { config } from '../config.js';

export class Embedder {
  private ollama: Ollama;
  private model:  string;

  constructor() {
    this.ollama = new Ollama({ host: config.ollama.url });
    this.model  = config.ollama.embed_model;
  }

  // ── Check Ollama is running and model is available ───────────────────────
  async health_check(): Promise<boolean> {
    try {
      const models = await this.ollama.list();
      const available = models.models.some(m =>
        m.name.startsWith(this.model.split(':')[0])
      );
      if (!available) {
        console.warn(
          `[Embedder] Model not found: ${this.model}\n` +
          `Run: ollama pull ${this.model}`
        );
      }
      return available;
    } catch (err) {
      console.error(`[Embedder] Ollama not reachable at ${config.ollama.url}`);
      return false;
    }
  }

  // ── Embed a single string ────────────────────────────────────────────────
  async embed(text: string): Promise<number[]> {
    const response = await this.ollama.embeddings({
      model:  this.model,
      prompt: text,
    });
    return response.embedding;
  }

  // ── Embed multiple strings in batches (efficient for ingestion) ──────────
  async embed_batch(
    texts: string[],
    batch_size: number = 32,
    on_progress?: (done: number, total: number) => void,
  ): Promise<number[][]> {
    const all_embeddings: number[][] = [];

    for (let i = 0; i < texts.length; i += batch_size) {
      const batch = texts.slice(i, i + batch_size);

      // Ollama processes these sequentially but we can parallelise
      const batch_embeddings = await Promise.all(
        batch.map(text => this.embed(text))
      );

      all_embeddings.push(...batch_embeddings);
      on_progress?.(Math.min(i + batch_size, texts.length), texts.length);
    }

    return all_embeddings;
  }

  // ── Embed a query (with prefix for retrieval quality) ────────────────────
  // nomic-embed-text uses task prefixes for better retrieval performance
  async embed_query(question: string): Promise<number[]> {
    return this.embed(`search_query: ${question}`);
  }

  // ── Embed a document chunk ────────────────────────────────────────────────
  async embed_document(text: string): Promise<number[]> {
    return this.embed(`search_document: ${text}`);
  }
}
