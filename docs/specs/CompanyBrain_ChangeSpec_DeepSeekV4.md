# Company Brain — Change Spec: DeepSeek V4 Pro as the Brain

## A patch on top of `CompanyBrain_MasterBuildSpec.md` · 2026

> **Read this first.** This is a *diff*, not a rebuild. Everything in the master spec stands unless a section below explicitly overrides it. The change is architectural but narrow: we split the system cleanly into a **Brain reasoning layer** (now DeepSeek V4 Pro, hosted API) and an **Agent layer** (still fine-tuned Hermes 3 8B, local Ollama). Most of the master spec — isolation, agents, MCP tools, hunt engine, push system, interaction learning, privacy — is untouched. The fine-tuning pipeline shrinks in importance but does **not** disappear.

---

## 0. The new mental model (this is the whole change)

The master spec used one model family (fine-tuned Hermes 3) for everything, with Claude only as a cold-start fallback. The new design assigns **two distinct jobs to two distinct models**:

The Brain is now **two tiers of the same vendor**, split by what the task needs, plus a local agent layer:

| Layer | Tier | Job | Model | Where it runs |
|---|---|---|---|---|
| **Brain** | Deep | Nightly analysis, strategic hunting, complex cross-tool reasoning, hard pattern detection | **DeepSeek V4 Pro** (49B active, 1M ctx, Thinking ON) | Hosted API |
| **Brain** | Fast | Real-time signal triage, instant push alerts, quick tool-result reads | **DeepSeek V4 Flash** (13B active, 1M ctx, Thinking usually OFF) | Hosted API |
| **Agents** | — | Per-staff chat, tool calling, drafting, personal memory | **Fine-tuned Hermes 3 8B** (`wd-{company_id}`) | Local Ollama on your GPU |

**Route by the task, not by a single toggle.** Most Brain work during the day is shallow triage → that's a Flash job all day. Genuine deep reasoning only needs to run on a schedule (or on escalation) → that's Pro. This is cheaper and cleaner than running one model and flipping its thinking mode, because Flash is 13B active vs Pro's 49B and priced well below Pro, while keeping the **same 1M context and the same prefix caching** — so the "whole company in one view" capability survives on the fast tier; you only trade away reasoning depth, which triage doesn't need.

Three-way routing with an escalation path:

```
Brain call →
  fast triage / instant alert / tool-result read     → V4 Flash (thinking off)
  nightly deep pass / strategic hunt / hard pattern   → V4 Pro  (thinking on, effort max)
  a Flash call that detects it's out of its depth     → ESCALATE to V4 Pro
  technical/agentic task (code, spreadsheets, data)   → thinking ON; Flash if moderate, Pro if complex (Section 2b)
```

> **Why the escalation path is mandatory, not optional.** Benchmarks show Flash matches Pro on *simple* tasks but trails on hard ones. Without escalation, Flash will quietly give shallow answers to things that deserved depth — an ambiguous churn signal, a subtle cross-tool pattern. The rule: if a Flash call's own confidence is low or the task is flagged complex, it must hand up to Pro rather than answer weakly.

**Agents** never call DeepSeek in the hot interactive path — they call local Hermes. The Brain (Flash/Pro) feeds *findings and context* down to agents; agents stay fast and free. The exception is heavy technical tasks (Section 2b), where an agent may route a single hard step up to the Brain tier.

> Spine/fingertips, refined: **V4 Pro is the deep spine, V4 Flash is the fast spine, Hermes agents are the fingertips.** The 1M context on *both* Brain tiers is what makes "the entire company in one view" literally true.

---

## 1. Override — Section 3 (Tech stack)

Replace the **Serving** and **cold-start fallback** rows, and add a **Brain reasoning** row:

