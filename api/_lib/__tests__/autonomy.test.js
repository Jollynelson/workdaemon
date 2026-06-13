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
  it('daily_digest is the first safe auto-executing action', async () => {
    const { tierFor } = await import('../autonomy.js');
    expect(tierFor('daily_digest')).toBe('auto');
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

describe('observe.detectGoneQuiet (deals cold / threads quiet)', () => {
  const old = new Date(Date.now() - 30 * 86400000).toISOString();
  const fresh = new Date().toISOString();

  it('flags stale items WHEN the source is still active', async () => {
    const inserts = {};
    const db = fakeDb({
      workspace_documents: [
        { title: 'Acme renewal', doc_type: 'deal', updated_at: old },     // gone cold
        { title: 'Live deal', doc_type: 'deal', updated_at: fresh },      // keeps source active
      ],
      workspace_members: [{ user_id: 'admin', role: 'admin' }],
      inbox_items: [], learning_signals: [],
    }, inserts);
    const { detectGoneQuiet } = await import('../observe.js');
    const r = await detectGoneQuiet(db, 'ws', { docTypes: ['deal', 'opportunity'], kind: 'deal_cold', noun: 'deal' });
    expect(r.quiet).toBe(1);
    expect(r.proposed).toBe(1);
    expect(inserts.inbox_items[0].title).toMatch(/1 deal gone quiet/);
  });

  it('does NOT nag a dormant source (everything stale, nothing recent)', async () => {
    const inserts = {};
    const db = fakeDb({
      workspace_documents: [
        { title: 'Old thread A', doc_type: 'email_thread', updated_at: old },
        { title: 'Old thread B', doc_type: 'email_thread', updated_at: old },
      ],
      workspace_members: [{ user_id: 'admin', role: 'admin' }],
      inbox_items: [], learning_signals: [],
    }, inserts);
    const { detectGoneQuiet } = await import('../observe.js');
    const r = await detectGoneQuiet(db, 'ws', { docTypes: ['email_thread', 'channel'], kind: 'thread_quiet', noun: 'thread' });
    expect(r.quiet).toBe(0);
    expect((inserts.inbox_items || []).length).toBe(0);
  });
});

describe('observe.goalRisk', () => {
  const day = 86400000;
  it('flags overdue, due-soon-behind, and off-pace goals', async () => {
    const { goalRisk } = await import('../observe.js');
    const now = Date.now();
    expect(goalRisk({ progress: 40, due_at: new Date(now - 5 * day).toISOString(), horizon_days: 30 }, now).risk).toBe('overdue');
    expect(goalRisk({ progress: 20, due_at: new Date(now + 3 * day).toISOString(), horizon_days: 30 }, now).risk).toBe('at_risk');
    expect(goalRisk({ progress: 5, due_at: new Date(now + 20 * day).toISOString(), horizon_days: 30 }, now).risk).toBe('behind');
  });
  it('on_track when pace is fine; done at 100%', async () => {
    const { goalRisk } = await import('../observe.js');
    const now = Date.now();
    expect(goalRisk({ progress: 80, due_at: new Date(now + 20 * day).toISOString(), horizon_days: 30 }, now).risk).toBe('on_track');
    expect(goalRisk({ progress: 100 }, now).risk).toBe('done');
  });
});

describe('observe.detectGoalsAtRisk', () => {
  it('proposes a digest of off-track goals + records each', async () => {
    const inserts = {};
    const old = new Date(Date.now() - 10 * 86400000).toISOString();
    const db = fakeDb({
      brain_goals: [
        { id: 'g1', title: 'Hit 100 signups', progress: 10, due_at: old, horizon_days: 30, status: 'active' },
        { id: 'g2', title: 'Ship v2', progress: 100, due_at: old, horizon_days: 30, status: 'active' },
      ],
      workspace_members: [{ user_id: 'admin', role: 'admin' }],
      inbox_items: [], learning_signals: [],
    }, inserts);
    const { detectGoalsAtRisk } = await import('../observe.js');
    const r = await detectGoalsAtRisk(db, 'ws');
    expect(r.at_risk).toBe(1);   // g1 overdue; g2 done
    expect(inserts.inbox_items[0].title).toMatch(/1 goal trending to miss/);
    expect((inserts.learning_signals || []).length).toBe(2);   // both goals recorded
  });
});

describe('observe.postDailyDigest (auto-tier)', () => {
  it('auto-posts an internal digest (no approval) and dedupes', async () => {
    const inserts = {};
    const db = fakeDb({ workspace_members: [{ user_id: 'admin', role: 'admin' }], inbox_items: [] }, inserts);
    const { postDailyDigest } = await import('../observe.js');
    const r = await postDailyDigest(db, 'ws', ['What I noticed today:', '• 1 deadline slipping']);
    expect(r.posted).toBe(1);
    expect(inserts.inbox_items[0]).toMatchObject({ type: 'alert' });
    expect(inserts.inbox_items[0].metadata).toMatchObject({ kind: 'daily_digest', auto: true });
  });
});
