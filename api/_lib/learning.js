// Self-improvement substrate. One loop — capture SIGNALS, distill INSIGHTS,
// adapt behavior — shared by all four surfaces (agents, daemons, brain,
// codebase). Pure lib (no serverless function) so it stays off Vercel's 12-fn
// cap; called from agent_engine.js, chat.js, brain.js. See migration_learning.sql.
import { resolveLLM, callLLM, extractJson } from './research.js';

// ── Signals: cheap, append-only, never block the caller ──────────────────────
export async function recordSignal(db, { workspaceId = null, domain, subjectType, subjectId = null, signal, value = null, meta = {} }) {
  try {
    await db.from('learning_signals').insert({
      workspace_id: workspaceId, domain, subject_type: subjectType,
      subject_id: subjectId != null ? String(subjectId) : null,
      signal, value, meta,
    });
  } catch (e) {
    // Learning must never break the primary path.
    console.error('[learning] recordSignal failed:', e.message);
  }
}

export async function signalsSince(db, { workspaceId = null, domain, subjectType = null, since = null, limit = 2000 }) {
  let q = db.from('learning_signals').select('*').eq('domain', domain).order('created_at', { ascending: false }).limit(limit);
  if (workspaceId) q = q.eq('workspace_id', workspaceId);
  if (subjectType) q = q.eq('subject_type', subjectType);
  if (since) q = q.gte('created_at', since);
  const { data } = await q;
  return data || [];
}

// ── Insights: distilled learnings that behavior actually reads ───────────────
// Active insights matching a scope (jsonb containment), newest first.
export async function activeInsights(db, { workspaceId = null, domain, scope = {}, kind = null, limit = 20 }) {
  let q = db.from('learning_insights').select('*')
    .eq('domain', domain).eq('status', 'active')
    .order('updated_at', { ascending: false }).limit(limit);
  if (workspaceId) q = q.eq('workspace_id', workspaceId);
  if (kind) q = q.eq('kind', kind);
  if (scope && Object.keys(scope).length) q = q.contains('scope', scope);
  const { data } = await q;
  return data || [];
}

// Upsert by logical identity (workspace+domain+kind+scope): one live insight per
// dimension, refreshed in place so it decays/strengthens instead of duplicating.
export async function upsertInsight(db, { workspaceId = null, domain, scope = {}, kind, insight, confidence = 0.5, evidence = {}, status = 'active' }) {
  try {
    let q = db.from('learning_insights').select('id')
      .eq('domain', domain).eq('status', status).contains('scope', scope).containedBy('scope', scope);
    if (workspaceId) q = q.eq('workspace_id', workspaceId); else q = q.is('workspace_id', null);
    if (kind) q = q.eq('kind', kind);
    const { data: existing } = await q.limit(1).maybeSingle();
    const row = {
      workspace_id: workspaceId, domain, scope, kind, insight,
      confidence, evidence, status,
      applied_at: status === 'active' ? new Date().toISOString() : null, updated_at: new Date().toISOString(),
    };
    if (existing?.id) await db.from('learning_insights').update(row).eq('id', existing.id);
    else await db.from('learning_insights').insert(row);
  } catch (e) {
    console.error('[learning] upsertInsight failed:', e.message);
  }
}

export async function retireInsight(db, id) {
  await db.from('learning_insights').update({ status: 'retired', updated_at: new Date().toISOString() }).eq('id', id);
}

// ── Bandit: turn approve/reject/edit signals into a weighted pick ─────────────
// Wilson-ish smoothed score: rewards approvals, penalizes rejections, with
// Laplace smoothing so cold/low-data variants still get explored.
export function scoreFromCounts({ approved = 0, edited = 0, replied = 0, rejected = 0 }) {
  const wins = approved + 0.6 * edited + 1.5 * replied; // an edit is a partial win; a reply is gold
  const total = approved + edited + replied + rejected;
  return (wins + 1) / (total + 2); // Laplace-smoothed → 0.5 at zero data
}

// Epsilon-greedy pick over variants given their distilled scores.
export function pickVariant(variants, scoreById = {}, epsilon = 0.2) {
  if (!variants?.length) return null;
  if (Math.random() < epsilon) return variants[Math.floor(Math.random() * variants.length)];
  let best = variants[0], bestScore = -Infinity;
  for (const v of variants) {
    const s = scoreById[v.id] ?? 0.5;
    if (s > bestScore) { bestScore = s; best = v; }
  }
  return best;
}

