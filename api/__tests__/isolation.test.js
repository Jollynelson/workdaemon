// Tenant-isolation tests: drive REAL handlers (inbox, chat history, brain MCP)
// against an in-memory two-workspace fixture and assert that user/workspace A
// can never read or mutate B's rows. Isolation in this codebase is per-query
// (.eq('workspace_id'/'user_id') on a service-role client, RLS no-ops) — these
// tests are the regression net for that discipline.
import { describe, it, expect, vi, beforeEach, beforeAll } from 'vitest';

// ── In-memory supabase-js query-builder fake ─────────────────────────────────
function makeBuilder(store, table) {
  const state = { filters: [], action: 'select', payload: null, single: false };
  function run() {
    const rows = store[table] || [];
    const matches = rows.filter(r => state.filters.every(f => f(r)));
    if (state.action === 'update') {
      matches.forEach(r => Object.assign(r, state.payload));
      return { data: matches, error: null };
    }
    if (state.action === 'insert') {
      const arr = Array.isArray(state.payload) ? state.payload : [state.payload];
      (store[table] ||= []).push(...arr.map(r => ({ ...r })));
      return { data: arr, error: null };
    }
    const data = state.single ? (matches[0] ?? null) : matches;
    return { data, error: null };
  }
  const api = {
    select: () => api,
    update: (p) => { state.action = 'update'; state.payload = p; return api; },
    insert: (p) => { state.action = 'insert'; state.payload = p; return api; },
    upsert: (p) => { state.action = 'insert'; state.payload = p; return api; },
    eq:  (c, v) => { state.filters.push(r => r[c] === v); return api; },
    neq: (c, v) => { state.filters.push(r => r[c] !== v); return api; },
    gte: () => api, ilike: () => api, contains: () => api, in: () => api, or: () => api,
    order: () => api, limit: () => api, range: () => api,
    single: () => { state.single = true; return api; },
    maybeSingle: () => { state.single = true; return api; },
    then: (res, rej) => Promise.resolve(run()).then(res, rej),
  };
  return api;
}

const ctx = vi.hoisted(() => ({ store: {}, currentUser: null }));

vi.mock('../_lib/supabase.js', () => ({
  adminClient: () => ({
    from: (table) => makeBuilder(ctx.store, table),
    auth: { admin: {} },
  }),
  requireAuth: async (_req, res) => {
    if (!ctx.currentUser) { res.status(401).json({ error: 'Unauthorized' }); return null; }
    return ctx.currentUser;
  },
}));

function mockRes() {
  return {
    code: 200, body: null, headers: {},
    status(c) { this.code = c; return this; },
    json(b) { this.body = b; return this; },
    setHeader(k, v) { this.headers[k] = v; return this; },
    end() { return this; },
  };
}

const WS_A = 'ws-aaaa', WS_B = 'ws-bbbb';
const USER_A = { id: 'user-a' }, USER_B = { id: 'user-b' };

beforeAll(() => { process.env.SERVICE_TOKEN_SECRET = 'isolation-test-secret'; });

beforeEach(() => {
  ctx.currentUser = USER_A;
  ctx.store = {
    inbox_items: [
      { id: 'item-a1', user_id: USER_A.id, workspace_id: WS_A, source: 'daemon', title: 'A alert', body: 'a', read: false, metadata: {} },
      { id: 'item-b1', user_id: USER_B.id, workspace_id: WS_B, source: 'daemon', title: 'B SECRET alert', body: 'b', read: false, metadata: {} },
    ],
    daemon_messages: [
      { id: 'm-a1', user_id: USER_A.id, role: 'user', content: 'A private question', created_at: '2026-06-09T10:00:00Z' },
      { id: 'm-b1', user_id: USER_B.id, role: 'user', content: 'B PRIVATE question', created_at: '2026-06-09T11:00:00Z' },
    ],
    hunt_findings: [
      { workspace_id: WS_A, hunt_mode: 'knowledge', severity: 'warning', pattern: 'A-only finding', recommendation: 'x', resolved: false, created_at: '2026-06-09' },
      { workspace_id: WS_B, hunt_mode: 'threat', severity: 'critical', pattern: 'B-SECRET finding', recommendation: 'y', resolved: false, created_at: '2026-06-09' },
    ],
    workspaces: [
      { id: WS_A, name: 'Alpha Co', context: { secret: 'alpha' } },
      { id: WS_B, name: 'Beta Co', context: { secret: 'beta' } },
    ],
    profiles: [
      { id: USER_A.id, workspace_id: WS_A, name: 'Alice' },
      { id: USER_B.id, workspace_id: WS_B, name: 'Bob' },
    ],
  };
});

