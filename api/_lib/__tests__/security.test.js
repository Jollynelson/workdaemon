import { describe, it, expect, beforeAll } from 'vitest';
import { signServiceToken, verifyServiceToken } from '../security.js';

// serviceSecret() reads env at call time; pin it so tests are deterministic.
beforeAll(() => { process.env.SERVICE_TOKEN_SECRET = 'test-signing-secret'; });

const WS = '6451c7c2-ee75-4499-b05a-1dbe26f2836f';

describe('signed service tokens', () => {
  it('round-trips the payload (scope + workspace_id)', () => {
    const tok = signServiceToken({ scope: 'brain_mcp', workspace_id: WS });
    expect(tok.startsWith('wds_')).toBe(true);
    const claims = verifyServiceToken(tok);
    expect(claims).toMatchObject({ scope: 'brain_mcp', workspace_id: WS });
  });

  it('rejects a tampered signature', () => {
    const tok = signServiceToken({ scope: 'brain_mcp', workspace_id: WS });
    expect(verifyServiceToken(tok.slice(0, -3) + 'xxx')).toBeNull();
  });

  it('rejects a tampered body', () => {
    const tok = signServiceToken({ scope: 'brain_mcp', workspace_id: WS });
    const [head, sig] = tok.slice(4).split('.');
    const forged = 'wds_' + Buffer.from(JSON.stringify({ scope: 'brain_mcp', workspace_id: 'other-ws' })).toString('base64url') + '.' + sig;
    expect(verifyServiceToken(forged)).toBeNull();
  });

  it('rejects garbage and wrong prefix', () => {
    expect(verifyServiceToken('wds_abc.def')).toBeNull();
    expect(verifyServiceToken('not-a-token')).toBeNull();
    expect(verifyServiceToken('')).toBeNull();
    expect(verifyServiceToken(null)).toBeNull();
  });

  it('rejects a token signed with a different secret', () => {
    const tok = signServiceToken({ scope: 'brain_mcp', workspace_id: WS });
    process.env.SERVICE_TOKEN_SECRET = 'a-different-secret';
    expect(verifyServiceToken(tok)).toBeNull();
    process.env.SERVICE_TOKEN_SECRET = 'test-signing-secret'; // restore
  });
});
