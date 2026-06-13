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

## Phase 2 — Feed the live brain into the trainer ✅ (shipped)

The trainer now reads the brain we actually fill (chose path (b) — repoint the
builder at the live tables; one source of truth):
- **`finetuning/src/db.py`** — `get_daemon_conversations` (daemon_messages by
  workspace_id), `get_accepted_actions` (daemon_actions approved/applied/done = the
  reward signal), `get_brain_skills` (workspace-learned skills). `get_company_name`
  / `get_active_companies` repointed from the pipeline's `companies` table to the
  live **`workspaces`** table.
- **`formatters.py`** — `clean_assistant` (stored reply envelope → prose target),
  `format_action`, `format_skill`.
- **`builder.py`** — `build_from_brain` (conversations + accepted actions + skills,
  deduped) + `merge_examples` (brain wins ties over legacy signals) + `_pair_turns`.
- **`run_company.py`** — the dataset is now `merge_examples(build_from_brain, build_from_signals)`,
  brain primary. Tests: `finetuning/tests/test_brain_dataset.py` (10).

Note: SFT target = the daemon's prose answer (not the JSON envelope) — the model
learns to ANSWER; the serving layer re-wraps the envelope (a Phase-3 detail).
`workspace_documents` (raw corpus) is intentionally NOT direct SFT — it's RAG
grounding; turning docs into Q→A pairs would need an LLM pass (later).

## Phase 2.5 — Corpus → Q&A training data ✅ (shipped + validated)

Conversational data per company is thin, but the deep corpus is rich. `qa_synth.py`
`build_qa_from_corpus` mines `workspace_documents` (excluding restricted docs) into
GROUNDED Q&A pairs — one cheap LLM call/doc (DeepSeek), answers supported ONLY by
the doc. `run_company` merges them: `merge_examples(brain, corpus-Q&A, signals)`.
**Validated live on Beta Tenant: 11 conversations + 65 corpus-Q&A = 76 examples →
clears MIN_EXAMPLES_TO_TRAIN. Phase 3 is now data-viable.** Tests: tests/test_qa_synth.py.

## Phase 3 — Close the loop once, for real (base model DECIDED: Qwen3-32B)

Run training on Beta Tenant end-to-end (`modal run modal_app.py::run_company_remote
--company-id <ws>`): live data → QLoRA → quality gate → deploy → `model_versions`
row → Phase-1 serving picks it up. First real per-company model.

**Base model = Qwen3-32B** (owner, 2026-06-13). Code default is already
`unsloth/Qwen3-32B-unsloth-bnb-4bit`; GPU is `L40S` (48GB) / seq 4096 in
`modal_app.py`. `.env.example` fixed (was a stale 8B template) + `run_company`
now logs the effective base model loudly.

**Gate before the real run (the one thing code can't fix):** the GPU function reads
`BASE_MODEL` (and HF_TOKEN, SUPABASE…) from the Modal secret **`workdaemon-secrets`**.
Confirm that secret's `BASE_MODEL` is `unsloth/Qwen3-32B-unsloth-bnb-4bit` (or unset
→ code default wins) and that `HF_TOKEN` (write) is present — else the run trains 8B
or fails to push. Then: first GPU spend (~$1–2/hr L40S, scale-to-zero). Beta Tenant
≈132 messages → ~50–100 examples (borderline vs `MIN_EXAMPLES_TO_TRAIN=50`) — a
proof-of-loop adapter, not a great model yet.

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
