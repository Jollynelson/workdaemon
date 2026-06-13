import { describe, it, expect } from 'vitest';
import { deriveStaffStatus, observeStaffAndPropose } from '../staff_signals.js';

describe('deriveStaffStatus', () => {
  it('at_risk when overdue piles up', () => {
    expect(deriveStaffStatus({ openCount: 3, overdueCount: 2, doneCount: 1 }).status).toBe('at_risk');
    expect(deriveStaffStatus({ openCount: 1, overdueCount: 1, doneCount: 0 }).status).toBe('at_risk');
  });
  it('overloaded when too many open or self-flagged high load', () => {
    expect(deriveStaffStatus({ openCount: 5, overdueCount: 0, doneCount: 2 }).status).toBe('overloaded');
    expect(deriveStaffStatus({ openCount: 1, availability: 'high_load' }).status).toBe('overloaded');
  });
  it('away takes precedence (self-reported)', () => {
    expect(deriveStaffStatus({ openCount: 9, overdueCount: 9, availability: 'away' }).status).toBe('away');
  });
  it('quiet when nothing tracked, on_track for healthy load', () => {
    expect(deriveStaffStatus({ openCount: 0, overdueCount: 0, doneCount: 0 }).status).toBe('quiet');
    expect(deriveStaffStatus({ openCount: 2, overdueCount: 0, doneCount: 3 }).status).toBe('on_track');
  });
  it('reason is human-readable', () => {
    expect(deriveStaffStatus({ openCount: 3, overdueCount: 2, doneCount: 1 }).reason)
      .toBe('3 open, 2 overdue, 1 done');
  });
});

// Fake Supabase: chainable, awaitable, captures inserts. `tables` maps name→rows.
function fakeDb(tables, inserts = {}) {
  const make = (table) => {
    const b = {
      select: () => b, eq: () => b, in: () => b, contains: () => b, order: () => b, limit: () => b,
      single: async () => ({ data: (tables[table] || [])[0] || null }),
      maybeSingle: async () => ({ data: (tables[table] || [])[0] || null }),
      insert: async (row) => { (inserts[table] ||= []).push(row); return { data: row, error: null }; },
      then: (resolve) => resolve({ data: tables[table] || [], error: null }),
    };
    return b;
  };
  return { from: (t) => make(t), _inserts: inserts };
}

describe('observeStaffAndPropose (autonomy, approve-first)', () => {
  const WS = 'ws-1';

  it('drafts an inbox alert for an at-risk staffer (to the admin)', async () => {
    const inserts = {};
    const db = fakeDb({
      workspace_members: [{ user_id: 'u-staff', role: 'member' }, { user_id: 'u-admin', role: 'admin' }],
      profiles: [{ id: 'u-staff', name: 'Alice', title: 'Eng' }, { id: 'u-admin', name: 'Boss', role: 'admin' }],
      // Alice: 2 overdue (yesterday) → at_risk; admin: nothing.
      tasks: [
        { status: 'open', due_date: '2000-01-01', assignee_id: 'u-staff' },
        { status: 'open', due_date: '2000-01-02', assignee_id: 'u-staff' },
      ],
      app_agent_profiles: [],
      inbox_items: [],   // none existing → not deduped
    }, inserts);
    const r = await observeStaffAndPropose(db, WS);
    expect(r.proposed).toBeGreaterThanOrEqual(1);
    const items = inserts.inbox_items || [];
    expect(items.length).toBeGreaterThanOrEqual(1);
    expect(items[0]).toMatchObject({ type: 'alert', source: 'daemon' });
    expect(items[0].metadata).toMatchObject({ kind: 'staff_signal' });
    expect(items[0].user_id).toBe('u-admin');   // routed to the admin, not the subject
  });

  it('dedupes — no new alert when an unread staff_signal already exists', async () => {
    const inserts = {};
    const db = fakeDb({
      workspace_members: [{ user_id: 'u-staff', role: 'member' }, { user_id: 'u-admin', role: 'admin' }],
      profiles: [{ id: 'u-staff', name: 'Alice' }],
      tasks: [
        { status: 'open', due_date: '2000-01-01', assignee_id: 'u-staff' },
        { status: 'open', due_date: '2000-01-02', assignee_id: 'u-staff' },
      ],
      app_agent_profiles: [],
      inbox_items: [{ id: 'existing' }],   // an unread alert already exists → skip
    }, inserts);
    const r = await observeStaffAndPropose(db, WS);
    expect(r.proposed).toBe(0);
    expect((inserts.inbox_items || []).length).toBe(0);
  });

  it('no-op when nobody is flagged', async () => {
    const db = fakeDb({
      workspace_members: [{ user_id: 'u-ok', role: 'member' }],
      profiles: [{ id: 'u-ok', name: 'Zed' }],
      tasks: [{ status: 'done', assignee_id: 'u-ok' }],
      app_agent_profiles: [],
      inbox_items: [],
    });
    expect(await observeStaffAndPropose(db, WS)).toEqual({ flagged: 0, proposed: 0 });
  });
});
