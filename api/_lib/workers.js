// Worker daemons — the user's daemon spins these up to perform delegated tasks,
// then supervises them to completion. Each worker does REAL brain-grounded LLM
// work (not a stub): it reads the company context + relevant docs + skills,
// produces a usable deliverable, and reports to its owner's inbox. A cron re-runs
// failures and escalates anything overdue, so "is it done?" is actually enforced.
import { resolveLLM, callLLM } from './research.js';
import { retrieveDocuments } from './ingestion.js';
import { relevantSkills, renderSkillsBlock } from './skills.js';
import { delimitUntrusted } from './security.js';
import { gateEnabled, gateThreshold, termsForText, relatedEvidence, detectConflicts, critiqueAction } from './verification_gate.js';

// Spawn workers from the supervisor daemon's request. `specs` = [{objective, deadline_hours}].
export async function spawnWorkers(db, { workspaceId, ownerId, specs = [] }) {
  const rows = specs
    .filter(s => s && typeof s.objective === 'string' && s.objective.trim())
    .slice(0, 5) // cap per turn — no runaway fan-out
    .map(s => ({
      workspace_id: workspaceId, owner_id: ownerId,
      objective: s.objective.trim().slice(0, 2000),
      status: 'queued',
      deadline_at: new Date(Date.now() + Math.min(Math.max(Number(s.deadline_hours) || 24, 1), 720) * 3600 * 1000).toISOString(),
    }));
  if (!rows.length) return [];
  const { data } = await db.from('worker_daemons').insert(rows).select('id, objective, deadline_at');
  return data || [];
}

