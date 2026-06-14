import { describe, it, expect, vi, beforeEach } from 'vitest';

// The detector reads Google Calendar via these two modules — mock them so the
// test is pure (no network), and drive the calendar fixture per case.
vi.mock('../oauth.js', () => ({ getFreshAccessToken: vi.fn() }));
vi.mock('../calendar.js', () => ({ googleRecentEvents: vi.fn() }));
// retrieveDocuments would otherwise hit the live embeddings endpoint — mock it so
// grounding is deterministic and the tests stay pure.
vi.mock('../ingestion.js', () => ({ retrieveDocuments: vi.fn() }));

import { getFreshAccessToken } from '../oauth.js';
import { googleRecentEvents } from '../calendar.js';
import { retrieveDocuments } from '../ingestion.js';
import { detectMissedSessions } from '../observe.js';

const hoursAgo = (h) => new Date(Date.now() - h * 3600e3).toISOString();

// Fake Supabase: chainable + awaitable, captures inserts, plus auth.admin.listUsers.
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
  return {
    from: (t) => make(t),
    auth: { admin: { listUsers: async () => ({ data: { users: tables.__authUsers || [] } }) } },
    _inserts: inserts,
  };
}

const WS = 'ws-1';
const baseTables = {
  workspace_members: [{ user_id: 'u-angela', role: 'member' }, { user_id: 'u-hr', role: 'admin' }],
  profiles: [{ id: 'u-hr', role: 'HR Manager' }, { id: 'u-angela', title: 'Ward A Nurse' }],
  __authUsers: [{ id: 'u-angela', email: 'angela@clearview.test' }, { id: 'u-hr', email: 'hr@clearview.test' }],
  inbox_items: [], // none existing → proposals are not deduped
};

const onboardingEvent = (attendees) => ({
  id: 'ev1', title: 'Onboarding — Angela Reed', start: hoursAgo(3), end: hoursAgo(2), attendees,
});

describe('detectMissedSessions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getFreshAccessToken.mockResolvedValue('tok');
    retrieveDocuments.mockResolvedValue({ visible: [{ title: 'Onboarding SOP' }], restricted: [] });
  });

  it('notifies BOTH HR and the staff member when a required attendee no-shows', async () => {
    googleRecentEvents.mockResolvedValue([onboardingEvent([
      { email: 'angela@clearview.test', displayName: 'Angela Reed', responseStatus: 'needsAction' },
      { email: 'hr@clearview.test', responseStatus: 'accepted', organizer: true, self: true },
    ])]);
    const inserts = {};
    const r = await detectMissedSessions(fakeDb(baseTables, inserts), WS);

    expect(r).toMatchObject({ checked: 1, missed: 1, proposed: 2 });
    const inbox = inserts.inbox_items || [];
    expect(inbox).toHaveLength(2);
    // HR gets the "who missed what" alert; the staffer gets a direct nudge.
    expect(inbox.find(i => i.user_id === 'u-hr')?.metadata.kind).toBe('missed_onboarding');
    expect(inbox.find(i => i.user_id === 'u-angela')?.metadata.kind).toBe('missed_onboarding_self');
    // …grounded in the company doc the brain found (rendered as a "# Source" chip).
    expect(inbox.every(i => i.metadata.source === 'Onboarding SOP')).toBe(true);
    // …and the staffer also gets a chat ping so it can't be missed.
    expect((inserts.daemon_outbox || []).length).toBe(1);
  });

  it('does nothing when the attendee accepted (showed/intended)', async () => {
    googleRecentEvents.mockResolvedValue([onboardingEvent([
      { email: 'angela@clearview.test', responseStatus: 'accepted' },
    ])]);
    const inserts = {};
    const r = await detectMissedSessions(fakeDb(baseTables, inserts), WS);
    expect(r).toMatchObject({ missed: 0, proposed: 0 });
    expect(inserts.inbox_items).toBeUndefined();
  });

  it('ignores non-onboarding events', async () => {
    googleRecentEvents.mockResolvedValue([{
      id: 'ev2', title: 'Weekly team standup', start: hoursAgo(3), end: hoursAgo(2),
      attendees: [{ email: 'angela@clearview.test', responseStatus: 'needsAction' }],
    }]);
    const r = await detectMissedSessions(fakeDb(baseTables, {}), WS);
    expect(r).toMatchObject({ missed: 0 });
  });

  it('an unresolvable external attendee notifies HR only (no self/chat push)', async () => {
    googleRecentEvents.mockResolvedValue([onboardingEvent([
      { email: 'contractor@external.test', displayName: 'A Contractor', responseStatus: 'declined' },
    ])]);
    const inserts = {};
    const r = await detectMissedSessions(fakeDb(baseTables, inserts), WS);
    expect(r).toMatchObject({ missed: 1, proposed: 1 });
    const inbox = inserts.inbox_items || [];
    expect(inbox).toHaveLength(1);
    expect(inbox[0].metadata.kind).toBe('missed_onboarding');
    expect(inserts.daemon_outbox).toBeUndefined();
  });

  it('is a silent no-op without a Google token', async () => {
    getFreshAccessToken.mockResolvedValue(null);
    const r = await detectMissedSessions(fakeDb(baseTables, {}), WS);
    expect(r).toMatchObject({ checked: 0, missed: 0, proposed: 0 });
    expect(googleRecentEvents).not.toHaveBeenCalled();
  });
});
