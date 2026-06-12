import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  normalizeEvidence, extractEntityKeys, detectConflicts,
  termsForToolWrite, termsForText, gateToolWrite, gateProposedActions,
  divertToApprovalQueue, gateEnabled, gateThreshold, SEVERITY,
} from '../verification_gate.js';

const NOW = Date.parse('2026-06-12T12:00:00Z');
const daysAgo = (d) => new Date(NOW - d * 86400_000).toISOString();
const hoursAgo = (h) => new Date(NOW - h * 3600_000).toISOString();

// ── Fixtures: the canonical fragmented-context scenario ───────────────────────
// A GitHub issue closed 5 days ago that a Slack thread from 2 hours ago says is
// still broken — the exact disagreement the gate exists to catch.
const ghIssueClosed = {
  source: 'github', external_id: 'issue-901', doc_type: 'issue',
  title: 'workdaemon #142: Stream envelope drops final block',
  content: 'Fixed by routing the final block through parseJsonResponse.',
  metadata: { state: 'closed', repo: 'treasure-bee/workdaemon' },
  updated_at: daysAgo(5), url: 'https://github.com/treasure-bee/workdaemon/issues/142',
};
const slackStillBroken = {
  source: 'slack', external_id: 'channel-eng-prod', doc_type: 'channel',
  title: '#eng-prod (Slack)',
  content: 'maya: heads up — #142 is still broken on prod, reopening. do not ship the envelope change.',
  metadata: { channel: 'eng-prod' },
  updated_at: hoursAgo(2),
};
const slackAgrees = {
  ...slackStillBroken,
  content: 'maya: shipped the fix for #142, verified on prod. closed.',
};
const jiraDone = {
  source: 'atlassian', external_id: 'jira-77', doc_type: 'issue',
  title: 'ENG-77: Migrate envelope consumers',
  content: 'All consumers migrated to v2.',
  metadata: { status: 'Done', project: 'ENG' },
  updated_at: daysAgo(3),
};
const slackEng77Blocked = {
  source: 'slack', external_id: 'channel-eng', doc_type: 'channel',
  title: '#eng (Slack)',
  content: 'tobi: ENG-77 is blocked, waiting on infra to provision the new queue.',
  metadata: { channel: 'eng' },
  updated_at: hoursAgo(6),
};
const notionUnrelated = {
  source: 'notion', external_id: 'page-abc', doc_type: 'page',
  title: 'Q3 pricing strategy',
  content: 'Tiered pricing rollout plan, done by end of quarter.',
  metadata: { last_edited: daysAgo(1) },
  updated_at: daysAgo(1),
};

beforeEach(() => {
  delete process.env.VERIFICATION_GATE;
  delete process.env.GATE_CONFIDENCE_THRESHOLD;
});
afterEach(() => {
  delete process.env.VERIFICATION_GATE;
  delete process.env.GATE_CONFIDENCE_THRESHOLD;
});

// Chainable thenable Supabase stub. Each from(table) consumes the next planned
// {data,error} step for that table and records what was called on it.
function makeDb(plan = {}) {
  const calls = [];
  // Copy the queues — shift() must not mutate fixtures shared across tests.
  const queues = Object.fromEntries(Object.entries(plan).map(([k, v]) => [k, [...v]]));
  return {
    calls,
    from(table) {
      const queue = queues[table] || [];
      const step = queue.length ? queue.shift() : { data: null, error: null };
      const rec = { table, ops: [] };
      calls.push(rec);
      const api = {};
      for (const op of ['select', 'eq', 'or', 'order', 'limit', 'in', 'update']) {
        api[op] = (...args) => { rec.ops.push([op, ...args]); return api; };
      }
      api.insert = (row) => { rec.ops.push(['insert', row]); rec.inserted = row; return api; };
      api.maybeSingle = () => Promise.resolve(step);
      api.single = () => Promise.resolve(step);
      api.then = (onOk, onErr) => Promise.resolve(step).then(onOk, onErr);
      return api;
    },
  };
}

describe('normalizeEvidence', () => {
  it('maps GitHub issue state to canonical states', () => {
    const [e] = normalizeEvidence([ghIssueClosed]);
    expect(e.state).toBe('resolved');
    expect(e.source).toBe('github');
    expect(e.at).toBe(Date.parse(ghIssueClosed.updated_at));
  });
  it('maps Jira status names', () => {
    expect(normalizeEvidence([jiraDone])[0].state).toBe('resolved');
    expect(normalizeEvidence([{ ...jiraDone, metadata: { status: 'In Progress' } }])[0].state).toBe('open');
    expect(normalizeEvidence([{ ...jiraDone, metadata: { status: 'Blocked' } }])[0].state).toBe('blocked');
  });
  it('infers state from unstructured text, negations winning over positives', () => {
    expect(normalizeEvidence([slackStillBroken])[0].state).toBe('open');
    expect(normalizeEvidence([slackAgrees])[0].state).toBe('resolved');
    expect(normalizeEvidence([{ source: 'slack', title: 't', content: 'this is not fixed yet' }])[0].state).toBe('open');
  });
  it('prefers metadata.last_edited for the timestamp when present', () => {
    expect(normalizeEvidence([notionUnrelated])[0].at).toBe(Date.parse(notionUnrelated.metadata.last_edited));
  });
});