// ── Agent distiller: signals → variant scores + query ranking ────────────────
// Returns adaptation the engine applies to the *next* run, and persists a
// human-readable insight. Counts are keyed off signal.meta.variant_id / source_query.
export async function distillAgentInsights(db, agent, { since = null } = {}) {
  const sigs = await signalsSince(db, {
    workspaceId: agent.workspace_id, domain: 'agent', subjectType: 'outreach_message', since,
  });
  const byVariant = {}, byQuery = {};
  for (const s of sigs) {
    if (String(s.meta?.agent_id) !== String(agent.id)) continue;
    const v = s.meta?.variant_id, qy = s.meta?.source_query;
    const bump = (bag, key) => { if (!key) return; (bag[key] ||= { approved: 0, edited: 0, replied: 0, rejected: 0, sent: 0 }); if (s.signal in bag[key]) bag[key][s.signal]++; };
    bump(byVariant, v); bump(byQuery, qy);
  }
  const variantScores = Object.fromEntries(Object.entries(byVariant).map(([id, c]) => [id, scoreFromCounts(c)]));

  // LEARN FROM RESEARCH: fold in how many candidates each query surfaced. Human
  // approval still dominates; raw research yield is a weak prior so promising new
  // queries (good yield, no decisions yet) still surface above barren ones.
  const research = await signalsSince(db, {
    workspaceId: agent.workspace_id, domain: 'agent', subjectType: 'research_query', since,
  });
  const foundByQuery = {};
  for (const s of research) {
    if (String(s.meta?.agent_id) !== String(agent.id)) continue;
    const qy = s.meta?.source_query; if (!qy) continue;
    foundByQuery[qy] = (foundByQuery[qy] || 0) + (Number(s.value) || 0);
  }
  // Rank queries by realized value (approvals+replies) plus a small research-yield bonus.
  const allQueries = new Set([...Object.keys(byQuery), ...Object.keys(foundByQuery)]);
  const queryScore = qy => scoreFromCounts(byQuery[qy] || {}) + 0.05 * Math.log1p(foundByQuery[qy] || 0);
  const queryRank = [...allQueries]
    .sort((a, b) => queryScore(b) - queryScore(a));

  if (Object.keys(variantScores).length) {
    const best = Object.entries(variantScores).sort((a, b) => b[1] - a[1])[0];
    await upsertInsight(db, {
      workspaceId: agent.workspace_id, domain: 'agent', scope: { agent_id: agent.id }, kind: 'variant_weight',
      insight: `Favoring message style "${best[0]}" (${Math.round(best[1] * 100)}% smoothed win-rate).`,
      confidence: best[1], evidence: { variants: byVariant },
    });
  }
  if (queryRank.length) {
    await upsertInsight(db, {
      workspaceId: agent.workspace_id, domain: 'agent', scope: { agent_id: agent.id }, kind: 'query_rank',
      insight: `Top-yielding ICP queries: ${queryRank.slice(0, 3).join(' · ')}.`,
      confidence: Math.min(1, queryRank.length / 5), evidence: { byQuery, foundByQuery },
    });
  }
  return { variantScores, queryRank, byVariant, byQuery };
}

// ── Daemon distiller: thumbs/edits → a short style correction for this user ───
// Threshold-gated + one cheap LLM pass. Scoped to the user (falls back to role).
export async function distillDaemonInsights(db, { workspaceId, userId, role = null, minSignals = 3 }) {
  const since = new Date(Date.now() - 30 * 24 * 3600 * 1000).toISOString();
  const sigs = (await signalsSince(db, { workspaceId, domain: 'daemon', subjectType: 'daemon_message', since }))
    .filter(s => String(s.meta?.user_id) === String(userId));
  const negatives = sigs.filter(s => s.signal === 'down' || s.signal === 'edited' || s.signal === 'redo');
  if (negatives.length < minSignals) return null;

  const llm = await resolveLLM(workspaceId, db);
  if (!llm) return null;
  const notes = negatives.map(s => `- [${s.signal}] ${String(s.meta?.note || '').slice(0, 200)}`).join('\n');
  const positives = sigs.filter(s => s.signal === 'up').length;
  const sys = 'You tune an AI work-assistant\'s style from user feedback. Return ONLY JSON.';
  const user = `A user gave ${negatives.length} negative and ${positives} positive signals on their daemon's answers.
Negative feedback notes:
${notes || '(no written notes — infer from the signal types: "down"=disliked, "edited"=user rewrote it, "redo"=asked again)'}
Distill at most 3 concrete, durable style corrections this daemon should apply to FUTURE answers (not content facts).
Return JSON {"corrections":[{"rule":"imperative one-liner, e.g. 'Keep answers under 150 words'","confidence":0..1}]}`;
  const txt = await callLLM(llm, sys, user, { maxTokens: 400 });
  const parsed = extractJson(txt);
  const corrections = Array.isArray(parsed?.corrections) ? parsed.corrections.slice(0, 3) : [];
  if (!corrections.length) return null;

  await upsertInsight(db, {
    workspaceId, domain: 'daemon', scope: { user_id: userId }, kind: 'style',
    insight: corrections.map(c => c.rule).filter(Boolean).join(' '),
    confidence: Math.min(1, corrections.reduce((a, c) => a + (Number(c.confidence) || 0.5), 0) / corrections.length),
    evidence: { negatives: negatives.length, positives, corrections },
  });
  return corrections;
}

