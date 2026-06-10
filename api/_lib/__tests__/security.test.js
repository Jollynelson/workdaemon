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

  it('stamps iat on every token', () => {
    const before = Math.floor(Date.now() / 1000);
    const claims = verifyServiceToken(signServiceToken({ scope: 'brain_mcp', workspace_id: WS }));
    expect(claims.iat).toBeGreaterThanOrEqual(before);
    expect(claims.exp).toBeUndefined(); // no expiry unless requested
  });

  it('honors exp: future-dated tokens verify, expired tokens are rejected', () => {
    const live = signServiceToken({ scope: 'brain_mcp', workspace_id: WS }, { expiresInSec: 3600 });
    expect(verifyServiceToken(live)).toMatchObject({ workspace_id: WS });
    const dead = signServiceToken({ scope: 'brain_mcp', workspace_id: WS }, { expiresInSec: -10 });
    expect(verifyServiceToken(dead)).toBeNull();
  });

  it('FAILS CLOSED: with no secret configured, signing throws and nothing verifies', () => {
    const saved = {
      SERVICE_TOKEN_SECRET: process.env.SERVICE_TOKEN_SECRET,
      OAUTH_STATE_SECRET: process.env.OAUTH_STATE_SECRET,
      ENCRYPTION_KEY: process.env.ENCRYPTION_KEY,
    };
    const tok = signServiceToken({ scope: 'brain_mcp', workspace_id: WS });
    delete process.env.SERVICE_TOKEN_SECRET;
    delete process.env.OAUTH_STATE_SECRET;
    delete process.env.ENCRYPTION_KEY;
    expect(() => signServiceToken({ scope: 'brain_mcp', workspace_id: WS })).toThrow(/not configured/);
    expect(verifyServiceToken(tok)).toBeNull(); // previously minted tokens stop verifying too
    for (const [k, v] of Object.entries(saved)) if (v !== undefined) process.env[k] = v;
  });
});

describe('timingSafeEqualStr', () => {
  it('matches equal strings, rejects different/mismatched-length/non-strings', async () => {
    const { timingSafeEqualStr } = await import('../security.js');
    expect(timingSafeEqualStr('secret-token', 'secret-token')).toBe(true);
    expect(timingSafeEqualStr('secret-token', 'secret-tokeX')).toBe(false);
    expect(timingSafeEqualStr('short', 'much-longer-string')).toBe(false);
    expect(timingSafeEqualStr(null, 'x')).toBe(false);
    expect(timingSafeEqualStr(undefined, undefined)).toBe(false);
  });
});
