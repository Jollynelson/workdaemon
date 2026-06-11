import { describe, it, expect } from 'vitest';
import { createEnvelopeStream } from '../stream_envelope.js';

const ENVELOPE = JSON.stringify({
  blocks: [
    { type: 'text', md: 'Hello **Maya** — line1\nline2 with "quotes" and \\ backslash and unicode é' },
    { type: 'stat_grid', stats: [{ label: 'ARR', value: '2.1M', status: 'warn' }] },
    { type: 'kanban', columns: [{ title: 'Blocked', items: [{ id: 'BUG-1', title: 'Login {brace} ]bracket[' }] }] },
    { type: 'text', md: 'Second text block.' },
  ],
  suggestions: ['a', 'b', 'c'],
});

// Feed text in chunks of size n; collect events.
function run(text, n) {
  const deltas = [];
  const blocks = [];
  const s = createEnvelopeStream({ onDelta: d => deltas.push(d), onBlock: b => blocks.push(b) });
  for (let i = 0; i < text.length; i += n) s.feed(text.slice(i, i + n));
  s.end();
  return { deltas, blocks };
}

describe('createEnvelopeStream', () => {
  for (const n of [1, 3, 7, 50, 100000]) {
    it(`chunk size ${n}: deltas reconstruct md, blocks parse whole`, () => {
      const { deltas, blocks } = run(ENVELOPE, n);
      const expected = JSON.parse(ENVELOPE).blocks;
      expect(blocks).toEqual(expected);
      // Concatenated deltas = both text blocks' md, in order.
      expect(deltas.join('')).toBe(expected[0].md + expected[3].md);
    });
  }

  it('handles a ```json fence and leading prose', () => {
    const fenced = '```json\n' + ENVELOPE + '\n```';
    const { blocks } = run(fenced, 5);
    expect(blocks).toHaveLength(4);
  });

  it('streams md before type when md key comes first', () => {
    const env = '{"blocks":[{"md":"hi there","type":"text"}]}';
    const { deltas, blocks } = run(env, 2);
    expect(deltas.join('')).toBe('hi there');
    expect(blocks).toEqual([{ md: 'hi there', type: 'text' }]);
  });

  it('does not stream md of non-text blocks but still emits them', () => {
    const env = '{"blocks":[{"type":"alert","level":"info","content":"x","md":"should-not-delta"}]}';
    const { deltas, blocks } = run(env, 4);
    expect(deltas.join('')).toBe('');
    expect(blocks).toHaveLength(1);
  });

  it('survives truncation without throwing (no completed block, partial deltas ok)', () => {
    const cut = ENVELOPE.slice(0, Math.floor(ENVELOPE.length / 3));
    expect(() => run(cut, 3)).not.toThrow();
  });

  it('stops at the end of the blocks array (suggestions never emitted as blocks)', () => {
    const { blocks } = run(ENVELOPE, 9);
    expect(blocks.every(b => b.type)).toBe(true);
    expect(blocks).toHaveLength(4);
  });

  it('handles escaped backslash before quote inside md', () => {
    const env = JSON.stringify({ blocks: [{ type: 'text', md: 'path C:\\dir\\ "q" end' }] });
    const { deltas, blocks } = run(env, 1);
    expect(deltas.join('')).toBe('path C:\\dir\\ "q" end');
    expect(blocks[0].md).toBe('path C:\\dir\\ "q" end');
  });
});