// Render active daemon style insights as a system-prompt block (caller wraps it
// in untrusted-data delimiters; these are our own distilled rules, but keep the
// surface consistent with other injected context).
export async function buildDaemonLearningContext(db, { workspaceId, userId }) {
  const insights = await activeInsights(db, { workspaceId, domain: 'daemon', scope: { user_id: userId }, kind: 'style', limit: 1 });
  const rule = insights[0]?.insight?.trim();
  if (!rule) return '';
  return `\nLEARNED PREFERENCES (from this user's feedback — apply silently, never mention):\n${rule}\n`;
}

// ── Cron pass: distill daemon feedback for every user with recent signals ─────
// Runs in the brain's daily scan; turns each company's users' 👎/edits into
// per-user style corrections (improves the agents powering that company).
export async function runDaemonLearning(db, workspaceId) {
  const since = new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString();
  const sigs = await signalsSince(db, { workspaceId, domain: 'daemon', subjectType: 'daemon_message', since });
  const users = [...new Set(sigs.filter(s => ['down', 'edited', 'redo'].includes(s.signal)).map(s => s.meta?.user_id).filter(Boolean))];
  let updated = 0;
  for (const userId of users) {
    try { if (await distillDaemonInsights(db, { workspaceId, userId })) updated++; }
    catch (e) { console.error('[learning] distillDaemon user=%s:', userId, e.message); }
  }
  return { users: users.length, updated };
}

// ── Cron pass: the brain audits its own knowledge (Phase 3) ──────────────────
// Confidence-scores findings, flags stale ones, and runs a cheap contradiction/
// gap scan — so each company's brain keeps its knowledge healthy.
export async function auditBrain(db, workspaceId) {
  const STALE_DAYS = 21;
  const cutoff = new Date(Date.now() - STALE_DAYS * 864e5).toISOString();
  const { data: findings } = await db.from('hunt_findings')
    .select('id, pattern, severity, occurrences, recommendation, confidence, created_at')
    .eq('workspace_id', workspaceId).eq('resolved', false)
    .order('created_at', { ascending: true }).limit(100);
  const sevWeight = { critical: 0.9, warning: 0.6, info: 0.4 };
  let scored = 0, stale = 0;
  for (const f of (findings || [])) {
    if (f.confidence == null) {
      const base = sevWeight[f.severity] ?? 0.5;
      const occ = Math.min(1, (f.occurrences || 1) / 5);
      const conf = Math.round((0.5 * base + 0.5 * occ) * 100) / 100;
      await db.from('hunt_findings').update({ confidence: conf, audited_at: new Date().toISOString() }).eq('id', f.id);
      scored++;
    }
    if (f.created_at < cutoff) {
      stale++;
      await recordSignal(db, {
        workspaceId, domain: 'brain', subjectType: 'hunt_finding', subjectId: f.id, signal: 'stale',
        meta: { pattern: f.pattern, age_days: Math.round((Date.now() - new Date(f.created_at)) / 864e5) },
      });
    }
  }
  // Cheap LLM contradiction/gap scan over the open findings.
  try {
    if ((findings || []).length >= 2) {
      const llm = await resolveLLM(workspaceId, db);
      if (llm) {
        const list = findings.slice(0, 20).map((f, i) => `[${i}] (${f.severity}) ${f.pattern} → ${f.recommendation || ''}`).join('\n');
        const sys = 'You audit a company knowledge base for contradictions, duplicates and gaps. Return ONLY JSON.';
        const user = `Open findings:\n${list}\nReturn JSON {"issues":[{"type":"contradiction|gap|duplicate","detail":"one sentence"}]} (max 5, [] if none).`;
        const txt = await callLLM(llm, sys, user, { maxTokens: 500 });
        const issues = extractJson(txt)?.issues;
        for (const it of (Array.isArray(issues) ? issues : []).slice(0, 5)) {
          await recordSignal(db, { workspaceId, domain: 'brain', subjectType: 'audit', signal: it.type || 'issue', meta: { detail: it.detail } });
        }
      }
    }
  } catch (e) { console.error('[learning] auditBrain llm ws=%s:', workspaceId, e.message); }

  await upsertInsight(db, {
    workspaceId, domain: 'brain', scope: {}, kind: 'health',
    insight: `Brain health: ${findings?.length || 0} open findings, ${stale} stale (>${STALE_DAYS}d), ${scored} newly confidence-scored.`,
    confidence: 0.6, evidence: { open: findings?.length || 0, stale, scored },
  });
  return { open: findings?.length || 0, stale, scored };
}

