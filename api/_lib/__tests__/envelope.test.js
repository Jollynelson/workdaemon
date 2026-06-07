import { describe, it, expect } from 'vitest';
import { parseJsonResponse, repairJsonEnvelope } from '../envelope.js';

describe('parseJsonResponse — happy paths', () => {
  it('parses a clean envelope', () => {
    const r = parseJsonResponse('{"blocks":[{"type":"text","md":"hi"}],"suggestions":["a"]}');
    expect(r.blocks).toHaveLength(1);
    expect(r.suggestions).toEqual(['a']);
  });
  it('parses a ```json fenced envelope', () => {
    const r = parseJsonResponse('```json\n{"blocks":[{"type":"text","md":"x"}]}\n```');
    expect(r.blocks[0].md).toBe('x');
  });
  it('extracts the first balanced object from prose-wrapped output', () => {
    const r = parseJsonResponse('Sure! Here you go:\n{"blocks":[{"type":"text","md":"y"}]}\nHope that helps.');
    expect(r.blocks[0].md).toBe('y');
  });
  it('strips <thinking> before parsing', () => {
    const r = parseJsonResponse('<thinking>let me plan</thinking>{"blocks":[{"type":"text","md":"z"}]}');
    expect(r.blocks[0].md).toBe('z');
  });
});

describe('parseJsonResponse — recovery', () => {
  it('repairs a truncated envelope (dropped closing brackets)', () => {
    // a kanban that got cut off mid-structure
    const truncated = '{"blocks":[{"type":"kanban","columns":[{"title":"Todo","items":[{"id":"1","title":"ship"}]}';
    const r = parseJsonResponse(truncated);
    expect(r.blocks[0].type).toBe('kanban');
  });
  it('salvages valid blocks when one block is malformed', () => {
    const bug = '{"blocks":[{"type":"text","md":"valid one"},{"type":"suggestions":["bad"]}]}';
    const r = parseJsonResponse(bug);
    expect(r.blocks).toHaveLength(1);
    expect(r.blocks[0].md).toBe('valid one');
  });
  it('wraps non-JSON prose as a single text block (never throws)', () => {
    const r = parseJsonResponse('Just a plain sentence with no JSON.');
    expect(r.blocks).toHaveLength(1);
    expect(r.blocks[0].type).toBe('text');
    expect(r.blocks[0].md).toContain('plain sentence');
  });
  it('handles empty/falsy input', () => {
    expect(parseJsonResponse('').blocks[0].md).toBe('No response.');
    expect(parseJsonResponse(null).blocks[0].md).toBe('No response.');
  });
});

describe('repairJsonEnvelope', () => {
  it('returns null when there is no object', () => {
    expect(repairJsonEnvelope('no braces here')).toBeNull();
  });
  it('closes an unterminated object', () => {
    const r = repairJsonEnvelope('{"blocks":[{"type":"text","md":"hi"}]');
    expect(r).not.toBeNull();
    expect(r.blocks[0].md).toBe('hi');
  });
});
