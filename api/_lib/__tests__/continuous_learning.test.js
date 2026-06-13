import { describe, it, expect } from 'vitest';
import { learnForRole, pickRoleToLearn } from '../continuous_learning.js';

// Chainable, awaitable fake Supabase; captures inserts; `tables` keyed by name.
function fakeDb(tables = {}, inserts = {}) {
  const make = (table) => {
    const b = {
      select: () => b, eq: () => b, in: () => b, or: () => b, order: () => b, limit: () => b,
      gte: () => b, lt: () => b,
      single: async () => ({ data: (tables[table] || [])[0] || null }),
      maybeSingle: async () => ({ data: (tables[table] || [])[0] || null }),
      insert: async (row) => { (inserts[table] ||= []).push(row); return { data: row, error: null }; },
      then: (resolve) => resolve({ data: tables[table] || [], error: null }),
    };
    return b;
  };
  return { from: (t) => make(t) };
}

const RESEARCH = async () => [
  { title: 'Modern RevOps', description: 'Use signal-based outreach.', url: 'https://x.com/a' },
];
const DISTILL = async () => [
  { name: 'Signal-based outreach', trigger_description: 'When prospecting', body: 'Watch intent signals; reach out on trigger events.', tags: ['sales'], pillar: 'growth', source_idx: 0 },
];

describe('learnForRole', () => {
  it('distills research into a new brain_skill (tagged to the role) + records it', async () => {
    const inserts = {};
    const db = fakeDb({ brain_skills: [], learning_signals: [] }, inserts);
    const r = await learnForRole(db, 'ws', 'Sales Lead', { research: RESEARCH, distill: DISTILL });
    expect(r.learned).toBe(1);
    const skill = inserts.brain_skills[0];
    expect(skill).toMatchObject({ learned_from: 'self_taught', category: 'role_learning' });
    expect(skill.tags).toContain('role:Sales Lead');
    expect((inserts.learning_signals || []).length).toBe(1);   // AUTO: remembered it learned
  });

  it('AUTO-equips the role\'s daemons with the freshly self-taught skill', async () => {
    const inserts = {};
    const db = fakeDb({
      brain_skills: [],
      learning_signals: [],
      workspace_members: [{ user_id: 'u1' }, { user_id: 'u2' }],
      profiles: [{ id: 'u1', role: 'Sales Lead' }, { id: 'u2', role: 'Engineer' }],
      daemon_skills: [],   // none equipped yet
    }, inserts);
    const r = await learnForRole(db, 'ws', 'Sales Lead', { research: RESEARCH, distill: DISTILL });
    expect(r.learned).toBe(1);
    expect(r.equipped).toBe(1);   // only the Sales Lead (u1), not the Engineer
    expect(inserts.daemon_skills[0]).toMatchObject({ user_id: 'u1', assigned_by: 'brain' });
  });

  it('dedupes — skips a skill whose slug already exists', async () => {
    const inserts = {};
    const db = fakeDb({ brain_skills: [{ id: 'dupe' }], learning_signals: [] }, inserts);
    const r = await learnForRole(db, 'ws', 'Sales Lead', { research: RESEARCH, distill: DISTILL });
    expect(r.learned).toBe(0);
    expect((inserts.brain_skills || []).length).toBe(0);
  });

  it('no research → learns nothing but still records the attempt', async () => {
    const inserts = {};
    const db = fakeDb({ brain_skills: [], learning_signals: [] }, inserts);
    const r = await learnForRole(db, 'ws', 'Sales Lead', { research: async () => [], distill: DISTILL });
    expect(r.learned).toBe(0);
    expect((inserts.learning_signals || []).length).toBe(1);
  });
});

describe('pickRoleToLearn (round-robin + interval gate)', () => {
  const members = [{ user_id: 'u1' }, { user_id: 'u2' }];

  it('picks a never-taught role first', async () => {
    const db = fakeDb({
      workspace_members: members,
      profiles: [{ role: 'Engineer' }, { role: 'Designer' }],
      learning_signals: [{ subject_id: 'Engineer', created_at: new Date().toISOString() }],  // Engineer fresh
    });
    expect(await pickRoleToLearn(db, 'ws', { intervalDays: 5 })).toBe('Designer');   // never taught
  });

  it('returns null when every role was taught within the interval', async () => {
    const now = new Date().toISOString();
    const db = fakeDb({
      workspace_members: members,
      profiles: [{ role: 'Engineer' }, { role: 'Designer' }],
      learning_signals: [
        { subject_id: 'Engineer', created_at: now },
        { subject_id: 'Designer', created_at: now },
      ],
    });
    expect(await pickRoleToLearn(db, 'ws', { intervalDays: 5 })).toBeNull();
  });

  it('re-picks a role whose last lesson is older than the interval', async () => {
    const old = new Date(Date.now() - 30 * 86400000).toISOString();
    const db = fakeDb({
      workspace_members: [{ user_id: 'u1' }],
      profiles: [{ role: 'Engineer' }],
      learning_signals: [{ subject_id: 'Engineer', created_at: old }],
    });
    expect(await pickRoleToLearn(db, 'ws', { intervalDays: 5 })).toBe('Engineer');
  });
});
