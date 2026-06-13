# Self-Hosted Per-Company Models — Serving Plan

**Goal:** every company's daemon runs on its *own* model that **improves itself**
from that company's data — not a shared hosted API. This is the original product
intent: self-hosted intelligence, per company.

Status: **Phase 1 shipped** (the serving wire). Phases 2–5 below.

---

## Audit (2026-06-13) — the real starting state

Two parallel backends share one Supabase DB:

- **Live app** = JS `api/` on Vercel + the shared **Hermes gateway** (Modal) →
  **DeepSeek API**. Per-company intelligence today = **RAG only** (brain context,
  learned skills, docs injected into the prompt). No model is trained on a company.
- **`finetuning/`** = a Python pipeline that *is* ~80% of the self-hosted system:
  dataset builder → QLoRA train (Unsloth, Modal GPU) → HF registry (per-company
  adapter) → quality gate → serving (`modal/serve_app.py`, FastAPI + Claude
  cold-start fallback) → 48h cron. Base = **Qwen3-32B** (config is source of truth;
  the README's "Llama 8B" is stale). It reads the **live** Supabase.

**Verified gaps (the disconnect):**
1. `model_versions` = **0 rows** — no company has *ever* trained/deployed a model.
   The loop has been validated in isolation but never closed end-to-end.
2. **The live brain doesn't feed the trainer.** The dataset builder reads signal
   tables (`query_logs`/`feedback_signals`/`self_critiques`/`training_signals`);
   the live JS app writes **none** of them (the 97 `training_signals` rows are seed
   data). So the deep Slack history + skills + approve/edit/reject feedback we
   built is **not** becoming training data. ← the core gap.
3. **Live serving didn't route to the self-hosted model** — `resolveLLM` had no
   provider for it. (Fixed in Phase 1.)

---

## Phase 1 — Serving wire ✅ (shipped)

A workspace with a **deployed** adapter runs its daemon on its own model; everyone
else is unchanged. Dormant until configured + a model is deployed, so it's a no-op
for all current users.

- **`api/_lib/company_model.js`** — `resolveCompanyModel(db, ws)` (returns a
  `company_model` provider config iff `SELF_HOSTED_SERVE_URL` + `SERVE_MASTER_SECRET`
  are set AND `model_versions` has a `deployed=true` row for the workspace; env-gated
  first so it never queries when unconfigured), `companyServeToken` (HMAC-SHA256(master,
  company_id) hex — byte-matches `finetuning/src/api/auth.py`), `callCompanyModel`
  (POST `{SELF_HOSTED_SERVE_URL}/api/serve/chat`).
- **`providers.js`** — `company_model` case in `callProviderInner` + `callProviderStream`
  (delegates, emits one delta); treated like `hermes` for cold-start budgets.
- **`chat.js`** — `resolveCompanyModel` slots into key resolution **above** the shared
  gateway, **below** an explicit BYO key; a cold/failed company model falls back to
  cloud exactly like Hermes.
- **`research.js`** — same, for workers + research + critique.

**Env to activate:** `SELF_HOSTED_SERVE_URL` (the Modal FastAPI base), `SERVE_MASTER_SECRET`
(shared with the finetuning Modal secret). Routing precedence: BYO key → **company model
(if deployed)** → shared Hermes → DeepSeek → cloud.

Tests: `api/_lib/__tests__/company_model.test.js` (token parity + gating).

---

## Phase 2 — Feed the live brain into the trainer (NEXT — the core gap)

Repoint the dataset builder (or add a JS-side logger) so training data = the brain
we actually fill:
- `daemon_messages` (interactions), `daemon_actions` **approved/edited/rejected**
  (the reward signal), `brain_skills` + `workspace_documents` (corpus),
  `company_terminology`.
- Either (a) write the finetuning signal tables from `api/` as interactions happen,
  or (b) repoint `finetuning/src/dataset/builder.py` at the live tables. (b) is less
  invasive and keeps one source of truth.

## Phase 3 — Close the loop once, for real

Run `finetuning/scripts/run_one_company.py` on Beta Tenant end-to-end: live data →
QLoRA → quality gate → deploy → `model_versions` row → Phase-1 serving picks it up.
First real per-company model.

## Phase 4 — Automate

Schedule the 48h per-company retrain cron (already built in
`finetuning/src/orchestration/`) for active companies; quality gate auto-promotes
only if the new adapter beats the current one (never regress).

## Phase 5 — Multi-LoRA serving (scale)

Per `finetuning/MULTI_LORA_PLAN.md`: one resident base + per-company LoRA via vLLM,
so one GPU serves many companies. Build when ≥3 companies have deployed models.

---

## Open decisions (owner)

- **Base model = the cost driver.** Qwen3-32B (best quality, needs A100/L40S,
  ~$1–2/GPU-hr) vs an 8B base (self-hosts far cheaper). Multi-LoRA amortizes either
  way; scale GPUs by concurrent chat, not company count.
- **Serving posture:** scale-to-zero + cloud fallback (cheap, cold-starts) vs warm
  (fast, costly).

## Honest cost note

Self-hosted GPU serving is an ongoing expense an API call isn't. Multi-LoRA is what
makes it economical at scale. That trade *is* "self-hosted."
