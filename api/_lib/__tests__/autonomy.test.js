import { describe, it, expect } from 'vitest';

// Chainable, awaitable fake Supabase that captures inserts per table.
function fakeDb(tables = {}, inserts = {}) {
  const make = (table) => {
    const b = {
      select: () => b, eq: () => b, neq: () => b, in: () => b, contains: () => b, order: () => b, limit: () => b,
      single: async () => ({ data: (tables[table] || [])[0] || null }),
      maybeSingle: async () => ({ data: (tables[table] || [])[0] || null }),
      insert: async (row) => { (inserts[table] ||= []).push(row); return { data: row, error: null }; },
      then: (resolve) => resolve({ data: tables[table] || [], error: null }),
    };
    return b;
  };
  return { from: (t) => make(t), _inserts: inserts };
}

describe('autonomy.tierFor', () => {
  it('defaults consequential/outward kinds to propose (approve-first)', async () => {
    const { tierFor } = await import('../autonomy.js');
    expect(tierFor('staff_signal')).toBe('propose');
    expect(tierFor('deadlines_slipping')).toBe('propose');
  });
});

describe('autonomy.proposeToInbox', () => {
  it('inserts an alert per recipient with kind+subject in metadata', async () => {
    const inserts = {};
    const db = fakeDb({ inbox_items: [] }, inserts);
    const { proposeToInbox } = await import('../autonomy.js');
    const n = await proposeToInbox(db, 'ws', ['admin1', 'admin2'], {
      kind: 'deadlines_slipping', subjectId: 'ws', title: 'T', body: 'B',
    });
    expect(n).toBe(2);
    expect((inserts.inbox_items || []).length).toBe(2);
    expect(inserts.inbox_items[0].metadata).toMatchObject({ kind: 'deadlines_slipping', subject_id: 'ws' });
  });

  it('dedupes against an existing unread alert', async () => {
    const inserts = {};
    const db = fakeDb({ inbox_items: [{ id: 'x' }] }, inserts);
    const { proposeToInbox } = await import('../autonomy.js');
    const n = await proposeToInbox(db, 'ws', ['admin1'], { kind: 'k', subjectId: 's', title: 'T', body: 'B' });
    expect(n).toBe(0);
    expect((inserts.inbox_items || []).length).toBe(0);
  });
});

describe('autonomy.adminRecipients', () => {
  it('prefers admins/owners, falls back to first member', async () => {
    const { adminRecipients } = await import('../autonomy.js');
    expect(await adminRecipients(fakeDb({ workspace_members: [
      { user_id: 'a', role: 'member' }, { user_id: 'b', role: 'admin' },
    ] }), 'ws')).toEqual(['b']);
    expect(await adminRecipients(fakeDb({ workspace_members: [{ user_id: 'a', role: 'member' }] }), 'ws')).toEqual(['a']);
  });
});

describe('observe.detectSlippingDeadlines', () => {
  it('records + proposes when deadlines have slipped', async () => {
    const inserts = {};
    const old = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
    const db = fakeDb({
      tasks: [
        { id: 't1', title: 'Ship invoice', status: 'open', due_date: old },
        { id: 't2', title: 'Reply to vendor', status: 'open', due_date: old },
      ],
      workspace_members: [{ user_id: 'admin', role: 'admin' }],
      inbox_items: [], learning_signals: [],
    }, inserts);
    const { detectSlippingDeadlines } = await import('../observe.js');
    const r = await detectSlippingDeadlines(db, 'ws');
    expect(r.slipped).toBe(2);
    expect(r.proposed).toBe(1);
    expect((inserts.learning_signals || []).length).toBe(1);     // AUTO: brain remembered it
    expect(inserts.inbox_items[0].title).toMatch(/2 deadlines slipping/);
  });

  it('records "clear" and proposes nothing when on time', async () => {
    const inserts = {};
    const future = new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10);
    const db = fakeDb({
      tasks: [{ id: 't1', title: 'Future', status: 'open', due_date: future }],
      workspace_members: [{ user_id: 'admin', role: 'admin' }],
      inbox_items: [], learning_signals: [],
    }, inserts);
    const { detectSlippingDeadlines } = await import('../observe.js');
    const r = await detectSlippingDeadlines(db, 'ws');
    expect(r.slipped).toBe(0);
    expect((inserts.inbox_items || []).length).toBe(0);
    expect((inserts.learning_signals || []).length).toBe(1);     // still recorded "clear"
  });
});