describe('extractEntityKeys', () => {
  it('extracts Jira keys, numeric issue refs, and normalized URLs', () => {
    const keys = extractEntityKeys('ENG-142 relates to #77, see https://www.github.com/a/b/');
    expect(keys.has('eng-142')).toBe(true);
    expect(keys.has('#77')).toBe(true);
    expect(keys.has('github.com/a/b')).toBe(true);
  });
  it('ignores Slack channel-style refs (#general is not an issue)', () => {
    expect(extractEntityKeys('posted in #general').size).toBe(0);
  });
});

describe('detectConflicts — the cross-source conflict detector', () => {
  it('flags a closed GitHub issue contradicted by a newer Slack thread', () => {
    const ev = normalizeEvidence([ghIssueClosed, slackStillBroken]);
    const det = detectConflicts(ev, { now: NOW });
    expect(det.conflicts).toHaveLength(1);
    const c = det.conflicts[0];
    expect(c.kind).toBe('state_contradiction');
    expect(c.sources.map(s => s.source).sort()).toEqual(['github', 'slack']);
    expect(c.detail).toContain('open');
    expect(c.detail).toContain('resolved');
    expect(det.confidence).toBe(1 - SEVERITY.state_contradiction);
  });
  it('does not flag agreeing sources', () => {
    const det = detectConflicts(normalizeEvidence([ghIssueClosed, slackAgrees]), { now: NOW });
    expect(det.conflicts).toHaveLength(0);
    expect(det.confidence).toBe(1);
  });
  it('does not cross-contaminate unrelated entities', () => {
    const det = detectConflicts(normalizeEvidence([ghIssueClosed, notionUnrelated]), { now: NOW });
    expect(det.conflicts).toHaveLength(0);
    expect(det.groups).toBe(2);
  });
  it('flags Jira Done vs Slack blocked on a shared key', () => {
    const det = detectConflicts(normalizeEvidence([jiraDone, slackEng77Blocked]), { now: NOW });
    expect(det.conflicts.some(c => c.kind === 'state_contradiction')).toBe(true);
    expect(det.confidence).toBeLessThan(gateThreshold());
  });
  it('treats open vs blocked as a mild disagreement, not a hard conflict', () => {
    const ghOpen = { ...ghIssueClosed, title: 'workdaemon ENG-77: consumers', metadata: { state: 'open' } };
    const det = detectConflicts(normalizeEvidence([ghOpen, slackEng77Blocked]), { now: NOW });
    expect(det.conflicts).toHaveLength(1);
    expect(det.conflicts[0].kind).toBe('cross_state_disagreement');
    expect(det.confidence).toBe(1 - SEVERITY.cross_state_disagreement);
    expect(det.confidence).toBeGreaterThanOrEqual(gateThreshold()); // reported, not held
  });
  it('flags reversal language in the newest source', () => {
    const walkback = { ...slackStillBroken, content: 'maya: disregard the earlier plan for #142 — we changed the plan, it ships closed as-is.' };
    const det = detectConflicts(normalizeEvidence([ghIssueClosed, walkback]), { now: NOW });
    expect(det.conflicts.some(c => c.kind === 'reversal_language')).toBe(true);
  });
  it('flags stale context when every source on an entity is old', () => {
    const oldGh = { ...ghIssueClosed, updated_at: daysAgo(40) };
    const oldSlack = { ...slackAgrees, updated_at: daysAgo(30) };
    const det = detectConflicts(normalizeEvidence([oldGh, oldSlack]), { now: NOW });
    expect(det.conflicts).toHaveLength(1);
    expect(det.conflicts[0].kind).toBe('stale_context');
    expect(det.confidence).toBe(1 - SEVERITY.stale_context);
  });
  it('returns full confidence for empty evidence', () => {
    const det = detectConflicts([], { now: NOW });
    expect(det.conflicts).toHaveLength(0);
    expect(det.confidence).toBe(1);
  });
});