| Concern | OLD (master spec) | NEW |
|---|---|---|
| Brain — deep tier (nightly, strategic hunts, complex/technical reasoning) | fine-tuned Hermes via Modal | **DeepSeek V4 Pro API** (`deepseek-v4-pro`), 1M ctx, thinking |
| Brain — fast tier (real-time triage, instant alerts, moderate technical) | — (didn't exist) | **DeepSeek V4 Flash API** (`deepseek-v4-flash`), 1M ctx, thinking optional — 13B active, much cheaper |
| Agent serving | Modal GPU endpoint (on-demand) | **Local Ollama on your own GPU** (~$0 marginal) |
| Cold-start / missing-model fallback | Claude API | **DeepSeek V4 Flash** (`deepseek-v4-flash`) — same vendor, same endpoints |
| Training compute | Modal T4/A10G | **unchanged** — still Modal, on-demand, for the 48h Hermes fine-tune |

Everything else in Section 3 stays.

**Why local Ollama now works as the default (not just dev):** your cost model assumes agents run on your own GPU at ~$0 marginal. That's viable because the *heavy* reasoning moved to DeepSeek's hosted API — the local GPU now only serves an 8B model for interactive chat, which a single 24GB card handles for a small company. If you later sell to companies whose volume exceeds one local GPU, revisit Modal serving for agents; until then, local Ollama is the default.

---

## 2. Override — Section 6.6 (the model router)

`src/model/router.py` becomes a **three-destination router** (Flash / Pro / local Hermes) with an escalation path:

```
route(call) →
  if call.kind == "agent":             # per-staff interactive turn (the hot path)
      local Ollama  wd-{company_id}
        on failure / model missing → DeepSeek V4 Flash (non-thinking)   [fallback]
        on hard technical sub-step  → hand up to brain(kind="brain", task_type=...) [Section 2b]

  elif call.kind == "brain":
      task_type, depth = classify(call)         # see classify() below
      if depth == "deep":                        # nightly, strategic hunt, hard pattern
          DeepSeek V4 Pro,  thinking=ON,  reasoning_effort="max"
      elif depth == "technical":                 # code / spreadsheet / data work (Section 2b)
          if complexity == "moderate":  DeepSeek V4 Flash, thinking=ON, reasoning_effort="high"
          else:                          DeepSeek V4 Pro,   thinking=ON, reasoning_effort="max"
      else:                                       # fast: triage, instant alert, tool-result read
          DeepSeek V4 Flash, thinking=OFF
          if result.confidence < THRESHOLD or result.flagged_complex:
              ESCALATE → DeepSeek V4 Pro, thinking=ON, reasoning_effort="max"
```

`classify(call)` decides three things from the call's metadata:
- **task_type** — `triage` | `analysis` | `technical` (technical = a coding/spreadsheet/data tool is in play, Section 2b).
- **depth** — `fast` (default) | `deep` (nightly + strategic hunts) | `technical`.
- **complexity** (technical only) — `moderate` → Flash-with-thinking; `complex` → Pro-with-thinking.

Implementation notes:
- DeepSeek is **OpenAI- and Anthropic-compatible**, so reuse whichever SDK the codebase already has. Keep `base_url` configurable; only the `model` string and the `thinking` / `reasoning_effort` params differ between the two tiers.
- Thinking mode and `reasoning_effort` (`high` / `max`) are request parameters — see DeepSeek's thinking-mode guide. Expose them as fields on the Brain call, set by `classify()`.
- **The escalation gate is real logic, not a comment.** A Flash fast-call returns a confidence/▲complexity signal; if it's below threshold, the router re-runs the same call on Pro. Log every escalation — the escalation rate tells you whether your `classify()` thresholds are right (too many escalations = push more to Pro directly; near-zero = Flash is handling more than you thought, good).
- **Prefix caching applies to BOTH tiers.** Put stable prompt parts — company preamble, tool schemas, standing context — at the front so repeated Flash triage calls and repeated Pro hunts both hit cache. This is the main cost lever; design prompts prefix-stable.

---

## 2b. NEW — Technical task routing (code, spreadsheets, data tools)

When a staff member connects or uses a **technical tool** — GitHub, Excel/Sheets, a database, a data/BI connector — the work shifts from "answer a question" to "reason over structured artifacts." These tasks need **thinking mode on**, but not always the Pro tier. Route by complexity:

| Trigger | Tier + mode | Examples |
|---|---|---|
| Moderate technical task | **V4 Flash, thinking ON, effort `high`** | Read a spreadsheet and summarize/transform it; explain a function; small script; lint/review a short diff; answer a question about a repo file |
| Complex technical task | **V4 Pro, thinking ON, effort `max`** | Multi-file refactor; debug across a repo; design/architecture reasoning; large data analysis spanning many sheets/tables; anything needing long-horizon agentic coding |

How the router decides **moderate vs complex** (cheap heuristic first, escalate if wrong):
- **Signals of complex:** spans multiple files / sheets / tables; requires writing or modifying code (not just reading); the user's request contains design/debug/refactor/optimize intent; the artifact is large (e.g. repo > N files, workbook > N sheets, or context needed > a set token budget).
- **Default to Flash-with-thinking** for a single-file read/explain/transform; **escalate to Pro** if Flash's confidence is low or it detects multi-file/multi-sheet scope mid-task.
- DeepSeek V4 is explicitly strong at **agentic coding** and integrates with coding agents, so Flash-with-thinking genuinely handles a lot of moderate dev work cheaply — lean on that before paying for Pro.

Where this runs in the stack:
- For **agent-initiated** technical work (a staff member asks their agent to do something with GitHub/Excel via MCP), the **local Hermes agent still drives the conversation and the tool calls**, but routes the *hard reasoning sub-step* up to the Brain tier (Flash-thinking or Pro-thinking) via `kind="brain", task_type="technical"`. The agent stays the orchestrator; the Brain tier is the heavy reasoner for that step. This keeps the interactive loop fast while giving real depth where it's needed.
- For **Brain-initiated** technical work (a hunt that needs to read code or financial spreadsheets to confirm a finding), the hunt calls the technical route directly.

Add a `task_type` field to Brain calls (`triage` | `analysis` | `technical`) and a `complexity` hint (`moderate` | `complex`) so `classify()` and the cost accounting can both see it.

---

## 3. Override — Section 10 (Hunt engine) — this is where DeepSeek earns its keep

The five hunt modes move from "LLM reasoning pass with retrieved top-K chunks" to "**DeepSeek V4 Pro reasoning over the whole company in one 1M-context call.**" This is a genuine capability upgrade, not just a model swap.

- **Nightly deep analysis (Thinking ON, `reasoning_effort=max`):** once per night per company, assemble the company's recent state — interaction logs, tool data digests, open findings, terminology — into a single large context (up to ~1M tokens) and run all five hunts in a deep pass. Output: ranked `hunt_findings` with evidence. This is the "strategic hunting / pattern detection" in your diagram.
- **Real-time triage (V4 Flash, thinking OFF):** on incoming signals during the day, fast Flash calls decide whether a signal is worth a push now or can wait for the nightly pass. If a triage call is low-confidence or smells systemic, it **escalates to Pro** rather than guessing.
- **Live push generation (V4 Flash, thinking OFF):** drafting the calibrated push text + recommended action is a fast Flash call.
- **Technical confirmation (Flash-thinking or Pro-thinking, Section 2b):** when a hunt must read code or spreadsheets to confirm a finding (e.g. a Waste hunt verifying a slow CI pipeline, a Finance threat reading a workbook), it routes through the technical path — Flash-with-thinking for a single artifact, Pro-with-thinking for multi-file/multi-sheet scope.

Update `brain/hunter.py` accordingly: every hunt invocation carries `depth` (`fast` | `deep` | `technical`) and the router picks the tier. Nightly = deep (Pro); intraday = fast (Flash) with escalation; artifact-reading = technical. Keep the four golden push scenarios (sales churn, ops bottleneck, CEO brief, HR burnout) as tests — easier to satisfy now because the Brain sees the whole company at once.

**RAG still matters.** 1M context does not mean "stuff everything in every time" — that's slow and expensive even with sparse attention. Use retrieval to assemble the *most relevant* large context for each hunt, and lean on prefix caching for the stable parts. 1M is the ceiling, not the default payload.

---

## 4. Fine-tuning pipeline — what changes (Section 6)

**It stays, but its job narrows.** Previously Hermes was doing everything; now DeepSeek does the heavy reasoning. So the Hermes fine-tune is now *only* about making the **agent layer** feel native: company tone, role behavior, tool-calling format, fast interactive quality. That's still worth doing — it's what keeps agents local, fast, and free.

Concrete edits:
- **Keep** the 48h fine-tune cadence, Unsloth/QLoRA, Modal training, HF per-company adapters, the quality gate. No change.
- **Section 6.1 split is unchanged and now even more important:** facts → retrieval (and DeepSeek's 1M context), behavior → Hermes fine-tune. Do **not** try to fine-tune company knowledge into the 8B; DeepSeek + retrieval owns facts now.
- **New dataset source:** add DeepSeek's nightly Brain outputs as a *teacher signal* for the agents. Where DeepSeek (thinking-on) produced a high-quality answer/finding, distill a fast version into a `training_signals` row (`kind = "brain_distillation"`) so the local Hermes agent gradually learns to handle more on its own without calling out. This is optional but is the cheapest path to making agents smarter over time.
- **Gate unchanged:** still never deploy a worse agent adapter.

---

## 5. Override — Section 7 (cold-start / always-on)

The whole cold-start-masking dance is simpler now:
- Agents are **local and always warm** (Ollama resident on your GPU) — no cold start for the interactive path. Delete the "warm pool during business hours" logic for agents.
- The Brain (DeepSeek) is a **hosted API** — no cold start to manage at all; you pay per token.
- Fallback for a missing/failed local agent model is **DeepSeek V4 Flash** (non-thinking), not Claude.

Net: Section 7's complexity mostly goes away. The "always-on feel" is now real for agents (resident) and inherent for the Brain (hosted).

---

## 6. Override — Section 15 (.env)

Remove the Modal *serving* and Claude fallback vars; keep Modal *training*. Add DeepSeek:

```bash
# ── BRAIN (DeepSeek V4 — two tiers) ──
DEEPSEEK_API_KEY=
DEEPSEEK_BASE_URL=https://api.deepseek.com      # OpenAI- or Anthropic-compatible
BRAIN_DEEP_MODEL=deepseek-v4-pro                 # deep tier: nightly, strategic, complex/technical
BRAIN_FAST_MODEL=deepseek-v4-flash               # fast tier: triage, alerts, moderate technical
AGENT_FALLBACK_MODEL=deepseek-v4-flash           # if local Hermes unavailable
# pin explicitly; do NOT use deepseek-chat / deepseek-reasoner (retired Jul 24 2026)

# routing / escalation
BRAIN_DEEP_REASONING_EFFORT=max                  # Pro deep passes
BRAIN_TECHNICAL_REASONING_EFFORT=high            # Flash-with-thinking technical
BRAIN_ESCALATION_CONFIDENCE_THRESHOLD=0.6        # below this, Flash escalates to Pro
TECHNICAL_COMPLEXITY_FILE_THRESHOLD=3            # >N files/sheets/tables → treat as complex → Pro

# ── AGENTS (local Hermes via Ollama) ──
BASE_MODEL=unsloth/Hermes-3-Llama-3.1-8B-bnb-4bit   # unchanged, for fine-tune
OLLAMA_BASE_URL=http://localhost:11434

# ── TRAINING (unchanged — still Modal on-demand) ──
HF_TOKEN=
HF_ORG=company-brain
NUM_EPOCHS=2
MIN_EXAMPLES_TO_TRAIN=50
TRAINING_WINDOW_HOURS=48

# ── REMOVE these from the master spec ──
# ANTHROPIC_API_KEY        (Claude fallback replaced by DeepSeek Flash)
# SERVE_BACKEND / WARM_POOL_BUSINESS_HOURS   (agents are local + resident now)
```

Everything else in `.env` (Postgres, Redis, embeddings, tool tokens, security) is unchanged.

---

## 7. Override — Section 18 (cost model)

Your numbers, reconciled and annotated:

| Item | Cost | Note |
|---|---|---|
| **Brain — V4 Pro** (deep tier: nightly + escalations + complex technical) | **~$15–22 / company / mo** | $0.435/$0.87 per M in/out. Pro is now used *sparingly* — nightly deep pass + escalated calls + complex code/data. Prefix caching cuts repeated input. |
| **Brain — V4 Flash** (fast tier: all-day triage, alerts, moderate technical) | **~$4–8 / company / mo** | 13B active, priced well below Pro. This is the high-*volume* tier but low cost per call. Caching applies here too. |
| **Blended Brain total** | **~$20–28 / company / mo** | Lands near your ~$26 target. The split *lowers* risk vs all-Pro: shifting the day's many shallow calls to Flash is exactly what keeps the number down. |
| **Agents — local Ollama** | **~$0** | Your own GPU. Marginal cost is electricity. One 24GB card per small company. |
| **Infrastructure** (Postgres, Redis, embeddings, hosting) | **~$50 / mo** | Shared; amortized across companies. |
| **Hermes fine-tune** (Modal T4, 48h cadence) | **~$9 / company / mo** | Unchanged. Track separately so it doesn't surprise you. |
| **HF adapter storage** | **~$1 / company / mo** | Unchanged. |

**Honest flag on the blended Brain number:** the two-tier split *helps* the budget — Flash absorbs the high-frequency shallow calls at a fraction of Pro's price, and Pro only fires on the nightly pass, escalations, and genuinely complex technical work. The number still holds *only* if (a) the Pro deep pass is roughly nightly not hourly, (b) escalation rate stays sane (watch the escalation log — runaway escalation means your `classify()` thresholds push too much to Pro), and (c) prompts are prefix-stable so caching applies on both tiers. One uncached 1M Pro deep call is ~$0.44; the same on Flash is far less. **The cost levers are: how often Pro runs deep, and what fraction of calls escalate.** Make both deliberate and logged.

---

## 8. What does NOT change (so you don't re-touch it)

- **Section 5 — data model.** Unchanged. (Optional: add `model_used` already exists on interactions via `tools_called`/context; if you want Brain-vs-agent attribution, add a nullable `brain_model text` column to `hunt_findings`. Minor.)
- **Section 8 — agent layer** (profiles, factory, prompts, runtime). Unchanged, except the runtime's fallback target is now DeepSeek Flash.
- **Section 9 — interaction logging + three learning loops.** Unchanged.
- **Section 11 — MCP tools + role permissions.** Unchanged.
- **Section 12 — ingestion.** Unchanged.
- **Section 13 — isolation + `test_isolation.py`.** Unchanged and still a release gate. Note: DeepSeek is a shared hosted API, so isolation now also means **never sending Company A's context in the same call as Company B's** — one Brain call is always scoped to one `company_id`. Add an assertion for this in `test_isolation.py`.
- **Section 14 — privacy.** Unchanged and now slightly more important: company data now leaves your infra to a third-party API (DeepSeek). Add to the privacy section: **disclose to customers that Brain-layer reasoning is processed by DeepSeek's API**, and offer enterprise customers a path to a self-hosted DeepSeek V4 (open weights exist) if data residency forbids the hosted API. This mirrors the master spec's BYOM stance.

---

## 9. Edited build order (delta only)

The master spec's 17-step order mostly holds. Changes:

- **Step 8 (Serving + router):** rewrite as "Brain router (DeepSeek Pro/Flash, thinking toggle) + local Ollama agent serving + DeepSeek Flash fallback." Drop Modal serving / warm pool.
- **Step 13 (Hunt + push):** now build hunts as DeepSeek V4 Pro calls with a `depth` arg (nightly deep / intraday fast). The golden-scenario tests should pass more easily with full-company context.
- **New Step 13b:** add `brain_distillation` training-signal capture (Section 4) so agents learn from the Brain over time. Optional but recommended.
- **Step 17 (full dry run):** the nightly deep pass is now a DeepSeek call; assert one Brain call never mixes two companies' data.

Everything else in the order is unchanged.

---

## 10. New privacy/residency decision to make (flagging, not deciding for you)

Moving Brain reasoning to a hosted DeepSeek API means **company data leaves your infrastructure** for that layer. Three honest options, pick per customer tier:

1. **Hosted DeepSeek API (default).** Cheapest, simplest, matches the $26 number. Disclose it. Fine for most SMEs.
2. **Self-hosted DeepSeek V4 (open weights).** For data-residency-bound enterprises. Removes the $26 API cost but adds serious GPU cost — V4 Pro is 1.6T params (MoE, 49B active); this is a real infra commitment, not a single 24GB card. Only do this for enterprise deals that fund it.
3. **DeepSeek V4 Flash everywhere.** If even the Pro cost or latency is too much for a tier, Flash has the same 1M context and dual modes at lower cost/quality. Viable for a cheaper tier.

This is the same BYOM logic from your original Company Brain spec, just applied to the new Brain model. Don't block the build on it — default to option 1, leave the router model-string configurable so 2 and 3 are config changes, not rewrites.

---

## Summary of the diff

You are **not** rebuilding. You are: (1) adding a **two-tier hosted Brain** — V4 Pro for deep reasoning (nightly, strategic hunts, complex work), V4 Flash for the high-volume fast tier (real-time triage, instant alerts, moderate technical), routed by task with a **low-confidence escalation path** from Flash up to Pro; (2) adding **technical task routing** (Section 2b) — when staff use GitHub/Excel/data tools, the Brain switches to thinking mode, Flash-with-thinking for moderate work and Pro-with-thinking for complex multi-file/multi-sheet work, with the local agent still orchestrating and routing only the hard sub-step up; (3) moving agents to always-resident local Ollama; (4) swapping the fallback from Claude to DeepSeek Flash; (5) narrowing the Hermes fine-tune to agent-behavior only while keeping it; and (6) rewriting the hunt engine to reason over the whole company in 1M context across both tiers. Isolation, agents, tools, learning loops, and privacy architecture all carry over — with one added isolation rule (one Brain call = one company) and one added privacy disclosure (Brain reasoning runs on DeepSeek's API). The two-tier split also *lowers* cost risk vs all-Pro, because Flash absorbs the day's many shallow calls cheaply.
