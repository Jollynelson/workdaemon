// WorkDaemon Brain — Qdrant Vector Store
// Handles all vector storage and semantic search per company

import { QdrantClient } from '@qdrant/js-client-rest';
import { v4 as uuid } from 'uuid';
import { config } from '../config.js';
import type { BrainChunk } from '../types.js';

export class VectorStore {
  private client: QdrantClient;
  private collection: string;

  constructor() {
    this.client = new QdrantClient({
      url: config.qdrant.url,
      ...(config.qdrant.api_key ? { apiKey: config.qdrant.api_key } : {}),
    });
    this.collection = config.qdrant.collection;
  }

  // ── Initialise collection for this company ──────────────────────────────
  async init(): Promise<void> {
    const exists = await this.collection_exists();

    if (!exists) {
      console.log(`[VectorStore] Creating collection: ${this.collection}`);
      await this.client.createCollection(this.collection, {
        vectors: {
          size:     config.qdrant.vector_size,  // 768 for nomic-embed-text
          distance: 'Cosine',
        },
        optimizers_config: {
          indexing_threshold: 1000,
        },
      });

      // Create payload indexes for fast filtering
      await this.client.createPayloadIndex(this.collection, {
        field_name: 'company_id',
        field_schema: 'keyword',
      });
      await this.client.createPayloadIndex(this.collection, {
        field_name: 'source',
        field_schema: 'keyword',
      });
      await this.client.createPayloadIndex(this.collection, {
        field_name: 'source_id',
        field_schema: 'keyword',
      });

      console.log(`[VectorStore] Collection ready: ${this.collection}`);
    } else {
      console.log(`[VectorStore] Collection exists: ${this.collection}`);
    }
  }

  // ── Upsert chunks with their embeddings ─────────────────────────────────
  async upsert(chunks: BrainChunk[], embeddings: number[][]): Promise<void> {
    if (chunks.length !== embeddings.length) {
      throw new Error('Chunks and embeddings length mismatch');
    }

    const points = chunks.map((chunk, i) => ({
      id:      chunk.id,
      vector:  embeddings[i],
      payload: {
        company_id:  chunk.company_id,
        source:      chunk.source,
        source_id:   chunk.source_id,
        title:       chunk.title,
        content:     chunk.content,  // stored for retrieval
        author:      chunk.author,
        url:         chunk.url ?? '',
        chunk_index: chunk.chunk_index,
        created_at:  chunk.created_at,
        updated_at:  chunk.updated_at,
        ...chunk.meta,
      },
    }));

    // Upsert in batches of 100
    const batch_size = 100;
    for (let i = 0; i < points.length; i += batch_size) {
      const batch = points.slice(i, i + batch_size);
      await this.client.upsert(this.collection, {
        wait:   true,
        points: batch,
      });
    }

    console.log(`[VectorStore] Upserted ${chunks.length} chunks`);
  }

  // ── Semantic search — returns top-K most relevant chunks ─────────────────
  async search(
    query_vector: number[],
    top_k: number = config.brain.top_k_results,
    filter_source?: string,
  ): Promise<BrainChunk[]> {
    const filter = {
      must: [
        { key: 'company_id', match: { value: config.company.id } },
        ...(filter_source
          ? [{ key: 'source', match: { value: filter_source } }]
          : []),
      ],
    };

    const results = await this.client.search(this.collection, {
      vector:      query_vector,
      limit:       top_k,
      filter,
      score_threshold: config.brain.similarity_threshold,
      with_payload:    true,
    });

    return results.map(r => ({
      id:          r.id as string,
      company_id:  r.payload!.company_id as string,
      source:      r.payload!.source as any,
      source_id:   r.payload!.source_id as string,
      title:       r.payload!.title as string,
      content:     r.payload!.content as string,
      author:      r.payload!.author as string,
      url:         r.payload!.url as string | undefined,
      chunk_index: r.payload!.chunk_index as number,
      created_at:  r.payload!.created_at as string,
      updated_at:  r.payload!.updated_at as string,
      meta:        {},
    }));
  }

  // ── Delete all chunks for a specific document (before re-ingesting) ──────
  async delete_by_source_id(source_id: string): Promise<void> {
    await this.client.delete(this.collection, {
      wait:   true,
      filter: {
        must: [
          { key: 'company_id', match: { value: config.company.id } },
          { key: 'source_id',  match: { value: source_id } },
        ],
      },
    });
  }

  // ── Count chunks for this company ────────────────────────────────────────
  async count(): Promise<number> {
    const info = await this.client.count(this.collection, {
      filter: {
        must: [{ key: 'company_id', match: { value: config.company.id } }],
      },
      exact: false,
    });
    return info.count;
  }

  // ── Check if collection exists ────────────────────────────────────────────
  private async collection_exists(): Promise<boolean> {
    try {
      const collections = await this.client.getCollections();
      return collections.collections.some(c => c.name === this.collection);
    } catch {
      return false;
    }
  }
}
