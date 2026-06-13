import { describe, it, expect, beforeEach } from 'vitest';
import crypto from 'node:crypto';

// Chainable supabase-ish mock: every builder method returns itself; maybeSingle
// resolves the given row.
const mockDb = (row) => ({
  from: () => new Proxy({}, { get: (_t, p) => (p === 'maybeSingle' ? async () => ({ data: row }) : () => mockDb(row).from()) }),
});

describe('company_model serving wire (Phase 1)', () => {
  beforeEach(() => { delete process.env.SELF_HOSTED_SERVE_URL; delete process.env.SERVE_MASTER_SECRET; });

  it('per-company token == HMAC-SHA256(master, company_id) hex (matches finetuning/auth.py)', async () => {
    process.env.SERVE_MASTER_SECRET = 'test-master';
    const { companyServeToken } = await import('../company_model.js');
    const expected = crypto.createHmac('sha256', 'test-master').update('ws-123').digest('hex');
    expect(companyServeToken('ws-123')).toBe(expected);
    expect(expected).toHaveLength(64);
  });

  it('is a hard no-op (null, never even queries) when self-hosted serving is unconfigured', async () => {
    const { resolveCompanyModel } = await import('../company_model.js');
    const db = { from() { throw new Error('must not query when SELF_HOSTED_SERVE_URL unset'); } };
    expect(await resolveCompanyModel(db, 'ws-123')).toBeNull();
  });

  it('returns null when the workspace has no deployed model', async () => {
    process.env.SELF_HOSTED_SERVE_URL = 'https://serve.example';
    process.env.SERVE_MASTER_SECRET = 'm';
    const { resolveCompanyModel } = await import('../company_model.js');
    expect(await resolveCompanyModel(mockDb(null), 'ws-123')).toBeNull();
  });

  it('returns a company_model config when a deployed model exists', async () => {
    process.env.SELF_HOSTED_SERVE_URL = 'https://serve.example/';
    process.env.SERVE_MASTER_SECRET = 'm';
    const { resolveCompanyModel } = await import('../company_model.js');
    const cfg = await resolveCompanyModel(mockDb({ version: 3, deployed: true }), 'ws-9');
    expect(cfg).toMatchObject({ provider: 'company_model', company_id: 'ws-9', endpoint: 'https://serve.example', version: 3 });
    expect(cfg.token).toHaveLength(64);
  });
});
