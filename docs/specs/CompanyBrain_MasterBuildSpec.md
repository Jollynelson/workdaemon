# Company Brain — Master Build Specification

## For Claude Code · Definitive implementation brief · 2026

> **What this is.** A single, authoritative build spec that reconciles the two source documents — the *Company Brain* vision doc (the standalone, always-on, always-hunting superintelligence) and the *Implementation Guide* (Hermes 3 + Unsloth + Ollama + MCP + per-staff agents). Where the two documents conflict or leave gaps, this spec makes the call and says so explicitly. Build the files in the order in **Section 16 — Build order**. Do not skip the **Reality checks** in Section 2; they will save days of wasted work.
>
> **Production target (decided):** Cloud GPU rented on demand — **Modal** for training, **Modal GPU endpoints (or RunPod serverless)** for serving. No owned hardware. No always-on A100.

---

## 0. The one-paragraph summary

Each customer company gets an isolated Brain: a fine-tuned Hermes-3-Llama-3.1-8B model (`wd-{company_id}`), a per-company vector store, and a relational DB — all keyed by `company_id`. Every employee gets a personal Hermes Agent (same underlying model, unique system prompt + memory namespace + role-scoped tools). Tools connect via MCP. Every interaction is logged and feeds three learning loops (individual → role → company). A proactive Hunt engine scans continuously for threats, waste, opportunities, performance signals, and knowledge gaps, and pushes intelligence to the right agent. Every 48h the model re-fine-tunes on accumulated signals; a quality gate prevents deploying a worse model. Nothing ever crosses between companies.

---

## 1. Architecture — three layers

```
LAYER 1 — THE MODEL
  Hermes-3-Llama-3.1-8B (NousResearch base, agentic + tool-calling native)
    └─ Fine-tuned per company with Unsloth (QLoRA) → wd-{company_id}
    └─ Trained on Modal (on-demand T4/A10G), served via on-demand GPU

LAYER 2 — THE BRAIN
  Per-company knowledge + state, all scoped by company_id:
    └─ Vector store (pgvector to start; namespaces per company + per user)
    └─ Relational DB (Postgres): profiles, interactions, signals, hunts, model_versions
    └─ Live tool data (CRM, Slack, Finance, HR) via MCP connectors
    └─ Interaction logs from all agents (the unique learning channel)
    └─ Hunt engine (5 modes) running on a schedule

LAYER 3 — THE AGENTS
  One Hermes Agent per staff member:
    └─ Same wd-{company_id} model underneath
    └─ Unique system prompt (role, access level, live brain context)
    └─ Personal memory namespace (user_{user_id}_{company_id})
    └─ Role-scoped MCP tool permissions
    └─ Push inbox (Brain-initiated intelligence)
```

**The mental model from the vision doc, kept verbatim because it's right:** the Brain is the spine, the agents are the fingertips. The fingertips feel and act; the spine decides and learns from every touch. Concretely: the *model* provides language + tool-calling ability; the *Brain layer* provides truth, memory, and proactivity; the *agent layer* is per-person delivery and listening.

---

## 2. Reality checks — read before building

These reconcile the vision with what is actually buildable. **None of these reduce the ambition; they make it real.**

1. **"Standalone superintelligence" = a system, not a single magic model.** The vision doc describes a superintelligence. In practice that is the *combination* of (a) a capable fine-tuned model, (b) strong retrieval over complete company data, (c) the interaction-learning loops, and (d) the proactive hunt engine. No single component is "the intelligence." Build all four; the intelligence is emergent. Do not wait for a magic model — there isn't one.

2. **Fine-tuning teaches *behavior and language*, not *facts*.** A common and costly mistake the implementation guide flirts with: do **not** rely on fine-tuning to memorize company facts (who the Stripe contact is, what was decided Tuesday). Facts change daily and live in the **vector store**, injected at runtime (RAG). Fine-tune for: company tone, role behavior, tool-calling format, recurring reasoning patterns. **Facts → retrieval. Behavior → fine-tune.** This split is the single most important design decision in the whole system.

3. **"Real-time stream from every tool" starts as polling + webhooks.** True millisecond streaming from 10 SaaS tools is not where you start. Webhooks where available (Slack, GitHub), polling every 5–15 min where not. The Brain *feels* real-time to users without literally being event-streamed. Build the connector interface so you can upgrade individual tools to streaming later without touching the rest.

