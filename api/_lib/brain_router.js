// Two-tier brain routing + escalation.
// Implements WorkDaemon_FINAL_BuildSpec.md §10 and CompanyBrain_ChangeSpec_DeepSeekV4
// §2/§2b — adapted to the live app's MULTI-PROVIDER reality (the spec hard-codes
// DeepSeek V4 Pro/Flash; we keep provider choice per workspace). The lever is the
// MODEL: route shallow turns to the workspace's fast model, deep/complex turns to a
// stronger sibling, and escalate fast→deep when a fast answer comes back thin.
//
// Demo-safe: tiers are env-overridable and any routing/escalation error falls back
// to the workspace's configured model (today's behavior). Set BRAIN_TWO_TIER=off to disable.

// Technical work (code / spreadsheets / data) — needs the stronger reasoner.
const TECH = /\b(code|repo|repository|function|class|bug|stack ?trace|exception|deploy(ment)?|pull request|\bPR\b|\bdiff\b|commit|merge conflict|spreadsheet|excel|\bcsv\b|\bsql\b|query|database|schema|migration|endpoint|script|regex|typescript|javascript|python|refactor|debug)\b/i;
const TECH_COMPLEX = /\b(refactor|redesign|debug|architect(ure)?|optimiz|rewrite|migrate|multi-?file|across the (repo|codebase)|whole (repo|codebase)|every file|all files|end[- ]to[- ]end|implement the|design the)\b/i;

// Strategic / analytical work — deep tier even when not technical.
const DEEP = /\b(strateg|why are|why is|why did|analy|roadmap|forecast|projection|board (deck|meeting)|runway|fundrais|pricing|trade-?off|should we|should i|decide|decision|compare|versus|\bvs\b|pros and cons|long[- ]term|hiring plan|go[- ]to[- ]market|\bGTM\b|positioning|competitive|scenario|what if|model out|break down)\b/i;

// Provider → {fast, deep} default model pair. Deep is a stronger sibling.
// keyRow.model (the workspace's configured model) wins as `fast`; deep falls back here.
const TIER_DEFAULTS = {
  deepseek:  { fast: 'deepseek-chat',      deep: 'deepseek-reasoner' },
  google:    { fast: 'gemini-2.5-flash',   deep: 'gemini-2.5-pro' },
  openai:    { fast: 'gpt-4o-mini',        deep: 'gpt-4o' },
  anthropic: { fast: 'claude-sonnet-4-6',  deep: 'claude-opus-4-8' },
};

// Classify a single user turn. No LLM call — cheap heuristics (spec §10 classify()).
export function classifyTurn(text, { connectedTools = [], msgCount = 0 } = {}) {
  const t = (text || '').trim();
  // Session pings / confirmations / empty → fast (high-frequency, no depth needed).
  if (!t || t === '[SESSION_START]' || t === '[SESSION_RESUME]' || /^CONFIRMED —/.test(t)) {
    return { depth: 'fast', complexity: null, taskType: 'triage', reason: 'sentinel/empty' };
  }
  if (TECH.test(t)) {
    const complex = TECH_COMPLEX.test(t) || /\b(multiple|several|many)\b.*\b(files?|sheets?|tables?|services?)\b/i.test(t);
    return { depth: 'technical', complexity: complex ? 'complex' : 'moderate', taskType: 'technical',
      reason: `technical:${complex ? 'complex' : 'moderate'}` };
  }
  if (DEEP.test(t) || t.length > 600) {
    return { depth: 'deep', complexity: null, taskType: 'analysis', reason: t.length > 600 ? 'long' : 'strategic' };
  }
  return { depth: 'fast', complexity: null, taskType: 'triage', reason: 'default' };
}

// Resolve the fast/deep model pair for this workspace's provider.
export function pickTierModels(keyRow) {
  if ((process.env.BRAIN_TWO_TIER || '').toLowerCase() === 'off') {
    return { fast: keyRow.model, deep: keyRow.model, twoTier: false };
  }
  const d = TIER_DEFAULTS[keyRow.provider] || {};
  const fast = process.env.BRAIN_FAST_MODEL || keyRow.model || d.fast || null;
  const deep = process.env.BRAIN_DEEP_MODEL || d.deep || keyRow.model || fast;
  return { fast, deep, twoTier: !!(deep && fast && deep !== fast) };
}

// Escalation gate (spec: "real logic, not a comment"). A fast answer is "thin" —
// empty, a tiny lone text block, or hedging — so it should be retried on the deep tier.
export function responseIsThin(parsed) {
  const blocks = parsed?.blocks || [];
  if (!blocks.length) return true;
  const text = blocks.filter(b => b.type === 'text').map(b => b.md || '').join(' ').trim();
  if (blocks.length === 1 && blocks[0].type === 'text' && text.length < 40) return true;
  if (/\b(i'?m not sure|i am not sure|i don'?t have enough|not enough (info|context)|hard to say|it depends|cannot determine|unclear to me)\b/i.test(text)) return true;
  return false;
}

// True when this turn should go STRAIGHT to the deep tier (no fast attempt first).
// Reserved for genuinely heavy technical work, where a fast-model attempt is
// usually wasted. Strategic/'deep' turns deliberately do NOT short-circuit here:
// the deep tier (e.g. deepseek-v4-pro) is ~4x slower than the fast tier (~18s vs
// ~4.5s), so they go fast-first and only escalate when the fast answer is thin
// (see responseIsThin in the chat handler). This keeps the common case snappy
// without losing the quality safety net. Set BRAIN_TWO_TIER=off to force fast-only.
export function wantsDeep(route) {
  return route.depth === 'technical' && route.complexity === 'complex';
}