describe('terms extraction', () => {
  it('pulls precise identifiers from tool-write params', () => {
    const terms = termsForToolWrite('jira.comment', { issue_key: 'ENG-77', comment: 'context at https://github.com/a/b' });
    expect(terms).toContain('ENG-77');
    expect(terms.some(t => t.includes('github.com/a/b'))).toBe(true);
  });
  it('falls back to distinctive title words for free-text actions', () => {
    const terms = termsForText('Migrate envelope consumers to v2 before launch');
    expect(terms.length).toBeGreaterThan(0);
    expect(terms).toContain('consumers');
  });
  it('returns nothing for parameterless writes (gate then passes through)', () => {
    expect(termsForToolWrite('gdrive.create_doc', {})).toHaveLength(0);
  });
});

describe('gateToolWrite — the pre-mutation reasoning gate', () => {
  const conflictingDocs = { workspace_documents: [{ data: [ghIssueClosed, slackStillBroken], error: null }] };
  const haltJson = JSON.stringify({
    supports: [], contradicts: [{ evidence: 2, why: 'Slack says #142 is still broken on prod' }],
    downstream_risks: ['announcing a fix that is not live'], confidence: 0.2, verdict: 'halt', reason: 'Sources disagree on issue state',
  });

  it('halts a write that contradicts newer cross-source context', async () => {
    const db = makeDb(conflictingDocs);
    const v = await gateToolWrite(db, {
      workspaceId: 'ws1', name: 'slack.post',
      spec: { label: 'Post a Slack message', describe: p => `Post: ${p.text}` },
      params: { channel: 'general', text: 'Good news: #142 is fixed and deployed!' },
    }, { resolveLLM: async () => ({ provider: 'test' }), callLLM: async () => haltJson });
    expect(v.proceed).toBe(false);
    expect(v.conflicts[0].kind).toBe('state_contradiction');
    expect(v.critique.verdict).toBe('halt');
    expect(v.confidence).toBe(0.2); // min(deterministic 0.65, llm 0.2)
  });

  it('still halts on deterministic conflicts when the critique LLM fails', async () => {
    const db = makeDb(conflictingDocs);
    const v = await gateToolWrite(db, {
      workspaceId: 'ws1', name: 'slack.post',
      spec: { label: 'Post', describe: p => String(p.text) },
      params: { text: 'shipping the #142 fix announcement' },
    }, { resolveLLM: async () => ({ provider: 'test' }), callLLM: async () => { throw new Error('timeout'); } });
    expect(v.critique).toBeNull();
    expect(v.proceed).toBe(false); // 0.65 < 0.7 on deterministic evidence alone
  });

  it('never lets the LLM override a deterministic conflict back to proceed', async () => {
    const db = makeDb(conflictingDocs);
    const optimistic = JSON.stringify({ supports: [], contradicts: [], downstream_risks: [], confidence: 0.95, verdict: 'proceed', reason: 'fine' });
    const v = await gateToolWrite(db, {
      workspaceId: 'ws1', name: 'slack.post',
      spec: { label: 'Post', describe: p => String(p.text) },
      params: { text: 'update on #142' },
    }, { resolveLLM: async () => ({ provider: 'test' }), callLLM: async () => optimistic });
    expect(v.confidence).toBe(0.65); // min(0.65, 0.95)
    expect(v.proceed).toBe(false);
  });

  it('proceeds when the connected tools agree', async () => {
    const db = makeDb({ workspace_documents: [{ data: [ghIssueClosed, slackAgrees], error: null }] });
    const v = await gateToolWrite(db, {
      workspaceId: 'ws1', name: 'slack.post',
      spec: { label: 'Post', describe: p => String(p.text) },
      params: { text: '#142 retro notes' },
    }, { resolveLLM: async () => { throw new Error('should not be called'); } });
    expect(v.proceed).toBe(true);
    expect(v.conflicts).toHaveLength(0);
  });

  it('proceeds with no terms or no matching evidence (absence is not a conflict)', async () => {
    const v1 = await gateToolWrite(makeDb(), { workspaceId: 'ws1', name: 'gdrive.create_doc', spec: { label: 'Doc' }, params: {} });
    expect(v1.proceed).toBe(true);
    const v2 = await gateToolWrite(makeDb({ workspace_documents: [{ data: [], error: null }] }), {
      workspaceId: 'ws1', name: 'jira.comment', spec: { label: 'Comment', describe: () => 'c' }, params: { issue_key: 'ZZZ-999', comment: 'ping' },
    });
    expect(v2.proceed).toBe(true);
    expect(v2.evidenceCount).toBe(0);
  });

  it('respects the threshold env override', async () => {
    process.env.GATE_CONFIDENCE_THRESHOLD = '0.5';
    const db = makeDb(conflictingDocs);
    const v = await gateToolWrite(db, {
      workspaceId: 'ws1', name: 'slack.post',
      spec: { label: 'Post', describe: p => String(p.text) },
      params: { text: 'note about #142' },
    }, { resolveLLM: async () => null });
    expect(v.confidence).toBe(0.65);
    expect(v.proceed).toBe(true); // 0.65 ≥ 0.5 — conflict reported but not held
    expect(v.conflicts).toHaveLength(1);
  });

  it('can be disabled with VERIFICATION_GATE=off', async () => {
    process.env.VERIFICATION_GATE = 'off';
    const v = await gateToolWrite(makeDb(), { workspaceId: 'ws1', name: 'slack.post', spec: { label: 'Post' }, params: { text: '#142' } });
    expect(v).toEqual({ proceed: true, skipped: true });
    expect(gateEnabled()).toBe(false);
  });

  it('fails open when evidence retrieval errors (db down ≠ blocked pipeline)', async () => {
    const db = { from() { throw new Error('db down'); } };
    const v = await gateToolWrite(db, { workspaceId: 'ws1', name: 'slack.post', spec: { label: 'Post' }, params: { text: 'about #142' } });
    expect(v.proceed).toBe(true);
    expect(v.conflicts).toHaveLength(0);
    expect(v.evidenceCount).toBe(0);
  });
});

