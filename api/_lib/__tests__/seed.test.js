import { describe, it, expect } from 'vitest';
import { looksLikeCommitment, chunkLines } from '../connectors/slack.js';

// The daemon catch-up logs DM lines that look like commitments into the user's
// PRIVATE memory. This heuristic gates that — over-matching floods memory, under-
// matching misses real deadlines. Lock the behavior at the edges.
describe('looksLikeCommitment (daemon catch-up gate)', () => {
  it('flags real asks / deadlines', () => {
    for (const line of [
      'Can you send the deck by Friday?',
      'deadline is tomorrow EOD',
      'Need the report by 5pm',
      'could you review the PR',
      'please confirm the numbers',
      'get back to me by next week',
      'due date is Wednesday',
      'I need this signed off by Mar 3',
    ]) expect(looksLikeCommitment(line), line).toBe(true);
  });

  it('ignores ordinary chatter', () => {
    for (const line of [
      'lol nice',
      'thanks so much!',
      'see you at standup',
      'the build is green',
      'good morning team',
      '👍',
    ]) expect(looksLikeCommitment(line), line).toBe(false);
  });

  it('ignores non-strings and giant blobs', () => {
    expect(looksLikeCommitment(null)).toBe(false);
    expect(looksLikeCommitment(undefined)).toBe(false);
    expect(looksLikeCommitment('can you ' + 'x'.repeat(500))).toBe(false); // > 400 chars
  });
});

// Deep history is stored as multiple ≤maxChars chunks per channel. chunkLines must
// split without exceeding the cap and without dropping any line.
describe('chunkLines (deep-history chunking)', () => {
  it('keeps small input in a single chunk', () => {
    expect(chunkLines(['a', 'b', 'c'], 5500)).toEqual(['a\nb\nc']);
  });

  it('splits past the cap, each chunk within the limit', () => {
    const lines = Array.from({ length: 100 }, (_, i) => `U${i}: ` + 'x'.repeat(80)); // ~85 chars each
    const chunks = chunkLines(lines, 500);
    expect(chunks.length).toBeGreaterThan(1);
    for (const c of chunks) expect(c.length).toBeLessThanOrEqual(500);
  });

  it('never drops a line (all content preserved across chunks)', () => {
    const lines = Array.from({ length: 60 }, (_, i) => `line-${i}`);
    const chunks = chunkLines(lines, 40);
    const rejoined = chunks.join('\n').split('\n');
    expect(rejoined).toEqual(lines);
  });

  it('returns [""] for empty input', () => {
    expect(chunkLines([], 5500)).toEqual(['']);
  });
});
