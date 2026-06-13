import { describe, it, expect } from 'vitest';
import { keywords, searchFiles, markFilesReferenced } from '../file_search.js';

// Chainable, awaitable fake; `rows` = the workspace_documents returned; captures updates.
function fakeDb(rows = [], captured = { updates: [] }) {
  const b = {
    select: () => b, eq: () => b, in: () => b, or: () => b, order: () => b, limit: () => b,
    update: (vals) => { captured.updates.push(vals); return b; },
    then: (res) => res({ data: rows, error: null }),
  };
  return { from: () => b, _captured: captured };
}

describe('keywords', () => {
  it('drops stopwords/short tokens', () => {
    expect(keywords('do you have a document about the Q3 forecast')).toEqual(['q3', 'forecast']);
  });
});

describe('searchFiles', () => {
  const rows = [
    { id: '1', title: 'Q3 Forecast Model', content: 'revenue projections', url: 'u1', source: 'gdrive', doc_type: 'file', metadata: { modifiedTime: '2026-05-01T00:00:00Z' }, updated_at: '2026-05-02' },
    { id: '2', title: 'Team offsite menu', content: 'lunch options', url: 'u2', source: 'gdrive', doc_type: 'file', metadata: {}, updated_at: '2026-06-01' },
    { id: '3', title: 'Forecast deck Q3', content: 'slides', url: 'u3', source: 'notion', doc_type: 'page', metadata: {}, updated_at: '2026-04-01' },
  ];
  it('ranks keyword hits and returns selectable options (name + date + link)', async () => {
    const out = await searchFiles(fakeDb(rows), 'ws', 'do you have a doc about the Q3 forecast', { limit: 5 });
    expect(out.length).toBe(2);                       // #1 and #3 match; #2 doesn't
    expect(out[0].title).toBe('Q3 Forecast Model');   // two keyword hits in title → top
    expect(out[0]).toMatchObject({ url: 'u1', source: 'gdrive', date: '2026-05-01T00:00:00Z' });
  });
  it('no keywords → falls back to most-recent', async () => {
    const out = await searchFiles(fakeDb(rows), 'ws', 'the files', { limit: 2 });
    expect(out.length).toBe(2);
  });
});

describe('markFilesReferenced (re-promotion)', () => {
  it('stamps metadata.referenced so the trainer re-learns it', async () => {
    const cap = { updates: [] };
    const db = fakeDb([], cap);
    const marked = await markFilesReferenced(db, 'ws', [{ id: '1', metadata: { mimeType: 'pdf' } }]);
    expect(marked).toBe(1);
    expect(cap.updates[0].metadata).toMatchObject({ mimeType: 'pdf', referenced: true });
    expect(cap.updates[0].metadata.last_referenced).toBeTruthy();
  });
});