describe('gateProposedActions — knowledge-daemon proposals', () => {
  it('flags the conflicted proposal and passes the clean one', async () => {
    const db = makeDb({
      workspace_documents: [
        { data: [jiraDone, slackEng77Blocked], error: null }, // for the ENG-77 action
        { data: [], error: null },                            // for the clean action
      ],
    });
    const actions = [
      { type: 'task', title: 'Close out ENG-77 migration', body: 'Mark ENG-77 complete and notify the team' },
      { type: 'note', title: 'Record Q3 pricing decision', body: 'Tiered rollout approved' },
    ];
    const [v1, v2] = await gateProposedActions(db, { workspaceId: 'ws1', llm: null, actions });
    expect(v1.proceed).toBe(false);
    expect(v1.conflicts[0].kind).toBe('state_contradiction');
    expect(v2.proceed).toBe(true);
  });
});

describe('divertToApprovalQueue', () => {
  const verification = {
    proceed: false, confidence: 0.65, threshold: 0.7,
    conflicts: [{ kind: 'state_contradiction', severity: 0.35, sources: [], detail: 'slack says open but github says resolved' }],
    critique: null,
  };
  const action = { kind: 'tool_write', name: 'slack.post', title: 'Post: #142 is fixed!', params: { text: '#142 is fixed!' } };

  it('creates the paused system agent once and queues a proposed alert', async () => {
    const db = makeDb({
      agents: [
        { data: null, error: null },              // maybeSingle: no gate agent yet
        { data: { id: 'agent-gate' }, error: null }, // insert → created
      ],
      daemon_actions: [{ data: { id: 'act-1' }, error: null }],
    });
    const r = await divertToApprovalQueue(db, { workspaceId: 'ws1', userId: 'u1', action, verification });
    expect(r).toEqual({ id: 'act-1' });
    const agentInsert = db.calls.find(c => c.table === 'agents' && c.inserted);
    expect(agentInsert.inserted.status).toBe('paused'); // never picked up by runDueAgents
    expect(agentInsert.inserted.role).toBe('custom');
    const actInsert = db.calls.find(c => c.table === 'daemon_actions').inserted;
    expect(actInsert.status).toBe('proposed');
    expect(actInsert.type).toBe('alert');
    expect(actInsert.agent_id).toBe('agent-gate');
    expect(actInsert.title).toMatch(/^Held for review:/);
    expect(actInsert.payload.requires_human).toBe(true);
    expect(actInsert.payload.verification.conflicts).toHaveLength(1);
    expect(actInsert.body).toContain('slack says open but github says resolved');
  });

  it('reuses an existing gate agent', async () => {
    const db = makeDb({
      agents: [{ data: { id: 'agent-existing' }, error: null }],
      daemon_actions: [{ data: { id: 'act-2' }, error: null }],
    });
    const r = await divertToApprovalQueue(db, { workspaceId: 'ws1', action, verification });
    expect(r).toEqual({ id: 'act-2' });
    expect(db.calls.filter(c => c.table === 'agents')).toHaveLength(1);
    expect(db.calls.find(c => c.table === 'daemon_actions').inserted.agent_id).toBe('agent-existing');
  });

  it('returns null instead of throwing when the queue write fails', async () => {
    const db = { from() { throw new Error('db down'); } };
    const r = await divertToApprovalQueue(db, { workspaceId: 'ws1', action, verification });
    expect(r).toBeNull();
  });
});