// ── Cron pass: the platform proposes fixes for its own recurring errors ───────
// (Phase 4, propose-only). Global (errors are platform-wide). Clusters error
// signals, drafts a fix per cluster, files it as a PROPOSED insight + optional
// GitHub *issue*. Never opens a PR or merges — humans decide.
async function maybeOpenGithubIssue(cluster, body) {
  const token = process.env.GITHUB_TOKEN, repo = process.env.GITHUB_REPO; // "owner/repo"
  if (!token || !repo) return null;
  try {
    const r = await fetch(`https://api.github.com/repos/${repo}/issues`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'Content-Type': 'application/json', 'User-Agent': 'workdaemon-self-improve' },
      body: JSON.stringify({
        title: `[self-improve] recurring error in ${cluster.where} (${cluster.count}×)`,
        body: `${body}\n\n— auto-filed by WorkDaemon self-improvement. Review before acting; no PR was opened.`,
        labels: ['self-improvement'],
      }),
    });
    const j = await r.json().catch(() => ({}));
    return r.ok ? (j.html_url || null) : null;
  } catch (e) { console.error('[learning] github issue:', e.message); return null; }
}

export async function runCodebaseImprover(db, { sinceDays = 7, minOccurrences = 2 } = {}) {
  // Gate: at most one proposal batch per ~week (the daily cron calls this every day).
  const { data: recent } = await db.from('learning_insights').select('id')
    .eq('domain', 'codebase').eq('kind', 'proposal')
    .gte('updated_at', new Date(Date.now() - 6 * 864e5).toISOString()).limit(1);
  if (recent?.length) return { skipped: 'recent' };

  const since = new Date(Date.now() - sinceDays * 864e5).toISOString();
  const sigs = await signalsSince(db, { domain: 'codebase', subjectType: 'error', since, limit: 2000 });
  const clusters = {};
  for (const s of sigs) {
    if (s.signal !== 'error') continue;
    const where = s.meta?.where || 'unknown';
    const norm = String(s.meta?.message || '').replace(/[0-9a-f]{8,}/gi, '<id>').replace(/\d+/g, '<n>').slice(0, 140);
    const key = `${where}::${norm}`;
    (clusters[key] ||= { where, sample: s.meta?.message, stack: s.meta?.stack, count: 0 }).count++;
  }
  const top = Object.values(clusters).filter(c => c.count >= minOccurrences).sort((a, b) => b.count - a.count).slice(0, 3);
  if (!top.length) return { proposals: 0, clusters: 0 };

  const llm = await resolveLLM(null, db);
  let proposals = 0;
  for (const c of top) {
    let proposal = `Recurring error in ${c.where} (${c.count}×): ${c.sample}`;
    if (llm) {
      try {
        const sys = 'You are a senior engineer triaging a recurring production error. Return ONLY JSON.';
        const user = `Error site: ${c.where}\nMessage: ${c.sample}\nStack (truncated): ${c.stack || 'n/a'}\nSeen ${c.count}× in ${sinceDays} days.\nReturn JSON {"title":"short imperative","root_cause":"1-2 sentences","suggested_fix":"concrete steps; reference ${c.where}","confidence":0..1}.`;
        const txt = await callLLM(llm, sys, user, { maxTokens: 600 });
        const p = extractJson(txt);
        if (p?.title) proposal = `**${p.title}**\nRoot cause: ${p.root_cause}\nSuggested fix: ${p.suggested_fix}`;
      } catch (e) { console.error('[learning] codebase llm:', e.message); }
    }
    const issueUrl = await maybeOpenGithubIssue(c, proposal);
    await upsertInsight(db, {
      workspaceId: null, domain: 'codebase', scope: { where: c.where }, kind: 'proposal',
      insight: proposal + (issueUrl ? `\nGitHub issue: ${issueUrl}` : ''),
      confidence: 0.5, evidence: { count: c.count, sample: c.sample, issueUrl }, status: 'proposed',
    });
    proposals++;
  }
  return { proposals, clusters: top.length };
}
