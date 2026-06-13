// Self-hosted per-company model wire (Phase 1 of the self-hosted serving plan).
// When a workspace has a DEPLOYED adapter in the finetuning pipeline's
// `model_versions` registry, the daemon routes chat to that company's OWN model
// (served by finetuning/modal/serve_app.py) instead of the shared DeepSeek
// gateway. Dormant until BOTH SELF_HOSTED_SERVE_URL + SERVE_MASTER_SECRET are set
// AND a company has a deployed model — so it's a no-op for everyone today.
//
// See docs/specs/SELF_HOSTED_SERVING_PLAN.md.
import crypto from 'node:crypto';

const SERVE_PATH = '/api/serve/chat';

// Per-company serving token: HMAC-SHA256(SERVE_MASTER_SECRET, company_id), hex —
// EXACTLY matches finetuning/src/api/auth.py company_token(). Bound to one
// company, so a leaked token can only ever reach that company's model.
export function companyServeToken(companyId) {
  return crypto.createHmac('sha256', process.env.SERVE_MASTER_SECRET || '').update(String(companyId)).digest('hex');
}

// If this workspace has a deployed self-hosted model AND serving is configured,
// return a provider config routing chat to it; else null (caller falls back to
// the shared gateway / cloud). Env-gated FIRST, so it never even queries when
// self-hosted serving isn't set up (zero hot-path cost for everyone today).
export async function resolveCompanyModel(db, workspaceId) {
  const base = process.env.SELF_HOSTED_SERVE_URL;
  if (!base || !process.env.SERVE_MASTER_SECRET || !workspaceId || !db) return null;
  try {
    const { data } = await db.from('model_versions')
      .select('version, deployed')
      .eq('company_id', workspaceId).eq('deployed', true)
      .order('version', { ascending: false }).limit(1).maybeSingle();
    if (!data) return null;
    return {
      provider: 'company_model', company_id: workspaceId,
      endpoint: base.replace(/\/$/, ''), token: companyServeToken(workspaceId),
      model: `wd-${workspaceId}`, version: data.version ?? null,
    };
  } catch { return null; }
}

// One chat turn against the company's self-hosted model. Returns the content
// string; throws on failure so the caller's cloud fallback takes over. The serve
// endpoint internally does warm-model → cold-start + Claude fallback → base model,
// and returns plain content (no token usage — it's self-hosted).
export async function callCompanyModel({ endpoint, token, company_id, version }, sys, messages, { timeoutMs = 60000 } = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const r = await fetch(`${endpoint}${SERVE_PATH}`, {
      method: 'POST', signal: ctrl.signal,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ company_id, system_prompt: sys, messages, model_version: version ?? null }),
    });
    if (!r.ok) throw new Error(`company_model HTTP ${r.status}`);
    const d = await r.json();
    return d.content || '';
  } finally { clearTimeout(timer); }
}
