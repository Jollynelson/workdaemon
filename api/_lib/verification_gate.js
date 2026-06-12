// Pre-Mutation Verification Gate + Cross-Source Conflict Detector.
//
// Sits in front of every environment-mutating dispatch (tool writes in
// api/tasks.js, knowledge-daemon proposals in agent_engine.js) and answers one
// question: does the connected-tool context actually support this action?
//
// Two layers, cheapest first:
//  1. CONFLICT DETECTION (deterministic, no LLM) — pull workspace_documents
//     rows (slack/github/notion/atlassian/google ingests) that mention the
//     entities the action touches, group them by shared entity keys, and
//     cross-reference states + timestamps. A closed GitHub issue that a newer
//     Slack thread says is "still broken" degrades a confidence score.
//  2. REASONING GATE (one LLM critique pass) — runs ONLY when layer 1 found a
//     disagreement, so the happy path costs one indexed query. The critique
//     answers: what evidence supports this action, what contradicts it, what
//     breaks downstream if it's wrong — and can veto with verdict "halt".
//
// Decision: confidence below GATE_CONFIDENCE_THRESHOLD (default 0.7) or an
// explicit "halt" verdict holds the action and routes the payload into the
// existing daemon_actions approval queue for a human to resolve.
//
// Fail-safety: a gate *error* (db down, LLM timeout) never blocks the pipeline —
// it fails open with a logged `error` field. Detected conflicts are the only
// thing that holds an action. No evidence ≠ low confidence: most writes touch
// entities the brain has never ingested, and holding those would break ops.
import { callLLM as callLLMDefault, resolveLLM as resolveLLMDefault, extractJson } from './research.js';
import { delimitUntrusted } from './security.js';

export const SEVERITY = {
  state_contradiction: 0.35,      // resolved vs open/blocked across sources
  cross_state_disagreement: 0.15, // open vs blocked (both unresolved, but disagree on why)
  reversal_language: 0.2,         // a newer source explicitly walks back an older claim
  stale_context: 0.1,             // every source on this entity is older than staleDays
};

export function gateEnabled() {
  return process.env.VERIFICATION_GATE !== 'off';
}

export function gateThreshold() {
  const n = Number(process.env.GATE_CONFIDENCE_THRESHOLD);
  return Number.isFinite(n) && n > 0 && n <= 1 ? n : 0.7;
}

// ── Evidence normalization ────────────────────────────────────────────────────
// Cues are ordered: negative phrasings ("not fixed", "still broken") must win
// over the positive words they contain, so OPEN is tested before RESOLVED.
const OPEN_RX = /\b(reopen(ed)?|still (broken|failing|happening|down|open)|not (fixed|resolved|done|working)|regress(ed|ion)|broke again|unresolved|keeps failing)\b/i;
const BLOCKED_RX = /\b(blocked|on hold|waiting on|stuck|paused)\b/i;
const RESOLVED_RX = /\b(closed|resolved|fixed|done|shipped|merged|completed|deployed)\b/i;
const REVERSAL_RX = /\b(actually|in fact|no longer|instead|disregard|ignore (that|the)|outdated|wrong|incorrect|contradicts?|scrap that|changed( the)? plan)\b/i;

function stateFromText(text) {
  if (!text) return null;
  if (OPEN_RX.test(text)) return 'open';
  if (BLOCKED_RX.test(text)) return 'blocked';
  if (RESOLVED_RX.test(text)) return 'resolved';
  return null;
}

function stateFromMetadata(source, metadata = {}) {
  if (source === 'github' && metadata.state) {
    return metadata.state === 'closed' ? 'resolved' : 'open';
  }
  if (metadata.status) { // Jira-style status names
    const s = String(metadata.status).toLowerCase();
    if (/done|closed|resolved|complete/.test(s)) return 'resolved';
    if (/block|hold/.test(s)) return 'blocked';
    return 'open'; // To Do / In Progress / In Review — work not finished
  }
  return null;
}