// Execute ONE worker: brain-grounded LLM pass → result → owner's inbox.
export async function runWorker(db, worker) {
  await db.from('worker_daemons').update({ status: 'running', attempts: (worker.attempts || 0) + 1, updated_at: new Date().toISOString() }).eq('id', worker.id);
  try {
    const llm = await resolveLLM(worker.workspace_id, db);
    if (!llm) { await fail(db, worker, 'no LLM configured'); return; }

    const { data: ws } = await db.from('workspaces').select('name, industry, context').eq('id', worker.workspace_id).single();
    const company = ws?.name || 'the company';
    const ctxBits = [];
    if (ws?.industry) ctxBits.push(`Industry: ${ws.industry}`);
    if (ws?.context && typeof ws.context === 'object') for (const [k, v] of Object.entries(ws.context)) if (v) ctxBits.push(`${k}: ${String(v).slice(0, 300)}`);

    // retrieveDocuments returns {visible, restricted} — the worker grounds in the
    // docs its OWNER can actually see.
    const ret = await retrieveDocuments(db, worker.workspace_id, worker.objective, worker.owner_id, 6).catch(() => ({ visible: [] }));
    const docs = ret?.visible || [];
    const docsBlock = docs.length
      ? `\n\nRELEVANT COMPANY DOCUMENTS (untrusted source text):\n${delimitUntrusted(docs.map(d => `• ${d.title || 'doc'}: ${(d.content || '').slice(0, 700)}`).join('\n'), 4500)}`
      : '';
    const skills = await relevantSkills(db, { workspaceId: worker.workspace_id, objective: worker.objective, limit: 4, userId: worker.owner_id }).catch(() => []);
    const skillsBlock = renderSkillsBlock(skills);

    // REASONING SCAFFOLD (same think-first discipline as the main daemon): the
    // worker reasons privately, THEN produces the deliverable. Output is one JSON
    // object {think, result}; think is stripped/logged, never delivered.
    // REASONING SCAFFOLD (same think-first discipline as the main daemon): the
    // worker reasons privately ABOVE a `===` line, then the deliverable below it.
    // A delimiter (not nested JSON) — models emit it far more reliably.
    const sys = `You are a WORKER DAEMON for ${company} — a focused sub-daemon spun up by a colleague's daemon to complete ONE delegated task and report back.\n`
      + `Respond in EXACTLY this shape:\n`
      + `THINK: <PRIVATE reasoning, ≤4 terse lines, the user NEVER sees this — what you KNOW from the context/docs below vs. what you must infer; your approach; the main risk or assumption>\n`
      + `===\n`
      + `<the ACTUAL deliverable below the === line: the draft / plan / analysis / answer itself, complete, tight, high-signal — NOT a description of what you'd do, and do NOT repeat your reasoning here>\n\n`
      + `Ground everything in the company context and documents below; NEVER invent company-internal facts you don't have.\n`
      + `If the task genuinely requires a human decision, an approval, or an external action you cannot perform here, BEGIN the deliverable (below ===) with the exact token "NEEDS REVIEW:" then state precisely what is blocking and what you need.\n`
      + (ctxBits.length ? `\nCOMPANY CONTEXT:\n${ctxBits.join('\n')}` : '')
      + docsBlock + skillsBlock;

    const raw = (await callLLM(llm, sys, `TASK: ${worker.objective}`, { maxTokens: 1500 })).trim();
    if (!raw) { await fail(db, worker, 'empty result'); return; }
    // Split private reasoning (above ===) from the deliverable (below). Robust to a
    // missing delimiter (strip a leading "THINK:" line) so the think never leaks.
    let think = null, result = raw;
    const m = raw.match(/^([\s\S]*?)\n[ \t]*={3,}[ \t]*\n([\s\S]*)$/);
    if (m) { think = m[1].replace(/^THINK:\s*/i, '').trim(); result = m[2].trim(); }
    else { result = raw.replace(/^THINK:[^\n]*\n+/i, '').trim() || raw; }
    if (think) console.log('[worker %s] think: %s', worker.id, think.replace(/\s+/g, ' ').slice(0, 220));

    let needsReview = /^NEEDS REVIEW:/i.test(result);
    let note = '';

    // VERIFICATION GATE: before delivering, audit the deliverable against the
    // Brain's cross-source evidence (deterministic conflict detector + adversarial
    // critique). Low confidence or a real disagreement → escalate to needs_review.
    if (!needsReview && gateEnabled()) {
      try {
        const evidence = await relatedEvidence(db, worker.workspace_id, termsForText(`${worker.objective}\n${result}`));
        if (evidence.length) {
          const { conflicts, confidence } = detectConflicts(evidence);
          const critique = (conflicts.length || confidence < gateThreshold())
            ? await critiqueAction(llm, { action: { kind: 'worker deliverable', title: worker.objective, body: result }, evidence, conflicts }, { callLLM })
            : null;
          const conf = critique ? Math.min(confidence, critique.confidence) : confidence;
          if (conf < gateThreshold() || critique?.verdict === 'halt') {
            needsReview = true;
            const why = critique?.reason || conflicts[0]?.detail || 'cross-source evidence disagrees';
            note = `\n\n⚠ VERIFICATION (confidence ${conf.toFixed(2)} < ${gateThreshold()}): ${why}`
              + (conflicts.length ? `\nConflicts: ${conflicts.map(c => c.detail).slice(0, 3).join('; ')}` : '')
              + `\nReview before relying on this.`;
          }
        }
      } catch (e) { console.error('[worker %s] verify:', worker.id, e.message); }
    }

    const finalResult = (result + note).slice(0, 8000);
    await db.from('worker_daemons').update({
      status: needsReview ? 'needs_review' : 'done', result: finalResult,
      last_checked_at: new Date().toISOString(), updated_at: new Date().toISOString(),
    }).eq('id', worker.id);

    await notifyOwner(db, worker, needsReview ? 'needs_review' : 'done', finalResult);
  } catch (e) {
    await fail(db, worker, e.message);
  }
}