4. **Hermes Agent as a pip/Docker product may not exist as the guide assumes.** The guide references `pip install hermes-agent` and `nousresearch/hermes-agent:latest`. **Verify this exists at build time.** `Hermes-3-Llama-3.1-8B` (the *model*) definitely exists on Hugging Face. The *agent UI/runtime* likely does **not** ship as a turnkey package — assume you build the agent runtime yourself (Section 8) against the Ollama/Modal chat API. Treat any turnkey Hermes Agent package as a nice-to-have, not a dependency.

5. **On-demand serving has cold starts.** Rented GPU that spins down to save money has a 10–60s cold start. For an "always-on" feeling, either (a) keep one small warm serving instance per active company during business hours, or (b) fall back to a hosted API (Claude) for the first token while the GPU warms. Decision below in Section 7.

6. **The Hunt engine is scheduled jobs + LLM reasoning, not sentience.** "Every second the Brain asks itself…" → in practice, scheduled hunt jobs (every 15 min to hourly) that query tool data + interaction signals, run an LLM reasoning pass, and emit pushes. This delivers exactly the described behavior. Build it as jobs.

7. **Privacy is load-bearing, not a footnote.** The interaction-learning channel reads what staff tell their agent "like a trusted colleague." That is sensitive. Section 14 is mandatory, not optional: consent, access scoping, and the rule that surfaced insights never expose one named employee's private words to another.

---

## 3. Tech stack (decided)

| Concern | Choice | Notes |
|---|---|---|
| Base model | **NousResearch Hermes-3-Llama-3.1-8B** | Agentic + tool-calling native. Use Unsloth 4-bit variant for training. |
| Fine-tuning | **Unsloth + QLoRA** | 2x faster, ~60% less VRAM. Train adapter only. |
| Training compute | **Modal**, T4 (→ A10G at scale), on-demand | Spins up, trains, shuts down. |
| Serving | **Modal GPU endpoint** running Ollama or vLLM (→ RunPod serverless as alt) | On-demand; warm-pool during business hours. |
| Adapter storage | **Hugging Face private repo per company** | `wd-org/{company_id}-adapter`, versioned. |
| Vector store | **pgvector** (in the same Postgres) to start; Qdrant/Pinecone at scale | Namespaces: `company_{id}`, `user_{uid}_{id}`. |
| Relational DB | **Postgres** (Supabase or self-managed) | All tables carry `company_id`, RLS enforced. |
| Cache / queues | **Redis** | Push inbox, rate limits, hunt dedup. |
| Tool layer | **MCP servers**, one per tool | Slack, Notion, Google Drive, CRM, Finance, HR, etc. |
| Orchestration | **Python 3.11 + FastAPI** | API, agent runtime, hunt scheduler. |
| Scheduling | **Inngest** (or Celery beat) | Hunt jobs, 48h fine-tune cron, per-company fan-out. |
| Embeddings | **OpenAI text-embedding-3-small** (default) / `nomic-embed-text` self-hosted | Swappable; re-embed on change. |
| Eval | **Ragas** | Quality gate + answer scoring. |

---

## 4. Repository layout