describe('inbox isolation (api/inbox.js)', () => {
  it('GET returns only the authed user’s items', async () => {
    const { default: handler } = await import('../inbox.js');
    const res = mockRes();
    await handler({ method: 'GET', headers: {}, query: {} }, res);
    expect(res.code).toBe(200);
    const ids = res.body.items.map(i => i.id);
    expect(ids).toContain('item-a1');
    expect(ids).not.toContain('item-b1');
    expect(JSON.stringify(res.body)).not.toContain('B SECRET');
  });

  it('POST cannot mark another user’s item read (scoped update is a no-op)', async () => {
    const { default: handler } = await import('../inbox.js');
    const res = mockRes();
    await handler({ method: 'POST', headers: {}, query: {}, body: { id: 'item-b1', read: true } }, res);
    const bItem = ctx.store.inbox_items.find(i => i.id === 'item-b1');
    expect(bItem.read).toBe(false); // untouched — update was scoped to user A
  });
});

describe('chat history isolation (api/chat.js GET)', () => {
  it('returns only the authed user’s messages', async () => {
    const { default: handler } = await import('../chat.js');
    const res = mockRes();
    await handler({ method: 'GET', headers: {}, query: {} }, res);
    expect(res.code).toBe(200);
    const contents = res.body.messages.map(m => m.content).join(' ');
    expect(contents).toContain('A private question');
    expect(contents).not.toContain('B PRIVATE');
  });
});

describe('brain MCP surface isolation (api/brain.js ?action=mcp)', () => {
  it('rejects a token signed with the wrong secret', async () => {
    const { default: handler } = await import('../brain.js');
    const { signServiceToken } = await import('../_lib/security.js');
    const real = process.env.SERVICE_TOKEN_SECRET;
    process.env.SERVICE_TOKEN_SECRET = 'attacker-secret';
    const forged = signServiceToken({ scope: 'brain_mcp', workspace_id: WS_B });
    process.env.SERVICE_TOKEN_SECRET = real;
    const res = mockRes();
    await handler({ method: 'GET', query: { action: 'mcp', tool: 'hunt' }, headers: { authorization: `Bearer ${forged}` } }, res);
    expect(res.code).toBe(401);
  });

  it('a workspace-A token sees only workspace-A findings and context', async () => {
    const { default: handler } = await import('../brain.js');
    const { signServiceToken } = await import('../_lib/security.js');
    const tokenA = signServiceToken({ scope: 'brain_mcp', workspace_id: WS_A });

    const res = mockRes();
    await handler({ method: 'GET', query: { action: 'mcp', tool: 'hunt' }, headers: { authorization: `Bearer ${tokenA}` } }, res);
    expect(res.code).toBe(200);
    const text = JSON.stringify(res.body);
    expect(text).toContain('A-only finding');
    expect(text).not.toContain('B-SECRET');

    const res2 = mockRes();
    await handler({ method: 'GET', query: { action: 'mcp', tool: 'context' }, headers: { authorization: `Bearer ${tokenA}` } }, res2);
    expect(res2.body.workspace).toBe('Alpha Co');
    expect(JSON.stringify(res2.body)).not.toContain('beta');
  });

  it('a token without the brain_mcp scope is rejected', async () => {
    const { default: handler } = await import('../brain.js');
    const { signServiceToken } = await import('../_lib/security.js');
    const wrongScope = signServiceToken({ scope: 'something_else', workspace_id: WS_A });
    const res = mockRes();
    await handler({ method: 'GET', query: { action: 'mcp', tool: 'hunt' }, headers: { authorization: `Bearer ${wrongScope}` } }, res);
    expect(res.code).toBe(401);
  });
});