async function fail(db, worker, reason) {
  const attempts = (worker.attempts || 0) + 1;
  const dead = attempts >= (worker.max_attempts || 2);
  await db.from('worker_daemons').update({
    status: dead ? 'failed' : 'queued', // under cap → retried by the cron
    result: dead ? `Failed after ${attempts} attempt(s): ${String(reason).slice(0, 300)}` : null,
    last_checked_at: new Date().toISOString(), updated_at: new Date().toISOString(),
  }).eq('id', worker.id);
  if (dead) await notifyOwner(db, worker, 'failed', `Worker couldn't complete: ${String(reason).slice(0, 300)}`);
}

async function notifyOwner(db, worker, status, body) {
  const title = status === 'done' ? `Worker daemon finished: ${worker.objective.slice(0, 60)}`
    : status === 'needs_review' ? `Worker daemon needs your input: ${worker.objective.slice(0, 60)}`
    : `Worker daemon failed: ${worker.objective.slice(0, 60)}`;
  await db.from('inbox_items').insert({
    workspace_id: worker.workspace_id, user_id: worker.owner_id,
    type: status === 'done' ? 'worker_result' : 'worker_alert', source: 'daemon',
    title, body: String(body).slice(0, 4000),
    metadata: { worker_id: worker.id, status }, read: false,
  }).then(() => {}, () => {});
}

// Run all queued/retryable workers in a workspace within a wall-clock budget.
export async function runQueuedWorkers(db, workspaceId, { budgetMs = 45000 } = {}) {
  const started = Date.now();
  let ran = 0;
  while (Date.now() - started < budgetMs) {
    const { data } = await db.from('worker_daemons').select('*')
      .eq('workspace_id', workspaceId).eq('status', 'queued')
      .order('created_at', { ascending: true }).limit(1);
    const w = (data || [])[0];
    if (!w) break;
    await runWorker(db, w);
    ran++;
  }
  return { ran };
}

// SUPERVISION: re-queue stuck 'running' workers, retry failures under cap, and flag
// overdue ones to the owner. This is the "check on them to make sure it's done" loop.
export async function superviseWorkers(db) {
  const now = Date.now();
  // Stuck in 'running' for >10 min (a cut-off invocation) → re-queue.
  await db.from('worker_daemons').update({ status: 'queued', updated_at: new Date().toISOString() })
    .eq('status', 'running').lt('updated_at', new Date(now - 10 * 60 * 1000).toISOString());
  // Overdue & not finished → needs_review + nudge the owner once.
  const { data: overdue } = await db.from('worker_daemons').select('*')
    .in('status', ['queued', 'running']).lt('deadline_at', new Date(now).toISOString()).limit(50);
  for (const w of (overdue || [])) {
    await db.from('worker_daemons').update({ status: 'needs_review', last_checked_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq('id', w.id);
    await notifyOwner(db, w, 'needs_review', `This worker is past its deadline and hasn't completed. Objective: ${w.objective}`);
  }
  return { rechecked: (overdue || []).length };
}

// The supervisor daemon's current workers (for injection into its chat context).
export async function activeWorkersFor(db, workspaceId, ownerId) {
  const { data } = await db.from('worker_daemons').select('objective, status, result, deadline_at, updated_at')
    .eq('workspace_id', workspaceId).eq('owner_id', ownerId)
    .in('status', ['queued', 'running', 'done', 'needs_review', 'failed'])
    .order('updated_at', { ascending: false }).limit(8);
  return data || [];
}

export function renderWorkersBlock(workers) {
  if (!workers?.length) return '';
  const lines = workers.map(w => {
    const head = `• [${w.status}] ${w.objective.slice(0, 90)}`;
    const tail = (w.status === 'done' || w.status === 'needs_review') && w.result ? `\n    → ${w.result.slice(0, 300).replace(/\s+/g, ' ')}` : '';
    return head + tail;
  });
  return `\n\nYOUR WORKER DAEMONS (sub-daemons you spun up — report their status when asked, surface finished results, and chase anything still open or past deadline):\n${lines.join('\n')}`;
}