```
company-brain/
├── README.md
├── pyproject.toml
├── .env.example                      # Section 15
├── docker-compose.yml                # local: postgres+pgvector, redis, ollama
├── modal/
│   ├── train_app.py                  # Modal app: fine-tuning function (GPU)
│   └── serve_app.py                  # Modal app: serving endpoint (GPU, warm pool)
├── src/
│   ├── config.py                     # env loading, constants, model naming
│   ├── db.py                         # Postgres client + scoped query helpers
│   ├── vectors.py                    # pgvector wrapper: namespaced search/upsert
│   ├── migrations/
│   │   └── 001_init.sql              # all tables (Section 5)
│   ├── model/
│   │   ├── naming.py                 # wd-{company_id}, repo names, namespaces
│   │   ├── registry.py               # HF push/pull adapters per company
│   │   └── router.py                 # route a call → company model or fallback
│   ├── finetune/
│   │   ├── dataset_builder.py        # signals → JSONL (behavior, not facts)
│   │   ├── formatters.py             # Hermes-3 chat-template formatting
│   │   ├── hyperparams.py            # central training config
│   │   ├── train.py                  # Unsloth QLoRA loop (runs on Modal)
│   │   └── gate.py                   # quality gate vs current deployed adapter
│   ├── brain/
│   │   ├── context.py                # assemble role/query context (RAG)
│   │   ├── memory.py                 # namespace create/seed/upsert/archive
│   │   ├── logger.py                 # interaction logging → 3 learning loops
│   │   ├── patterns.py               # systemic-pattern detection (cross-staff)
│   │   └── hunter.py                 # 5 hunt modes, push generation
│   ├── agents/
│   │   ├── profiles.py               # AgentProfile dataclass + persistence
│   │   ├── prompts.py                # system prompt builder (role-aware)
│   │   ├── factory.py                # spin_up / load_for_conversation / offboard
│   │   └── runtime.py                # the agent loop: prompt→model→tools→reflect
│   ├── push/
│   │   ├── inbox.py                   # per-user push inbox (Redis + DB)
│   │   └── delivery.py               # how/when pushes surface to each agent
│   ├── tools/
│   │   ├── registry.py               # tool list + role permissions
│   │   ├── base_mcp.py               # shared MCP server scaffolding
│   │   ├── mcp_slack.py
│   │   ├── mcp_notion.py
│   │   ├── mcp_gdrive.py
│   │   ├── mcp_crm.py
│   │   └── mcp_finance.py
│   ├── ingestion/
│   │   ├── connectors/               # one per tool; poll or webhook → normalize
│   │   ├── normalize.py              # → standard document format
│   │   └── pipeline.py               # chunk → embed → upsert (per company)
│   ├── api/
│   │   ├── main.py                   # FastAPI app
│   │   ├── routes/agents.py
│   │   ├── routes/brain.py
│   │   ├── routes/staff.py
│   │   └── websocket.py              # real-time push to agent UIs
│   └── orchestration/
│       ├── inngest_functions.py      # hunt cron, 48h fine-tune cron, fan-out
│       └── run_company_finetune.py   # end-to-end finetune for one company
├── scripts/
│   ├── seed_company.py               # create a test company + fake staff/data
│   ├── seed_signals.py               # fake interactions to test learning/finetune
│   └── run_one_finetune.py           # manual single-company finetune (testing)
└── tests/
    ├── test_isolation.py             # CRITICAL: no cross-company leakage
    ├── test_dataset_builder.py
    ├── test_formatters.py
    ├── test_gate.py
    ├── test_permissions.py           # role → tool access
    └── test_patterns.py
```

---

## 5. Data model (Postgres) — `migrations/001_init.sql`

**Every table has `company_id UUID NOT NULL`. Enable Row-Level Security; every query filters by `company_id`.** This is the structural backbone of isolation.

```sql
-- companies
create table companies (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  slug        text unique not null,         -- used in wd-{slug} if preferred over uuid
  tier        text not null default 'pro',  -- free | pro | enterprise
  created_at  timestamptz not null default now()
);

-- staff + their agent profiles
create table staff (
  id            uuid primary key default gen_random_uuid(),
  company_id    uuid not null references companies(id),
  name          text not null,
  email         text not null,
  role          text not null,              -- e.g. "Operations Lead"
  department    text not null,
  access_level  text not null,              -- junior | manager | director | executive
  tenure_start  date,
  status        text not null default 'active',  -- active | inactive
  created_at    timestamptz not null default now(),
  unique (company_id, email)
);

create table agent_profiles (
  id                uuid primary key default gen_random_uuid(),
  company_id        uuid not null references companies(id),
  staff_id          uuid not null references staff(id),
  memory_namespace  text not null,          -- user_{staff_id}_{company_id}
  permitted_tools   jsonb not null default '[]',
  system_prompt     text,                   -- cached; rebuilt with fresh context per convo
  trust_score       float not null default 1.0,
  interaction_count int not null default 0,
  last_active       timestamptz,
  status            text not null default 'active',
  created_at        timestamptz not null default now(),
  unique (company_id, staff_id)
);

-- interactions (the unique learning channel)
create table interactions (
  id                  uuid primary key default gen_random_uuid(),
  company_id          uuid not null references companies(id),
  staff_id            uuid not null references staff(id),
  role                text not null,
  user_message        text not null,
  agent_response      text not null,
  tools_called        jsonb default '[]',
  context_used        jsonb,                -- which chunks were injected
  suggestion_acted_on boolean,             -- null = n/a, true/false = trust signal
  sentiment           text,                 -- extracted: frustrated|neutral|positive|...
  created_at          timestamptz not null default now()
);
create index on interactions (company_id, created_at);
create index on interactions (company_id, staff_id, created_at);

-- training signals derived from interactions + feedback (for fine-tune dataset)
create table training_signals (
  id              uuid primary key default gen_random_uuid(),
  company_id      uuid not null references companies(id),
  interaction_id  uuid references interactions(id),
  kind            text not null,            -- positive_pair | critique_correction | terminology | role_behavior
  prompt          text not null,            -- user turn (or synthetic)
  target          text not null,            -- ideal assistant turn
  score           float,                    -- quality 0..1 (ragas/thumbs/self-critique)
  used_in_version int,                       -- which model_versions.version consumed it (null = unused)
  created_at      timestamptz not null default now()
);
create index on training_signals (company_id, created_at);

-- company terminology (extracted on ingestion; teaches company language)
create table company_terminology (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null references companies(id),
  term        text not null,
  definition  text not null,
  source      text,
  created_at  timestamptz not null default now()
);

-- hunt findings + pushes
create table hunt_findings (
  id            uuid primary key default gen_random_uuid(),
  company_id    uuid not null references companies(id),
  mode          text not null,              -- threat | waste | opportunity | performance | knowledge
  title         text not null,
  detail        text not null,
  evidence      jsonb,                       -- the data/interaction signals behind it
  confidence    float not null default 0.5,
  target_role   text,                        -- which role this is for
  target_staff  uuid references staff(id),  -- optional specific person
  status        text not null default 'open', -- open | pushed | acted | dismissed
  created_at    timestamptz not null default now()
);
create index on hunt_findings (company_id, status, created_at);

create table pushes (
  id            uuid primary key default gen_random_uuid(),
  company_id    uuid not null references companies(id),
  staff_id      uuid not null references staff(id),
  finding_id    uuid references hunt_findings(id),
  message       text not null,              -- the calibrated push text
  recommended_action text,
  delivered_at  timestamptz,
  acted_on      boolean,
  created_at    timestamptz not null default now()
);
create index on pushes (company_id, staff_id, created_at);

-- per-company model versions (audit + rollback)
create table model_versions (
  id            uuid primary key default gen_random_uuid(),
  company_id    uuid not null references companies(id),
  version       int not null,
  hf_repo       text not null,
  hf_revision   text not null,
  eval_score    float,
  base_score    float,                      -- score of prior deployed (or base) model
  deployed      boolean not null default false,
  num_examples  int,
  trained_at    timestamptz not null default now(),
  unique (company_id, version)
);
```

