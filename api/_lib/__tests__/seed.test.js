import { describe, it, expect } from 'vitest';
import { looksLikeCommitment } from '../connectors/slack.js';

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
