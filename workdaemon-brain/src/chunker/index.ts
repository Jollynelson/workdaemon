// WorkDaemon Brain — Semantic Chunker
// Splits documents into optimal chunks for embedding and retrieval
// Strategy: paragraph-based with heading awareness and overlap

import { v4 as uuid } from 'uuid';
import { config } from '../config.js';
import type { BrainChunk, RawDocument } from '../types.js';

export class Chunker {
  private chunk_size:    number;
  private chunk_overlap: number;

  constructor() {
    this.chunk_size    = config.brain.chunk_size;
    this.chunk_overlap = config.brain.chunk_overlap;
  }

  // ── Main entry — convert a raw document into chunks ready for embedding ──
  chunk(doc: RawDocument, company_id: string): BrainChunk[] {
    const segments = this.split_into_segments(doc.content);
    const chunks   = this.merge_segments(segments);

    return chunks.map((content, i) => ({
      id:          uuid(),
      company_id,
      source:      doc.source,
      source_id:   doc.source_id,
      title:       doc.title,
      content:     this.clean(content),
      author:      doc.author,
      url:         doc.url,
      chunk_index: i,
      created_at:  new Date().toISOString(),
      updated_at:  doc.updated_at,
      meta:        {
        ...doc.meta,
        total_chunks: chunks.length,
      },
    }));
  }

  // ── Split on natural boundaries: headings, paragraphs, list items ─────────
  private split_into_segments(text: string): string[] {
    // Normalise line endings
    const normalised = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');

    // Split on double newlines (paragraph breaks) and heading patterns
    const raw_segments = normalised.split(
      /\n{2,}|(?=#{1,6}\s)|(?<=\n)(?=[-*•]\s)/
    );

    return raw_segments
      .map(s => s.trim())
      .filter(s => s.length > 10); // skip empty/tiny segments
  }

  // ── Merge short segments, split long ones, add overlap between chunks ─────
  private merge_segments(segments: string[]): string[] {
    const chunks: string[] = [];
    let current = '';

    for (const segment of segments) {
      const segment_tokens  = this.estimate_tokens(segment);
      const current_tokens  = this.estimate_tokens(current);

      if (segment_tokens > this.chunk_size) {
        // Segment itself is too long — split it by sentence
        if (current.length > 0) {
          chunks.push(current.trim());
          current = '';
        }
        const sub_chunks = this.split_long_segment(segment);
        chunks.push(...sub_chunks);
        continue;
      }

      if (current_tokens + segment_tokens > this.chunk_size && current.length > 0) {
        // Current chunk is full — save it and start new with overlap
        chunks.push(current.trim());
        const overlap = this.get_overlap(current);
        current = overlap + '\n\n' + segment;
      } else {
        current = current.length > 0
          ? current + '\n\n' + segment
          : segment;
      }
    }

    if (current.trim().length > 0) {
      chunks.push(current.trim());
    }

    return chunks;
  }

  // ── Split a single long segment by sentences ──────────────────────────────
  private split_long_segment(text: string): string[] {
    const sentences = text.match(/[^.!?]+[.!?]+/g) ?? [text];
    const chunks: string[] = [];
    let current = '';

    for (const sentence of sentences) {
      const tokens = this.estimate_tokens(current + sentence);
      if (tokens > this.chunk_size && current.length > 0) {
        chunks.push(current.trim());
        const overlap = this.get_overlap(current);
        current = overlap + ' ' + sentence;
      } else {
        current += ' ' + sentence;
      }
    }

    if (current.trim().length > 0) chunks.push(current.trim());
    return chunks;
  }

  // ── Get last N tokens of a chunk to use as overlap for next chunk ─────────
  private get_overlap(text: string): string {
    const words = text.split(/\s+/);
    // Approximate: 1 token ≈ 0.75 words
    const overlap_words = Math.floor(this.chunk_overlap / 0.75);
    return words.slice(-overlap_words).join(' ');
  }

  // ── Rough token estimate: 1 token ≈ 4 characters ─────────────────────────
  private estimate_tokens(text: string): number {
    return Math.ceil(text.length / 4);
  }

  // ── Clean up whitespace and control characters ────────────────────────────
  private clean(text: string): string {
    return text
      .replace(/\s+/g, ' ')
      .replace(/[\x00-\x1F\x7F]/g, ' ') // remove control chars
      .trim();
  }
}