---

## 6. The fine-tuning pipeline (behavior, not facts)

### 6.1 What we fine-tune on — and what we DON'T

| Fine-tune on (behavior) | Keep in retrieval (facts) |
|---|---|
| Company tone & voice | Current deals, numbers, deadlines |
| Role-appropriate response style | Who's who, who owns what (changes) |
| Hermes tool-calling format & tool choices | Document contents |
| Recurring reasoning patterns (how the company thinks) | Anything dated or volatile |
| Company terminology *usage* (not as a fact store) | Live tool data |

If a fact would be wrong tomorrow, it must not be baked into weights. The gate (6.5) will catch a model that has memorized stale facts and started hallucinating them.

### 6.2 Dataset builder (`finetune/dataset_builder.py`)

Build a per-company JSONL from `training_signals` (which the logger + ingestion populate). Sources, in priority:

1. **positive_pair** — interactions with `suggestion_acted_on = true`, thumbs-up, or Ragas ≥ 0.8. Prompt = user message; target = the agent response as given.
2. **critique_correction** — where a self-critique produced a better answer; target = the improved answer.
3. **role_behavior** — curated/synthetic examples of ideal role behavior (CEO brief tone, junior guidance tone). Seed a starter set per role; grow from real positives.
4. **terminology** — from `company_terminology`: "How do we use the term {term}?" → "{definition}". Keep these few; they teach usage, not fact-recall.

Rules: dedupe near-identical prompts; drop targets < 5 tokens; **split out a 10% held-out eval set before formatting** (never train on it); if total < `MIN_EXAMPLES_TO_TRAIN` (default 50), skip this cycle and log.

### 6.3 Formatter (`finetune/formatters.py`)

Format every example with the **Hermes-3 chat template** via `tokenizer.apply_chat_template(...)`. Hermes 3 uses ChatML-style `<|im_start|>`/`<|im_end|>` turns. Keep all prompt strings here. System prompt for training examples should mirror the runtime agent system prompt shape so behavior transfers.

### 6.4 Training (`finetune/train.py` + `modal/train_app.py`)

QLoRA via Unsloth, runs **inside Modal** on a T4 (bump to A10G on OOM or at scale). Hyperparameters in `hyperparams.py`:

```python
HYPERPARAMS = {
  "max_seq_length": 8192,        # Hermes 3 handles long context; matches serving num_ctx
  "lora_r": 16, "lora_alpha": 16, "lora_dropout": 0.0,
  "target_modules": ["q_proj","k_proj","v_proj","o_proj","gate_proj","up_proj","down_proj"],
  "per_device_train_batch_size": 2, "gradient_accumulation_steps": 4,
  "num_train_epochs": 2,         # 2 over 3: small data + 48h cadence; avoids forgetting
  "learning_rate": 2e-4, "warmup_ratio": 0.05,
  "lr_scheduler_type": "cosine", "weight_decay": 0.01,
  "optim": "adamw_8bit", "seed": 3407,
}
```

> **Note vs the implementation guide:** the guide used `num_epochs=3`. Lowered to **2** because we re-train every 48h on overlapping data — 3 epochs repeatedly risks catastrophic forgetting of Hermes's agentic ability. The gate will tell you empirically; treat 2 as the safe default and tune up only if the gate shows headroom.

Training outline (verify exact Unsloth/Modal APIs at build time — they drift):

```python
# modal/train_app.py  (conceptual)
import modal
image = (modal.Image.debian_slim(python_version="3.11")
         .pip_install("unsloth","trl","transformers","datasets",
                      "huggingface_hub","peft","accelerate","bitsandbytes","psycopg2-binary"))
app = modal.App("company-brain-train")

@app.function(image=image, gpu="T4", timeout=3*60*60,
              secrets=[modal.Secret.from_name("company-brain-secrets")])
def finetune(company_id: str, jsonl_bytes: bytes) -> dict:
    # 1. write jsonl to /tmp
    # 2. FastLanguageModel.from_pretrained(BASE_MODEL, max_seq_length, load_in_4bit=True)
    # 3. get_peft_model(...) with HYPERPARAMS
    # 4. dataset.map(apply_chat_template) ; SFTTrainer(...).train()
    # 5. model.save_pretrained(adapter_dir)  # adapter only
    # 6. registry.push(company_id, adapter_dir, version) -> revision
    # 7. return {version, revision, num_examples}
```

### 6.5 Quality gate (`finetune/gate.py`) — never deploy a worse model

1. Generate answers for the held-out eval prompts with **current deployed adapter** (or base, for first run) and with the **new adapter**.
2. Score both with Ragas (faithfulness + answer relevancy) against known-good targets → `base_score`, `eval_score`.
3. Deploy the new adapter **only if `eval_score >= base_score - 0.01`**. Otherwise keep the old one, mark `deployed=false`, log, retry next cycle with more data.
4. Write a `model_versions` row every run regardless (audit trail).

### 6.6 Serving the per-company model (`model/router.py` + `modal/serve_app.py`)

- `model/naming.py`: `wd_model(company_id) -> "wd-{company_id}"`, `adapter_repo(company_id)`, namespaces.
- `router.py`: given `company_id`, route the chat call to that company's served model. **Fallback order:** (1) warm company model on Modal, (2) cold-start it, (3) while warming, answer first token from a hosted Claude API call using the same system prompt + injected context (covers the cold-start gap from Reality Check 5). Companies with no passing adapter yet use base Hermes 3 + RAG.
- Serving runs Ollama (simple) or vLLM (higher throughput) inside a Modal GPU function with a **warm pool during business hours** per active company; scale to zero off-hours.

---

## 7. Cold-start & "always-on" feel (decided)

Because we chose on-demand GPUs:
- **Business hours:** keep 1 warm serving replica per *active* company (queried in last N minutes). Cheap on T4/A10G.
- **Off hours / idle:** scale to zero. First request triggers cold start; serve the first response via Claude fallback so the user never waits 60s.
- **Hunts** run regardless of warm state — they batch, so cold start cost is amortized.

This delivers the vision's "always-on, never sleeps" experience without paying for 24/7 GPUs.

---

## 8. The agent layer

### 8.1 Profiles & factory (`agents/profiles.py`, `agents/factory.py`)
Per the implementation guide, largely as written. `AgentFactory.spin_up(staff)`:
1. Fetch role context from Brain (RAG).
2. Build role-aware system prompt.
3. Create + seed personal memory namespace `user_{staff_id}_{company_id}`.
4. Persist `agent_profiles` row with role-scoped `permitted_tools`.
5. Register with Brain.

`load_for_conversation(staff_id)` rebuilds the system prompt with **fresh** context at the start of every conversation (facts come from retrieval, never stale weights). `offboard(staff_id)` deactivates login + revokes tools but **archives** (not deletes) the memory namespace — the company model retains learned patterns, while the individual's raw words stop being actively surfaced (privacy, Section 14).