// workspace_documents rows (or ad-hoc items shaped like them) → canonical
// evidence: { source, id, title, text, state, at, url }. Structured states
// (GitHub issue state, Jira status) outrank text inference.
export function normalizeEvidence(rows = []) {
  return (rows || []).filter(Boolean).map((r) => {
    const text = String(r.content || r.text || '');
    const meta = r.metadata || {};
    const at = Date.parse(meta.last_edited || r.updated_at || r.created_at || '') || null;
    return {
      source: r.source || 'unknown',
      id: r.external_id || r.id || null,
      title: String(r.title || ''),
      text,
      state: stateFromMetadata(r.source, meta) ?? stateFromText(`${r.title || ''} ${text}`),
      at,
      url: r.url || null,
    };
  });
}

// ── Entity keys: precise identifiers that let sources reference each other ────
// Jira keys (ENG-142), numeric issue refs (#123), and normalized URLs. Slack
// channel names (#general) are non-numeric and intentionally excluded.
export function extractEntityKeys(text) {
  const keys = new Set();
  const s = String(text || '');
  for (const m of s.matchAll(/\b[A-Z][A-Z0-9]{1,9}-\d+\b/g)) keys.add(m[0].toLowerCase());
  for (const m of s.matchAll(/#\d+\b/g)) keys.add(m[0]);
  for (const m of s.matchAll(/https?:\/\/[^\s)>\]"']+/gi)) {
    keys.add(m[0].replace(/^https?:\/\/(www\.)?/i, '').replace(/[/?#]+$/, '').toLowerCase());
  }
  return keys;
}

const STOP_WORDS = new Set(['the', 'and', 'for', 'with', 'from', 'this', 'that', 'into', 'about', 'slack', 'update', 'page', 'issue', 'task', 'note', 'draft']);
function significantWords(title) {
  return new Set(String(title || '').toLowerCase().split(/[^a-z0-9]+/)
    .filter(w => w.length > 3 && !STOP_WORDS.has(w)));
}

function titleOverlap(a, b) {
  if (a.size < 2 || b.size < 2) return 0;
  let hit = 0;
  for (const w of a) if (b.has(w)) hit++;
  return hit / Math.min(a.size, b.size);
}

// ── Layer 1: deterministic cross-source conflict detection ────────────────────
// Groups evidence by shared entity keys (or strong title overlap), then flags
// per group: state contradictions, reversal language in the newer source, and
// staleness. One conflict per kind per group — disagreement is a fact about the
// group, not something to multiply by pair count.
export function detectConflicts(evidence, { staleDays = 14, now = Date.now() } = {}) {
  const items = (evidence || []).map((e) => ({
    ...e,
    keys: extractEntityKeys(`${e.title} ${e.text}`),
    words: significantWords(e.title),
  }));

  // Union into groups: shared key, or title-word overlap ≥ 0.5.
  const groupOf = items.map((_, i) => i);
  const find = (i) => (groupOf[i] === i ? i : (groupOf[i] = find(groupOf[i])));
  for (let i = 0; i < items.length; i++) {
    for (let j = i + 1; j < items.length; j++) {
      const shareKey = [...items[i].keys].some(k => items[j].keys.has(k));
      if (shareKey || titleOverlap(items[i].words, items[j].words) >= 0.5) {
        groupOf[find(j)] = find(i);
      }
    }
  }
  const groups = new Map();
  items.forEach((it, i) => {
    const g = find(i);
    if (!groups.has(g)) groups.set(g, []);
    groups.get(g).push(it);
  });

  const conflicts = [];
  for (const members of groups.values()) {
    if (members.length < 2) continue;
    const byTime = [...members].sort((a, b) => (a.at || 0) - (b.at || 0));
    const label = (m) => `${m.source}:"${m.title.slice(0, 80)}"${m.at ? ` (${ageOf(m.at, now)})` : ''}`;

    // State contradiction: pick the strongest disagreeing pair.
    let hard = null, mild = null;
    for (let i = 0; i < byTime.length; i++) {
      for (let j = i + 1; j < byTime.length; j++) {
        const a = byTime[i], b = byTime[j];
        if (!a.state || !b.state || a.state === b.state) continue;
        const isHard = a.state === 'resolved' || b.state === 'resolved';
        const pair = { older: a, newer: b };
        if (isHard) hard = hard || pair; else mild = mild || pair;
      }
    }
    if (hard) {
      conflicts.push({
        kind: 'state_contradiction', severity: SEVERITY.state_contradiction,
        sources: [hard.older, hard.newer].map(m => ({ source: m.source, id: m.id, title: m.title, state: m.state, at: m.at, url: m.url })),
        detail: `${label(hard.newer)} says "${hard.newer.state}" but ${label(hard.older)} says "${hard.older.state}"`,
      });
    } else if (mild) {
      conflicts.push({
        kind: 'cross_state_disagreement', severity: SEVERITY.cross_state_disagreement,
        sources: [mild.older, mild.newer].map(m => ({ source: m.source, id: m.id, title: m.title, state: m.state, at: m.at, url: m.url })),
        detail: `${label(mild.newer)} says "${mild.newer.state}" while ${label(mild.older)} says "${mild.older.state}"`,
      });
    }

    // Reversal language: the newest source explicitly walks something back.
    const newest = byTime[byTime.length - 1];
    if (byTime.length >= 2 && REVERSAL_RX.test(newest.text)) {
      conflicts.push({
        kind: 'reversal_language', severity: SEVERITY.reversal_language,
        sources: [{ source: newest.source, id: newest.id, title: newest.title, at: newest.at, url: newest.url }],
        detail: `${label(newest)} contains reversal language that may invalidate older context on the same entity`,
      });
    }

    // Staleness: nothing on this entity is fresh enough to trust blindly.
    if (newest.at && now - newest.at > staleDays * 86400_000) {
      conflicts.push({
        kind: 'stale_context', severity: SEVERITY.stale_context,
        sources: [{ source: newest.source, id: newest.id, title: newest.title, at: newest.at, url: newest.url }],
        detail: `newest evidence on this entity is ${ageOf(newest.at, now)} old (> ${staleDays}d)`,
      });
    }
  }

  const penalty = conflicts.reduce((s, c) => s + c.severity, 0);
  const confidence = Math.round(Math.max(0.05, Math.min(1, 1 - penalty)) * 100) / 100;
  return { conflicts, confidence, groups: groups.size };
}

function ageOf(at, now = Date.now()) {
  const ms = Math.max(0, now - at);
  const d = Math.floor(ms / 86400_000);
  if (d > 0) return `${d}d`;
  const h = Math.floor(ms / 3600_000);
  return h > 0 ? `${h}h` : 'just now';
}

// ── Evidence retrieval ────────────────────────────────────────────────────────
// PostgREST .or() syntax breaks on commas/parens inside values — sanitize terms
// hard rather than escaping cleverly.
function sanitizeTerm(t) {
  return String(t || '').replace(/[,()%\\]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 60);
}

export async function relatedEvidence(db, workspaceId, terms, { limit = 12 } = {}) {
  const clean = [...new Set((terms || []).map(sanitizeTerm).filter(t => t.length >= 2))].slice(0, 6);
  if (!clean.length) return [];
  try {
    const ors = clean.map(t => `title.ilike.%${t}%,content.ilike.%${t}%`).join(',');
    const { data, error } = await db.from('workspace_documents')
      .select('source, external_id, title, content, url, metadata, updated_at')
      .eq('workspace_id', workspaceId)
      .or(ors)
      .order('updated_at', { ascending: false })
      .limit(limit);
    if (error) return [];
    return normalizeEvidence(data || []);
  } catch {
    return []; // retrieval failure = no evidence, never a blocked pipeline
  }
}

// Terms for a tool write: precise identifiers from params, plus the short
// human-facing strings (channel, subject, title) the write targets.
export function termsForToolWrite(name, params = {}) {
  const terms = new Set();
  for (const k of ['issue_key', 'channel', 'title', 'subject', 'to', 'user']) {
    if (params[k]) terms.add(String(params[k]));
  }
  const bodyText = ['text', 'comment', 'body', 'content', 'description'].map(k => params[k] || '').join(' ');
  for (const key of extractEntityKeys(bodyText)) terms.add(key);
  return [...terms].slice(0, 6);
}

// Terms for a daemon-proposed action: entity keys first (precise), then the
// most distinctive title words so generic proposals still find their context.
export function termsForText(text) {
  const terms = new Set(extractEntityKeys(text));
  const words = [...significantWords(text)].sort((a, b) => b.length - a.length).slice(0, 3);
  for (const w of words) terms.add(w);
  return [...terms].slice(0, 4);
}

// ── Layer 2: structured critique pass (the reasoning gate) ────────────────────
// Evidence text comes from connected tools and is untrusted — it is delimited
// the same way chat context is, so a Slack message can't steer the verdict
// through prompt injection.
export async function critiqueAction(llm, { action, evidence, conflicts }, deps = {}) {
  const call = deps.callLLM || callLLMDefault;
  try {
    const evBlock = (evidence || []).slice(0, 10).map((e, i) =>
      `[${i + 1}] (${e.source}${e.state ? `, state: ${e.state}` : ''}${e.at ? `, ${ageOf(e.at)} old` : ''}) ${e.title}\n${delimitUntrusted(e.text, 300)}`
    ).join('\n');
    const conflictBlock = (conflicts || []).map(c => `- [${c.kind}] ${c.detail}`).join('\n') || '(none)';
    const sys = 'You are a pre-mutation verification gate for an autonomous company daemon. '
      + 'Before an action mutates a real external system, you audit it against the evidence. '
      + 'Be adversarial: hunt for contradictions, stale assumptions, and unstated dependencies. Return ONLY JSON.';
    const user = `PROPOSED ACTION (${action.kind || 'action'}): ${action.title}
${action.body ? `Detail: ${String(action.body).slice(0, 600)}` : ''}

EVIDENCE FROM CONNECTED TOOLS:
${evBlock || '(none)'}

DETECTED CONFLICTS:
${conflictBlock}

Answer three questions and decide:
1. What evidence supports executing this action now?
2. What contradicts it?
3. What breaks downstream if the action is wrong?
Return JSON {"supports":[{"evidence":int,"why":str}],"contradicts":[{"evidence":int,"why":str}],"downstream_risks":[str],"confidence":0..1,"verdict":"proceed"|"halt","reason":"one sentence"}.
Verdict "halt" ONLY when the evidence genuinely disagrees about facts the action depends on.`;
    const txt = await call(llm, sys, user, { maxTokens: 700 });
    const parsed = extractJson(txt);
    if (!parsed || typeof parsed !== 'object') return null;
    return {
      supports: Array.isArray(parsed.supports) ? parsed.supports : [],
      contradicts: Array.isArray(parsed.contradicts) ? parsed.contradicts : [],
      downstream_risks: Array.isArray(parsed.downstream_risks) ? parsed.downstream_risks : [],
      confidence: Math.max(0, Math.min(1, Number(parsed.confidence ?? 1) || 0)),
      verdict: parsed.verdict === 'halt' ? 'halt' : 'proceed',
      reason: String(parsed.reason || '').slice(0, 300),
    };
  } catch {
    return null; // critique is an escalation, never a hard dependency
  }
}

// Combine both layers into a decision. The LLM can only lower confidence or
// veto — it can never overrule a deterministic conflict back to "proceed".
function decide(det, critique, threshold = gateThreshold()) {
  const confidence = critique ? Math.min(det.confidence, critique.confidence) : det.confidence;
  const proceed = confidence >= threshold && critique?.verdict !== 'halt';
  return { proceed, confidence, threshold, conflicts: det.conflicts, critique, evidenceCount: det.evidenceCount ?? null };
}

// ── Gate entrypoints ──────────────────────────────────────────────────────────
// Tool writes (api/tasks.js execute_action / execute_actions). Resolves the
// workspace LLM lazily — only when layer 1 already found a disagreement.
export async function gateToolWrite(db, { workspaceId, name, spec, params = {} }, deps = {}) {
  if (!gateEnabled()) return { proceed: true, skipped: true };
  try {
    const terms = termsForToolWrite(name, params);
    if (!terms.length) return { proceed: true, confidence: 1, conflicts: [], evidenceCount: 0 };
    const evidence = await relatedEvidence(db, workspaceId, terms);
    const det = { ...detectConflicts(evidence), evidenceCount: evidence.length };
    let critique = null;
    if (det.conflicts.length) {
      const resolve = deps.resolveLLM || resolveLLMDefault;
      const llm = await resolve(workspaceId, db).catch(() => null);
      if (llm) {
        const title = (() => { try { return spec?.describe?.(params) || name; } catch { return name; } })();
        critique = await critiqueAction(llm, {
          action: { kind: 'tool_write', title: `${spec?.label || name} — ${title}`, body: JSON.stringify(params).slice(0, 800) },
          evidence, conflicts: det.conflicts,
        }, deps);
      }
    }
    return decide(det, critique);
  } catch (e) {
    return { proceed: true, error: e.message, conflicts: [] };
  }
}

// Knowledge-daemon proposals (agent_engine.js). These are queue-bound already —
// the gate's value is the verification report the approver sees, plus the
// requires_human flag for anything below threshold.
export async function gateProposedActions(db, { workspaceId, llm, actions }, deps = {}) {
  if (!gateEnabled()) return (actions || []).map(() => ({ proceed: true, skipped: true }));
  return Promise.all((actions || []).map(async (a) => {
    try {
      const terms = termsForText(`${a.title || ''} ${a.body || ''}`);
      if (!terms.length) return { proceed: true, confidence: 1, conflicts: [], evidenceCount: 0 };
      const evidence = await relatedEvidence(db, workspaceId, terms);
      const det = { ...detectConflicts(evidence), evidenceCount: evidence.length };
      let critique = null;
      if (det.conflicts.length && llm) {
        critique = await critiqueAction(llm, {
          action: { kind: 'daemon_action', title: a.title, body: a.body },
          evidence, conflicts: det.conflicts,
        }, deps);
      }
      return decide(det, critique);
    } catch (e) {
      return { proceed: true, error: e.message, conflicts: [] };
    }
  }));
}

// ── Divert: route a held action into the daemon_actions approval queue ───────
// daemon_actions.agent_id is NOT NULL, so held tool writes (which have no agent)
// attach to a per-workspace system agent. It is created paused — runDueAgents
// only picks status='active', so it never executes anything itself.
const GATE_AGENT_NAME = 'Verification Gate';

async function gateAgentId(db, workspaceId, userId = null) {
  const { data: existing } = await db.from('agents')
    .select('id').eq('workspace_id', workspaceId).eq('name', GATE_AGENT_NAME).maybeSingle();
  if (existing?.id) return existing.id;
  const { data: created } = await db.from('agents').insert({
    workspace_id: workspaceId, created_by: userId, name: GATE_AGENT_NAME, role: 'custom',
    objective: 'Hold daemon actions whose cross-source context disagrees until a human resolves the contradiction.',
    status: 'paused', autonomy: 'approve_first',
  }).select('id').single();
  return created?.id || null;
}

function humanReport(action, verification) {
  const lines = ['The verification gate held this action before execution.', ''];
  lines.push(`Action: ${action.title}`);
  if (action.body) lines.push(`Detail: ${String(action.body).slice(0, 500)}`);
  lines.push('', `Confidence: ${verification.confidence} (threshold ${verification.threshold})`, '');
  if (verification.conflicts?.length) {
    lines.push('Conflicting context:');
    for (const c of verification.conflicts) lines.push(`• [${c.kind}] ${c.detail}`);
  }
  const crit = verification.critique;
  if (crit?.contradicts?.length) {
    lines.push('', 'What contradicts it:');
    for (const x of crit.contradicts) lines.push(`• ${x.why || JSON.stringify(x)}`);
  }
  if (crit?.downstream_risks?.length) {
    lines.push('', 'Downstream risk if wrong:');
    for (const r of crit.downstream_risks) lines.push(`• ${r}`);
  }
  lines.push('', 'Resolve the contradiction in the source tools, then re-run the action.');
  return lines.join('\n').slice(0, 4000);
}

export async function divertToApprovalQueue(db, { workspaceId, userId = null, agentId = null, runId = null, action, verification }) {
  try {
    const agent = agentId || await gateAgentId(db, workspaceId, userId);
    if (!agent) return null;
    const { data } = await db.from('daemon_actions').insert({
      agent_id: agent, workspace_id: workspaceId, run_id: runId,
      type: 'alert',
      title: `Held for review: ${String(action.title || 'action').slice(0, 175)}`,
      body: humanReport(action, verification),
      rationale: (verification.conflicts?.[0]?.detail || verification.critique?.reason || 'low-confidence context').slice(0, 500),
      payload: { requires_human: true, held_action: action, verification: { confidence: verification.confidence, threshold: verification.threshold, conflicts: verification.conflicts, critique: verification.critique } },
      status: 'proposed',
    }).select('id').single();
    return data ? { id: data.id } : null;
  } catch {
    return null; // diversion is best-effort; the caller already refused to run
  }
}
