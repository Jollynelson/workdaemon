import { describe, it, expect } from 'vitest';
import { salvageEnvelope, isLeakedEnvelope, recoverEnvelope } from '../scrub.js';

// The exact malformed payload from the production render bug: valid text blocks +
// a malformed "suggestions" block ({"type":"suggestions":[...]} is invalid JSON).
const BUG = '{"blocks":[{"type":"text","md":"My apologies, Nelson."},{"type":"text","md":"Within Nigeria, Lagos is a pioneer."},{"type":"suggestions":["Monitor updates.","Connect with experts."]}]}';
const CLEAN = '{"blocks":[{"type":"text","md":"hi"}],"suggestions":["a","b"]}';

describe('isLeakedEnvelope', () => {
  it('detects a valid leaked envelope', () => {
    expect(isLeakedEnvelope(CLEAN)).toBe(true);
  });
  it('detects a malformed-but-envelope payload', () => {
    expect(isLeakedEnvelope(BUG)).toBe(true);
  });
  it('detects fenced JSON envelopes', () => {
    expect(isLeakedEnvelope('```json\n' + CLEAN + '\n```')).toBe(true);
  });
  it('ignores plain prose', () => {
    expect(isLeakedEnvelope('Welcome back, Maya. Here is your briefing.')).toBe(false);
  });
  it('ignores prose that merely mentions blocks', () => {
    expect(isLeakedEnvelope('I arranged the kanban into three blocks for you.')).toBe(false);
  });
  it('ignores empty / non-JSON', () => {
    expect(isLeakedEnvelope('')).toBe(false);
    expect(isLeakedEnvelope(null)).toBe(false);
    expect(isLeakedEnvelope('not json {oops')).toBe(false);
  });
});

describe('salvageEnvelope', () => {
  it('recovers the valid blocks from a malformed envelope, dropping the bad one', () => {
    const r = salvageEnvelope(BUG);
    expect(r).not.toBeNull();
    expect(r.blocks).toHaveLength(2);
    expect(r.blocks.every(b => b.type === 'text')).toBe(true);
    expect(r.blocks[0].md).toContain('My apologies');
  });
  it('returns null when there is nothing salvageable', () => {
    expect(salvageEnvelope('total garbage, no blocks here')).toBeNull();
  });
});

describe('recoverEnvelope', () => {
  it('parses a clean envelope directly', () => {
    const r = recoverEnvelope(CLEAN);
    expect(r.blocks).toHaveLength(1);
    expect(r.suggestions).toEqual(['a', 'b']);
  });
  it('falls back to salvage on a malformed envelope', () => {
    const r = recoverEnvelope(BUG);
    expect(r.blocks).toHaveLength(2); // bad suggestions block dropped
  });
  it('strips a json code fence before parsing', () => {
    const r = recoverEnvelope('```json\n' + CLEAN + '\n```');
    expect(r.blocks).toHaveLength(1);
  });
});
