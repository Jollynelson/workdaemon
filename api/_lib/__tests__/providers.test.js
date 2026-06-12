import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { firstTokenBudget, canRunExtraHop, LLM_CALL_TIMEOUT_MS } from '../providers.js';

// These two pure helpers encode the latency policy the chat handler depends on:
//  - firstTokenBudget: a cold Hermes gateway must fail FAST (short first-token
//    budget) so the turn routes to the cloud fallback instead of waiting out the
//    full self-hosted timeout — the core of the ~90s cold-start fix (#2).
//  - canRunExtraHop: optional escalation/fake-promise/brain-pull hops only run
//    when the phase budget can absorb their cost AND the per-turn allowance is
//    left, so stacked hops can't push a turn past the 60s cap into a 504 (#4).

describe('firstTokenBudget (#2 cold-detect)', () => {
  const ENV = ['HERMES_COLD_CUTOFF_MS', 'CHAT_LLM_TIMEOUT_MS'];
  beforeEach(() => ENV.forEach((k) => delete process.env[k]));
  afterEach(() => ENV.forEach((k) => delete process.env[k]));

  it('gives Hermes a SHORT first-token budget — well under the cloud budget', () => {
    expect(firstTokenBudget('hermes')).toBe(9000);
  });
  it('a cold Hermes gateway aborts far sooner than the old 35s self-hosted timeout', () => {
    expect(firstTokenBudget('hermes')).toBeLessThan(35000);
  });
  it('cloud providers keep the normal call budget', () => {
    expect(firstTokenBudget('deepseek')).toBe(LLM_CALL_TIMEOUT_MS);
    expect(firstTokenBudget('anthropic')).toBe(LLM_CALL_TIMEOUT_MS);
    expect(firstTokenBudget('openrouter')).toBe(LLM_CALL_TIMEOUT_MS);
  });
});

describe('canRunExtraHop (#4 hop budget)', () => {
  it('allows a hop when budget covers the cost and allowance remains', () => {
    expect(canRunExtraHop({ budgetLeftMs: 40000, costMs: LLM_CALL_TIMEOUT_MS, hopsLeft: 2 })).toBe(true);
  });
  it('blocks a hop that the remaining phase budget cannot absorb', () => {
    expect(canRunExtraHop({ budgetLeftMs: 15000, costMs: LLM_CALL_TIMEOUT_MS, hopsLeft: 2 })).toBe(false);
  });
  it('blocks once the per-turn hop allowance is spent', () => {
    expect(canRunExtraHop({ budgetLeftMs: 40000, costMs: LLM_CALL_TIMEOUT_MS, hopsLeft: 0 })).toBe(false);
  });
  it('requires budget STRICTLY greater than the cost (no zero-margin start)', () => {
    expect(canRunExtraHop({ budgetLeftMs: LLM_CALL_TIMEOUT_MS, costMs: LLM_CALL_TIMEOUT_MS, hopsLeft: 1 })).toBe(false);
  });
  it('models the default 2-hop cap draining across a turn', () => {
    let hopsLeft = 2;
    const budget = 45000;
    // escalation
    expect(canRunExtraHop({ budgetLeftMs: budget, costMs: LLM_CALL_TIMEOUT_MS, hopsLeft })).toBe(true);
    hopsLeft--;
    // brain-pull
    expect(canRunExtraHop({ budgetLeftMs: budget, costMs: LLM_CALL_TIMEOUT_MS, hopsLeft })).toBe(true);
    hopsLeft--;
    // a third hop is capped even with budget to spare
    expect(canRunExtraHop({ budgetLeftMs: budget, costMs: LLM_CALL_TIMEOUT_MS, hopsLeft })).toBe(false);
  });
});