### 8.2 System prompt (`agents/prompts.py`)
Role-aware builder. Inject: identity ("you are the Company Brain of {company}, speaking to {name}"), user role/department/access, **live brain context block**, authorized tools, behavior rules (call tools, don't guess; flag risks/opportunities for this role; never reveal what this access level can't see). Use Hermes tool-calling format (`<tool_call>{...}</tool_call>`).

### 8.3 Agent runtime (`agents/runtime.py`) — build this yourself
Do not assume a turnkey Hermes Agent package (Reality Check 4). The loop:
1. `load_for_conversation` → system prompt + permitted MCP tools.
2. Retrieve query-specific context (`brain/context.py:get_for_query`).
3. Call `wd-{company_id}` via `router.py` with messages + tool schemas.
4. Parse `<tool_call>`; execute via the permitted MCP server; feed `<tool_response>` back; loop until final answer.
5. Surface any pending **pushes** for this user (Section 10).
6. Log the full interaction (Section 9).

---

## 9. Interaction logging & the three learning loops (`brain/logger.py`)

Every interaction writes to all three levels (this is the vision doc's meta-learning loop, made concrete):

1. **Individual** — upsert the exchange into `user_{staff_id}_{company_id}` so the agent gets better for this person; update `trust_score` from `suggestion_acted_on`.
2. **Role** — contribute anonymized patterns to a role index so new hires in that role start calibrated.
3. **Company** — upsert extracted patterns into `company_{company_id}`; run **systemic-pattern detection** (`brain/patterns.py`): if ≥ 3 staff ask semantically similar things in 30 days, create a `hunt_findings` row (Knowledge/Waste hunt) and escalate.

Also, each qualifying interaction emits a `training_signals` row for the next fine-tune. **Sentiment, tone, time-of-day, repetition, push-back** are all extracted per the vision doc's "what the Brain reads from every interaction" table.

---

## 10. The Hunt engine + Push system (`brain/hunter.py`, `push/`)

### 10.1 Five hunt modes (scheduled jobs)
Each mode is a scheduled job (every 15 min–1 hr) that pulls the relevant signals, runs an LLM reasoning pass with retrieved context, and writes `hunt_findings`:

- **Threat** — churn signals (CRM), cash danger (finance), staff dissatisfaction (interaction sentiment), security/legal anomalies.
- **Waste** — redundant steps, duplicated work, unused paid tools, meetings-that-could-be-messages, low-value time (surfaced via what staff ask).
- **Opportunity** — upsell signals, partnership angles, underutilized talent, expansion openings.
- **Performance** — over/under-performers, processes worth replicating, enriched by interaction data.
- **Knowledge** — gaps exposed when staff repeatedly ask things that should be documented/known.

### 10.2 Pushes (`push/inbox.py`, `push/delivery.py`)
A finding with sufficient `confidence` and a `target_role`/`target_staff` becomes a `pushes` row: calibrated message + recommended action + draft artifact (e.g., draft Slack/Notion update). Delivery rules: respect the user's demonstrated trust/frequency preferences (back off if they ignore a push type — the vision's "Never mind, I'll do it the old way" example). Surfaced via the agent runtime and/or websocket. Track `acted_on` to feed trust calibration and the next fine-tune.

> **Push examples to replicate** (from the vision doc): the Sales churn-risk flag, the Operations Step-3 bottleneck, the CEO 7am briefing, the HR burnout/flight-risk signal. Use these as golden test cases for the hunt+push pipeline.

---

## 11. Tools via MCP (`tools/`)

One MCP server per tool, sharing `base_mcp.py` scaffolding. Each exposes read + (where safe) write tools. **`tools/registry.py` enforces role→tool permissions** — the agent only ever sees the tools its user's access level allows. Permission map (from the guide):

- executive: all tools
- director: slack, notion, gdrive, crm, finance, hr, project, dept reports
- manager: slack, notion, gdrive, crm, project, team reports
- junior: slack, notion, gdrive, email, assigned projects

Build Slack + Notion + Google Drive first (cover most companies), then CRM + Finance. Write actions (send message, update page, send email) require the same care as the rest of the system: destructive or outbound actions should be drafted for human confirmation unless the user has explicitly granted autonomy.

---

## 12. Ingestion (`ingestion/`)

Connector interface: `poll()` or `on_webhook()` → `normalize()` → standard doc → `pipeline.py` chunks (256–512 tokens, 64 overlap), embeds, upserts into `company_{id}` namespace. Extract entities/terminology on the way in (writes `company_terminology`). Default cadence 15 min; webhooks where available. Build the interface so a single tool can be upgraded to streaming later without touching others (Reality Check 3).

Standard document format:
```json
{ "source":"slack","type":"message","author":"amara@acme.com",
  "timestamp":"ISO8601","content":"...","metadata":{...},"company_id":"UUID" }
```

---

## 13. Multi-company isolation (`tests/test_isolation.py` is mandatory)

- Model: `wd-{company_id}` per company; adapters in separate private HF repos.
- Vectors: `company_{id}` and `user_{uid}_{id}` namespaces; **no global namespace.**
- DB: every row carries `company_id`; RLS on; every query filters it.
- A test must attempt a cross-company read at every layer (DB, vectors, model routing, tool calls) and assert it returns nothing / is rejected. **This test passing is a release gate.**

---

## 14. Privacy & security (mandatory)

- **Consent & transparency:** staff must know interaction data trains the Brain. Surface this in the agent UI.
- **Asymmetric surfacing:** the Brain *sees* an individual's words; agents *surface* only role-appropriate, and never expose one named employee's private statements to another. HR-style signals (burnout/flight risk) go to authorized roles only, framed as patterns + recommended care, not raw quotes.
- **Access scoping:** the system prompt + tool registry enforce what each user can see; the model never returns data the user's access level forbids.
- **Audit:** every query, push, tool call, ingestion event logged, timestamped, per-company auditable.
- **Secrets:** never log `HF_TOKEN`, DB creds, tool tokens, `ENCRYPTION_KEY`. Load from Modal Secrets in prod. Encrypt BYO tool tokens at rest.
- **Offboarding:** archive (don't expose) departed staff's individual namespace; retain only anonymized company-level patterns.

---

## 15. Environment variables (`.env.example`)

```bash
# MODEL
BASE_MODEL=unsloth/Hermes-3-Llama-3.1-8B-bnb-4bit
HF_TOKEN=                      # write scope, for per-company adapter repos
HF_ORG=company-brain

# TRAINING (defaults; override per company if needed)
MAX_SEQ_LENGTH=8192
LORA_R=16
LORA_ALPHA=16
LEARNING_RATE=2e-4
NUM_EPOCHS=2
MIN_EXAMPLES_TO_TRAIN=50
TRAINING_WINDOW_HOURS=48

# MODAL
MODAL_ENVIRONMENT=main         # auth via `modal token set` / Modal Secrets in prod

# SERVING / FALLBACK
SERVE_BACKEND=ollama           # ollama | vllm
WARM_POOL_BUSINESS_HOURS=true
ANTHROPIC_API_KEY=             # cold-start fallback + (optional) critique generation

# EMBEDDINGS
EMBEDDING_MODEL=text-embedding-3-small
OPENAI_API_KEY=                # if using OpenAI embeddings

# DATA
POSTGRES_URL=postgresql://localhost:5432/company_brain
REDIS_URL=redis://localhost:6379
VECTOR_BACKEND=pgvector        # pgvector | qdrant | pinecone

# SCHEDULING
INNGEST_EVENT_KEY=
INNGEST_SIGNING_KEY=

# TOOL INTEGRATIONS (per company; store encrypted, never log)
SLACK_BOT_TOKEN=
NOTION_TOKEN=
GOOGLE_SERVICE_ACCOUNT_KEY=./keys/google.json
SALESFORCE_CLIENT_ID=
SALESFORCE_CLIENT_SECRET=
QUICKBOOKS_TOKEN=

# SECURITY
JWT_SECRET=
ENCRYPTION_KEY=
```

---

## 16. Build order (sequence — each step independently testable)

1. **Skeleton + config + DB.** `pyproject.toml`, `.env.example`, `config.py`, `db.py`, `migrations/001_init.sql`. Stand up Postgres+pgvector+Redis via `docker-compose`.
2. **Isolation primitives.** `model/naming.py`, `vectors.py` (namespaced), `tests/test_isolation.py` (write it now, keep it green forever).
3. **Seed scripts.** `scripts/seed_company.py`, `seed_signals.py` — create 2 fake companies, staff, fake interactions. Everything downstream tests against these.
4. **Fine-tune offline path (no GPU yet).** `formatters.py`, `dataset_builder.py`, unit tests. Confirm JSONL is correct, eval split is clean, facts aren't leaking into targets.
5. **Adapter registry.** `model/registry.py` — push/pull to private HF repo. Test with a dummy adapter folder.
6. **Training on Modal.** `hyperparams.py`, `finetune/train.py`, `modal/train_app.py`. Run `scripts/run_one_finetune.py` for one fake company end-to-end (~$1–2 of T4).
7. **Gate.** `finetune/gate.py` + Ragas. Prove a deliberately-bad adapter is rejected.
8. **Serving + router.** `modal/serve_app.py`, `model/router.py` with Claude cold-start fallback. Get a chat response from `wd-{company_id}`.
9. **Brain context + memory.** `brain/context.py`, `brain/memory.py`. Role context + query context via RAG.
10. **Agent layer.** `agents/profiles.py`, `prompts.py`, `factory.py`, `runtime.py`. One staff member can chat, tools stubbed.
11. **Tools via MCP.** `tools/registry.py`, `base_mcp.py`, then Slack, Notion, Google Drive; CRM + Finance after. `tests/test_permissions.py` green.
12. **Logging + learning loops.** `brain/logger.py`, `brain/patterns.py`. Confirm interactions write all three levels + emit training signals.
13. **Hunt + push.** `brain/hunter.py`, `push/inbox.py`, `push/delivery.py`. Replicate the 4 golden push examples from the vision doc as tests.
14. **Ingestion.** `ingestion/` connectors + pipeline; wire one real tool (Notion) end-to-end into the vector store.
15. **API + websocket.** `api/` routes + real-time push.
16. **Orchestration.** `orchestration/inngest_functions.py`: hunt cron, 48h fine-tune cron, per-company fan-out (cap concurrency, e.g. 3–5 GPUs at once).
17. **Full dry run:** 2 fake companies → ingest → chat → log → hunt → push → 48h finetune → gate → deploy → isolation test still green.

---

## 17. Acceptance criteria

- [ ] `tests/test_isolation.py` passes: no cross-company leakage at DB, vector, model, or tool layer.
- [ ] A new staff member is fully spun up (profile + namespace + role tools + working chat) in one `factory.spin_up` call.
- [ ] Fine-tune dataset contains **behavior**, not volatile facts; eval set never overlaps training set.
- [ ] Each company's adapter lands in its own **private** HF repo, versioned; `model_versions` has a full audit trail.
- [ ] Quality gate blocks any adapter scoring worse than the currently deployed one (or base, first run).
- [ ] A query to `wd-{company_id}` uses that company's deployed adapter; cold start is masked by Claude fallback; no-adapter companies fall back to base + RAG cleanly.
- [ ] Interaction logging updates individual + role + company levels and emits training signals.
- [ ] ≥ 3 similar questions across staff in 30 days auto-creates a hunt finding.
- [ ] The four golden push scenarios (sales churn, ops bottleneck, CEO brief, HR burnout) generate correct findings + calibrated pushes in tests.
- [ ] Role permissions enforced: a junior agent cannot call finance/HR tools.
- [ ] Privacy: an individual's raw words are never surfaced to another named user; offboarded staff namespaces are archived, not exposed.
- [ ] One T4 fine-tune for ~200 examples completes under ~2 hours.

---

## 18. Cost model (on-demand, per company / month)

| Item | Est. |
|---|---|
| Modal training (T4, ~2h × ~15 runs) | ~$9 |
| Modal serving (warm business hours, T4/A10G, scale-to-zero off-hours) | ~$20–60 (varies with usage) |
| HF private adapter storage | ~$1 |
| Embeddings (OpenAI small) | ~$1–5 |
| Claude cold-start fallback | usage-based, small |
| Postgres + Redis (shared infra, amortized) | low per-company |
| **Unsloth, Hermes 3 weights, Ollama/vLLM** | Free |

Fine-tuning itself stays ~$10/company/mo; serving is the variable cost and the lever you tune with warm-pool policy.

---

## 19. Where this spec deliberately departs from the source docs

1. **Facts → retrieval, behavior → fine-tune** (the docs blur this; this spec enforces it). Single biggest correctness decision.
2. **Epochs 3 → 2** for the repeated 48h cadence, to avoid eroding Hermes's agentic ability; gate empirically.
3. **Build the agent runtime yourself**; don't depend on a turnkey `hermes-agent` package that may not exist as described.
4. **On-demand serving + Claude cold-start fallback** to deliver "always-on" feel without 24/7 GPU spend (your stated production choice).
5. **Quality gate + held-out eval added** (absent in the guide) so continuous self-fine-tuning can never silently make a company's Brain worse.
6. **Privacy made load-bearing** (Section 14), because the interaction-learning channel is the system's most sensitive surface.

Everything else follows the two source documents faithfully — the three layers, Hermes 3 + Unsloth + Ollama, per-staff agents, MCP tools, five hunt modes, the push system, three-level interaction learning, and total per-company isolation.
