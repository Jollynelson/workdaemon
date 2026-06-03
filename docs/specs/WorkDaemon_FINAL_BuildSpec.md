# WorkDaemon — Company Brain
## FINAL Master Build Specification

> **This document supersedes all previous specs.** It merges the original master spec, both change specs, the Hermes API architecture, Brain visibility, and the full cross-agent system into one complete, Claude Code–ready brief. Build in the order in Section 18. Do not skip Section 2 — the reality checks will save days.

---

## 0. The one-paragraph summary

Each customer company gets an isolated Brain: a DeepSeek V4 two-tier reasoning layer (Pro for deep analysis, Flash for real-time), a per-company VPS running one Hermes Agent instance per staff member (MIT licensed, free, OpenAI-compatible API), a vector store, a knowledge graph, and a relational DB — all scoped by `company_id`. Every employee gets a personal Hermes agent with their own profile, memory namespace, and role-scoped MCP tools. Staff chat exclusively through WorkDaemon's webapp (Daemon Chat). Hermes is invisible infrastructure. The Brain watches every agent interaction in real time, builds a live company activity feed, detects cross-staff patterns, and pushes intelligence to the right agent proactively. Agents coordinate with each other — PM assigns to Designer, Designer hands off to Dev — entirely through the Brain's routing layer. One agent's output becomes another's input automatically. Nothing crosses between companies. Users never see Hermes, DeepSeek, or anything underneath WorkDaemon.

---

## 1. Three-layer architecture

```
LAYER 1 — THE BRAIN (DeepSeek V4, two tiers)
  V4 Pro  (49B active, 1M ctx, Thinking ON)
    → nightly deep analysis, strategic hunts,
      complex technical reasoning, hard patterns
  V4 Flash (13B active, 1M ctx, Thinking optional)
    → real-time signal triage, instant push alerts,
      cross-agent routing decisions, moderate technical
    → Flash escalates to Pro when confidence is low
  Brain sees: ALL agent interactions, ALL tool calls,
              ALL outputs, ALL inter-agent messages
              → live company activity feed

LAYER 2 — THE AGENTS (Hermes Agent, one per staff member)
  Real Hermes Agent product (MIT licensed, free)
    → per-staff profile + memory namespace
    → role-scoped MCP tools
    → OpenAI-compatible API server on company VPS
    → provider = DeepSeek V4 Flash (agent chat)
    → staff connect tools through WorkDaemon UI
      (Hermes config written by backend, never seen by staff)
  Cross-agent layer (Brain-mediated):
    → Agent A → Brain → Agent B (task handoff)
    → Brain routes findings to right agent automatically
    → Agent output → Brain → Agent input pipeline

LAYER 3 — THE INTERFACE (WorkDaemon, what users actually see)
  Daemon Chat webapp (Next.js)
    → the ONLY way staff interact with their agent
    → Hermes is invisible, DeepSeek is invisible
    → push inbox, activity feed, task board
    → tool connection UI (writes to Hermes config silently)
  Optional bridges (WorkDaemon-branded):
    → Telegram, WhatsApp etc. proxied through backend
    → staff see WorkDaemon, never Hermes
```

---

## 2. Reality checks — read before building

1. **Hermes Agent is MIT licensed and completely free.** The API server (`API_SERVER_ENABLED=true`) costs nothing. You pay only for DeepSeek tokens. No paid Hermes tier exists.

2. **The API server is OpenAI-compatible.** `POST /v1/chat/completions` to `http://localhost:{port}/v1`. Standard streaming. Your FastAPI backend calls it exactly like any LLM API. No special SDK.

3. **One Hermes profile per staff member, one port per profile.** Each profile is a separate Hermes gateway with its own API server port, its own memory namespace (SQLite), its own MCP tool config. Your backend maps `staff_id → port + api_key`. Isolation is structural, not policy.

4. **Staff never configure Hermes.** They connect GitHub in WorkDaemon's settings UI. Your backend writes the MCP server config to that staff member's `~/.hermes/` profile directory and calls `hermes -p {profile} reload-mcp`. Done. Staff see "GitHub connected." Hermes is invisible.

5. **The Brain's visibility into agents is a logging and event bus problem, not an AI problem.** Every Hermes API call goes through your FastAPI backend. Your backend logs every request/response to the `interactions` table and emits an event to the activity feed bus (Redis pub/sub). The Brain reads from this feed — it doesn't need special access to Hermes internals.

6. **Cross-agent interaction is Brain-mediated routing, not direct agent-to-agent.** Agent A never calls Agent B directly. PM's agent tells the Brain "assign checkout redesign to Sarah." Brain creates a task, writes it to the `tasks` table, and delivers it to Sarah's agent's push inbox. Sarah's agent picks it up at her next interaction or via websocket push. Clean, auditable, isolated.

7. **Facts → retrieval. Behavior → fine-tune (optional).** The fine-tuning pipeline from the previous spec is now truly optional — it only buys you company-specific agent behavior (tone, role patterns). The Brain's intelligence comes from the DeepSeek layer + retrieval. Ship without fine-tuning; add it later if the product needs the moat.

8. **One VPS per company, not one server globally.** Each company's Hermes instances, MCP tools, and agent data live on their own VPS. WorkDaemon's FastAPI backend and Brain layer are shared infrastructure. Data never crosses companies structurally.

---

## 3. Tech stack

| Concern | Choice | Notes |
|---|---|---|
| Brain — deep tier | **DeepSeek V4 Pro API** | Nightly analysis, strategic hunts, hard patterns, complex technical |
| Brain — fast tier | **DeepSeek V4 Flash API** | Real-time triage, cross-agent routing, push drafting, moderate technical |
| Brain — escalation | Flash → Pro auto-escalate | On low confidence or detected complexity |
| Agent runtime | **Hermes Agent** (MIT, free) | Real product, one profile per staff member |
| Agent model provider | **DeepSeek V4 Flash** | Set via `hermes model` on each profile |
| Agent API | **Hermes API server** | OpenAI-compatible, `POST /v1/chat/completions` |
| Agent serving | **Company VPS** (Hetzner/DO) | ~$10-20/mo per company, no GPU |
| Webapp interface | **Next.js** | Daemon Chat — the only staff-facing UI |
| Backend | **Python 3.11 + FastAPI** | Agent proxy, Brain orchestration, event bus |
| Activity feed bus | **Redis pub/sub** | Every agent interaction → Brain in real time |
| Cross-agent bus | **Redis + Postgres tasks** | Task handoffs, Brain routing, output pipelines |
| Vector store | **Supabase pgvector** → Qdrant at scale | Per-company namespace |
| Knowledge graph | **Neo4j** (or Postgres recursive) | People, decisions, projects, relationships |
| Relational DB | **Postgres** (Supabase) | All tables carry `company_id`, RLS enforced |
| Embeddings | **OpenAI text-embedding-3-small** | Swappable |
| Evaluation | **Ragas** | Answer quality scoring |
| Observability | **LangSmith** | Trace every Brain call |
| Scheduling | **Inngest** | Hunt cron, nightly analysis, per-company fan-out |
| Self-optimisation | **DSPy** | Brain rewrites its own retrieval strategies |
| Live web learning | **Tavily + Firecrawl** | Brain watches world news per company |
| Fine-tuning (optional) | **Unsloth + Modal + Llama 3.1 8B** | Add later for behavioral moat |

---

## 4. Repository layout

```
workdaemon/
├── README.md
├── pyproject.toml
├── .env.example                          # Section 17
├── docker-compose.yml                    # local: postgres+pgvector, redis, neo4j
│
├── webapp/                               # Next.js — Daemon Chat
│   ├── app/
│   │   ├── chat/[staffId]/page.tsx       # per-staff Daemon Chat UI
│   │   ├── dashboard/page.tsx            # company activity feed
│   │   ├── tasks/page.tsx                # task board (cross-agent tasks)
│   │   └── settings/tools/page.tsx       # tool connection UI
│   ├── components/
│   │   ├── DaemonChat.tsx                # streaming chat component
│   │   ├── PushInbox.tsx                 # Brain push alerts
│   │   ├── ActivityFeed.tsx              # live company feed
│   │   └── TaskCard.tsx
│   └── lib/
│       ├── api.ts                        # calls WorkDaemon FastAPI
│       └── websocket.ts                  # real-time push + feed
│
├── src/
│   ├── config.py
│   ├── db.py                             # Postgres client + scoped helpers
│   ├── vectors.py                        # pgvector namespaced wrapper
│   ├── migrations/
│   │   └── 001_init.sql                  # all tables (Section 5)
│   │
│   ├── hermes/
│   │   ├── client.py                     # calls Hermes API server per profile
│   │   ├── provisioner.py                # spin_up / offboard / reload_mcp
│   │   ├── profile_manager.py            # create/load/list profiles on VPS
│   │   └── mcp_writer.py                 # write MCP config to profile dir
│   │
│   ├── agents/
│   │   ├── profiles.py                   # AgentProfile dataclass + DB persistence
│   │   ├── factory.py                    # spin_up / load / offboard
│   │   ├── prompts.py                    # system prompt builder (role-aware)
│   │   ├── tool_permissions.py           # role → permitted MCP tools
│   │   └── proxy.py                      # FastAPI routes that proxy to Hermes API
│   │
│   ├── brain/
│   │   ├── router.py                     # classify → Flash / Pro / escalate
│   │   ├── context.py                    # assemble RAG context for queries
│   │   ├── memory.py                     # vector namespace create/seed/upsert
│   │   ├── graph.py                      # Neo4j: people, decisions, projects
│   │   ├── logger.py                     # every interaction → 3 learning loops
│   │   ├── activity_feed.py              # Redis pub/sub: emit + consume events
│   │   ├── patterns.py                   # cross-staff pattern detection
│   │   ├── hunter.py                     # 5 hunt modes (Flash/Pro by depth)
│   │   └── self_optimise.py              # DSPy prompt optimisation loop
│   │
│   ├── cross_agent/
│   │   ├── task_router.py                # Brain routes tasks between agents
│   │   ├── handoff.py                    # output → input pipeline (A→Brain→B)
│   │   ├── coordinator.py                # multi-agent task orchestration
│   │   └── bus.py                        # Redis cross-agent event bus
│   │
│   ├── push/
│   │   ├── inbox.py                      # per-staff push inbox (Redis + DB)
│   │   ├── delivery.py                   # when/how to surface pushes
│   │   └── calibration.py                # back-off if staff ignores push type
│   │
│   ├── ingestion/
│   │   ├── connectors/                   # one per tool (Notion, Slack, Drive...)
│   │   ├── normalize.py                  # → standard document format
│   │   ├── pipeline.py                   # chunk → embed → upsert
│   │   └── entity_extractor.py           # extract people/decisions/terms on ingest
│   │
│   ├── tools/
│   │   ├── registry.py                   # tool catalogue + role permissions
│   │   └── mcp_configs/                  # MCP server config templates per tool
│   │       ├── notion.yaml
│   │       ├── github.yaml
│   │       ├── gdrive.yaml
│   │       ├── slack.yaml
│   │       └── crm.yaml
│   │
│   ├── api/
│   │   ├── main.py                       # FastAPI app
│   │   ├── routes/
│   │   │   ├── chat.py                   # proxy to Hermes + log + feed emit
│   │   │   ├── agents.py                 # agent management
│   │   │   ├── tasks.py                  # cross-agent tasks
│   │   │   ├── tools.py                  # tool connect/disconnect
│   │   │   ├── brain.py                  # Brain query endpoint
│   │   │   └── staff.py                  # staff management
│   │   └── websocket.py                  # real-time: pushes, feed, task updates
│   │
│   └── orchestration/
│       ├── inngest_functions.py          # cron: hunts, nightly Brain, ingestion
│       └── vps_manager.py                # provision/deprovision company VPS
│
├── scripts/
│   ├── seed_company.py                   # create test company + staff + data
│   ├── seed_interactions.py              # fake agent interactions for testing
│   └── provision_company_vps.py          # CLI to set up a new company's VPS
│
└── tests/
    ├── test_isolation.py                 # CRITICAL: no cross-company leakage
    ├── test_cross_agent.py               # task routing, handoffs, pipelines
    ├── test_brain_visibility.py          # Brain sees all interactions correctly
    ├── test_tool_permissions.py          # role scoping enforced
    ├── test_hermes_client.py             # API proxy calls correctly
    └── test_patterns.py                  # cross-staff pattern detection
```

---

## 5. Data model — `migrations/001_init.sql`

**Every table has `company_id UUID NOT NULL`. RLS enforced. Every query filters it.**

```sql
-- ── COMPANIES + STAFF ──────────────────────────────────────────

create table companies (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  slug        text unique not null,
  tier        text not null default 'pro',
  vps_host    text,                        -- company VPS hostname/IP
  vps_ssh_key text,                        -- encrypted; used by provisioner
  created_at  timestamptz not null default now()
);

create table staff (
  id            uuid primary key default gen_random_uuid(),
  company_id    uuid not null references companies(id),
  name          text not null,
  email         text not null,
  role          text not null,
  department    text not null,
  access_level  text not null,             -- junior|manager|director|executive
  status        text not null default 'active',
  created_at    timestamptz not null default now(),
  unique (company_id, email)
);

create table agent_profiles (
  id                uuid primary key default gen_random_uuid(),
  company_id        uuid not null references companies(id),
  staff_id          uuid not null references staff(id),
  hermes_profile    text not null,         -- profile name on VPS: "{staff_id}-{company_id}"
  hermes_port       int not null,          -- API server port for this profile
  hermes_api_key    text not null,         -- encrypted bearer token
  memory_namespace  text not null,         -- "user_{staff_id}_{company_id}"
  permitted_tools   jsonb not null default '[]',
  trust_score       float not null default 1.0,
  interaction_count int not null default 0,
  last_active       timestamptz,
  status            text not null default 'active',
  created_at        timestamptz not null default now(),
  unique (company_id, staff_id)
);

-- ── INTERACTIONS (the Brain's visibility layer) ────────────────

create table interactions (
  id                    uuid primary key default gen_random_uuid(),
  company_id            uuid not null references companies(id),
  staff_id              uuid not null references staff(id),
  role                  text not null,
  user_message          text not null,
  agent_response        text not null,
  tools_called          jsonb default '[]',
  mcp_servers_used      jsonb default '[]',
  context_chunks        jsonb,
  -- cross-agent metadata
  triggered_by_task_id  uuid,              -- if this interaction was a task delivery
  generated_task_ids    jsonb default '[]',-- tasks this interaction spawned
  -- learning signals
  suggestion_acted_on   boolean,
  sentiment             text,
  brain_pattern_flags   jsonb default '[]',-- patterns Brain flagged in this interaction
  created_at            timestamptz not null default now()
);
create index on interactions (company_id, created_at);
create index on interactions (company_id, staff_id, created_at);

-- ── ACTIVITY FEED (Brain's live company view) ──────────────────

create table activity_events (
  id            uuid primary key default gen_random_uuid(),
  company_id    uuid not null references companies(id),
  staff_id      uuid references staff(id),
  event_type    text not null,
  -- types: agent_interaction | task_created | task_completed |
  --        tool_called | pattern_detected | push_sent |
  --        hunt_finding | cross_agent_handoff | ingestion_complete
  payload       jsonb not null,
  visible_to    text not null default 'brain',
  -- brain | executives | managers | all
  created_at    timestamptz not null default now()
);
create index on activity_events (company_id, created_at);
create index on activity_events (company_id, event_type, created_at);

-- ── CROSS-AGENT TASKS ──────────────────────────────────────────

create table tasks (
  id              uuid primary key default gen_random_uuid(),
  company_id      uuid not null references companies(id),
  title           text not null,
  description     text,
  brief           text,                    -- full context for the receiving agent
  from_staff_id   uuid references staff(id),
  to_staff_id     uuid not null references staff(id),
  -- handoff chain (A → B → C)
  parent_task_id  uuid references tasks(id),
  chain_position  int not null default 0,
  -- state
  status          text not null default 'pending',
  -- pending|delivered|accepted|in_progress|completed|handed_off|blocked
  priority        text not null default 'normal',
  due_at          timestamptz,
  -- output (becomes next agent's input)
  output          text,
  output_artifacts jsonb default '[]',     -- file refs, doc links etc.
  next_agent_id   uuid references staff(id),-- where output routes on completion
  -- Brain routing metadata
  routed_by_brain boolean not null default true,
  brain_context   jsonb,                   -- why Brain routed this way
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index on tasks (company_id, to_staff_id, status);
create index on tasks (company_id, from_staff_id, status);
create index on tasks (company_id, parent_task_id);

-- ── CROSS-STAFF PATTERNS (Brain detection) ─────────────────────

create table detected_patterns (
  id              uuid primary key default gen_random_uuid(),
  company_id      uuid not null references companies(id),
  pattern_type    text not null,
  -- repeated_question | shared_blocker | workflow_gap |
  -- knowledge_gap | cross_team_dependency | risk_signal
  title           text not null,
  detail          text not null,
  evidence        jsonb,                   -- interaction_ids + signals behind it
  staff_involved  jsonb default '[]',      -- staff_ids (anonymised in surfacing)
  confidence      float not null default 0.5,
  status          text not null default 'open',
  escalated_to    uuid references staff(id),
  created_at      timestamptz not null default now()
);
create index on detected_patterns (company_id, status, created_at);

-- ── HUNT FINDINGS + PUSHES ─────────────────────────────────────

create table hunt_findings (
  id            uuid primary key default gen_random_uuid(),
  company_id    uuid not null references companies(id),
  mode          text not null,
  -- threat|waste|opportunity|performance|knowledge
  title         text not null,
  detail        text not null,
  evidence      jsonb,
  confidence    float not null default 0.5,
  depth         text not null default 'fast',  -- fast|deep
  target_role   text,
  target_staff  uuid references staff(id),
  status        text not null default 'open',
  created_at    timestamptz not null default now()
);

create table pushes (
  id                  uuid primary key default gen_random_uuid(),
  company_id          uuid not null references companies(id),
  staff_id            uuid not null references staff(id),
  finding_id          uuid references hunt_findings(id),
  pattern_id          uuid references detected_patterns(id),
  task_id             uuid references tasks(id),
  kind                text not null,
  -- hunt_finding|pattern|task_assignment|task_complete|brain_insight
  message             text not null,
  recommended_action  text,
  draft_artifact      text,               -- pre-drafted message/doc the agent can use
  delivered_at        timestamptz,
  read_at             timestamptz,
  acted_on            boolean,
  created_at          timestamptz not null default now()
);
create index on pushes (company_id, staff_id, delivered_at);

-- ── KNOWLEDGE + LEARNING ───────────────────────────────────────

create table company_terminology (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null references companies(id),
  term        text not null,
  definition  text not null,
  source      text,
  created_at  timestamptz not null default now()
);

create table training_signals (
  id              uuid primary key default gen_random_uuid(),
  company_id      uuid not null references companies(id),
  interaction_id  uuid references interactions(id),
  kind            text not null,
  prompt          text not null,
  target          text not null,
  score           float,
  created_at      timestamptz not null default now()
);
```

---

## 6. Hermes provisioning per company (`hermes/`)

### 6.1 `provisioner.py` — spin up a new staff member's agent

```python
# Conceptual — verify exact Hermes CLI flags at build time
def spin_up(staff: Staff, company: Company) -> AgentProfile:
    profile_name = f"{staff.id}-{company.id}"
    port = allocate_port(company)          # next free port on this company's VPS
    api_key = generate_secure_key()

    # 1. Create the Hermes profile on the VPS via SSH
    ssh_exec(company.vps_host, [
        "hermes", "profile", "create", profile_name
    ])

    # 2. Set DeepSeek as provider
    ssh_exec(company.vps_host, [
        "hermes", "-p", profile_name,
        "config", "set", "DEEPSEEK_API_KEY", DEEPSEEK_API_KEY
    ])
    ssh_exec(company.vps_host, [
        "hermes", "-p", profile_name,
        "config", "set", "model", "deepseek/deepseek-v4-flash"
    ])

    # 3. Enable API server on allocated port
    ssh_exec(company.vps_host, [
        "hermes", "-p", profile_name,
        "config", "set", "API_SERVER_ENABLED", "true"
    ])
    ssh_exec(company.vps_host, [
        "hermes", "-p", profile_name,
        "config", "set", "API_SERVER_PORT", str(port)
    ])
    ssh_exec(company.vps_host, [
        "hermes", "-p", profile_name,
        "config", "set", "API_SERVER_KEY", api_key
    ])
    ssh_exec(company.vps_host, [
        "hermes", "-p", profile_name,
        "config", "set", "API_SERVER_MODEL_NAME",
        f"{staff.name}'s Agent"
    ])

    # 4. Inject role-aware system prompt
    system_prompt = prompts.build(staff, company)
    write_system_prompt_to_profile(company.vps_host, profile_name, system_prompt)

    # 5. Start the gateway
    ssh_exec_background(company.vps_host, [
        "hermes", "-p", profile_name, "gateway"
    ])

    # 6. Seed memory namespace in vector store
    memory.create_namespace(
        f"user_{staff.id}_{company.id}", company.id
    )

    # 7. Persist to DB
    profile = AgentProfile(
        staff_id=staff.id,
        company_id=company.id,
        hermes_profile=profile_name,
        hermes_port=port,
        hermes_api_key=encrypt(api_key),
        memory_namespace=f"user_{staff.id}_{company.id}",
        permitted_tools=tool_permissions.for_role(staff.access_level)
    )
    db.save(profile)
    return profile
```

### 6.2 `mcp_writer.py` — staff connect a tool (invisible to them)

```python
def connect_tool(staff_id: uuid, tool_name: str, credentials: dict):
    """Called when staff clicks 'Connect GitHub' in WorkDaemon webapp."""
    profile = db.get_agent_profile(staff_id)
    company = db.get_company(profile.company_id)

    # Check role permission
    if tool_name not in tool_permissions.for_role(profile.staff.access_level):
        raise PermissionError(f"{profile.staff.role} cannot use {tool_name}")

    # Load MCP config template for this tool
    config = load_mcp_template(tool_name)
    config = inject_credentials(config, credentials)

    # Write to profile's config.yaml on VPS via SSH
    write_mcp_config_to_profile(
        host=company.vps_host,
        profile=profile.hermes_profile,
        tool_name=tool_name,
        config=config
    )

    # Reload MCP servers without restarting the gateway
    ssh_exec(company.vps_host, [
        "hermes", "-p", profile.hermes_profile,
        "gateway"                           # /reload-mcp via gateway command
    ])
    # Or send /reload-mcp via the API server if gateway is running

    # Log connection
    db.save_tool_connection(staff_id, tool_name)
    # Staff sees: "GitHub connected ✓"  — no mention of Hermes
```

---

## 7. The chat proxy — everything passes through WorkDaemon (`api/routes/chat.py`)

**This is the most important architectural piece.** Every message from every staff member to their agent flows through this endpoint. This is how the Brain sees everything.

```python
@router.post("/chat/{staff_id}")
async def chat(staff_id: uuid, message: ChatMessage, current_user: User):
    profile = db.get_agent_profile(staff_id)
    company = db.get_company(profile.company_id)

    # 1. Check for pending task deliveries — inject them if present
    pending_tasks = tasks.get_pending_for_staff(staff_id)
    system_injection = build_task_context(pending_tasks) if pending_tasks else None

    # 2. Retrieve RAG context from Brain
    context = brain.context.get_for_query(
        message.text, staff_id, profile.company_id
    )

    # 3. Call Hermes API server for this staff member
    hermes_response = await hermes.client.chat(
        host=company.vps_host,
        port=profile.hermes_port,
        api_key=decrypt(profile.hermes_api_key),
        messages=message.history + [{"role": "user", "content": message.text}],
        system_injection=system_injection,
        context=context,
        stream=True
    )

    # 4. Stream response back to webapp
    async for chunk in hermes_response:
        yield chunk

    # 5. After response complete — log everything (async, non-blocking)
    full_response = hermes_response.complete_text
    tools_called = hermes_response.tools_called

    asyncio.create_task(post_interaction(
        company_id=profile.company_id,
        staff_id=staff_id,
        role=profile.staff.role,
        user_message=message.text,
        agent_response=full_response,
        tools_called=tools_called,
        context_chunks=context.chunk_ids,
    ))

async def post_interaction(company_id, staff_id, role,
                           user_message, agent_response,
                           tools_called, context_chunks):
    # Write to interactions table
    interaction_id = db.save_interaction(...)

    # Emit to activity feed (Brain picks this up in real time)
    activity_feed.emit(company_id, ActivityEvent(
        event_type="agent_interaction",
        staff_id=staff_id,
        payload={
            "interaction_id": interaction_id,
            "user_message": user_message,
            "agent_response": agent_response,
            "tools_called": tools_called,
            "role": role,
        }
    ))

    # Log to three learning loops
    brain.logger.log(interaction_id)

    # Check if response contains a cross-agent intent
    # (e.g. PM said "assign X to Sarah") → route to cross_agent
    cross_agent.coordinator.check_and_route(
        interaction_id, agent_response, staff_id, company_id
    )
```

---

## 8. Brain visibility — the activity feed (`brain/activity_feed.py`)

The Brain has a live view of the entire company through the activity feed. Every meaningful event — every interaction, every task, every tool call, every pattern — goes through this bus.

```python
# Redis pub/sub channel per company: "company_feed:{company_id}"
# Also persisted to activity_events table for historical Brain analysis

EVENT_TYPES = {
    "agent_interaction",     # staff ↔ their agent
    "task_created",          # PM assigned task to Designer
    "task_completed",        # Designer completed task
    "task_handed_off",       # Designer → Dev handoff
    "tool_called",           # agent used GitHub/Notion/etc.
    "pattern_detected",      # Brain found cross-staff pattern
    "push_sent",             # Brain pushed intelligence to agent
    "hunt_finding",          # Brain hunt produced a finding
    "cross_agent_handoff",   # output became another agent's input
    "ingestion_complete",    # new company data indexed
}

def emit(company_id: uuid, event: ActivityEvent):
    # 1. Publish to Redis for real-time Brain consumption
    redis.publish(f"company_feed:{company_id}", event.json())
    # 2. Persist to DB for historical analysis + nightly Brain pass
    db.save_activity_event(company_id, event)
    # 3. Forward to websocket for webapp activity feed (role-gated)
    websocket.broadcast(company_id, event, visibility=event.visible_to)

def subscribe_brain(company_id: uuid):
    """Brain's real-time subscription to the company feed."""
    return redis.subscribe(f"company_feed:{company_id}")
```

**What the Brain does with this feed:**

- **Real-time (Flash, thinking off):** every interaction → triage for immediate push-worthiness, cross-agent intent detection, blocker signals.
- **Pattern detection (Flash, every hour):** sliding window over last N interactions → detect ≥3 staff asking similar things, shared blockers, workflow gaps → write `detected_patterns`, push to relevant managers.
- **Nightly deep pass (Pro, thinking on, `effort=max`):** entire day's activity feed + tool data digests + open patterns + hunt findings → comprehensive company intelligence pass. Outputs ranked findings, updated graph edges, proactive briefs.

---

## 9. Cross-agent system (`cross_agent/`)

### 9.1 How it works — three flows

**Flow 1 — Direct task assignment (PM assigns to Designer)**

```
PM's agent tells Brain: "assign checkout redesign to Sarah, high priority"
         ↓
cross_agent.coordinator.check_and_route() detects task-assignment intent
         ↓
Brain (Flash, thinking off) extracts: {title, assignee, priority, brief}
         ↓
tasks table: new task row (from=PM, to=Sarah, status=pending)
         ↓
activity_feed: task_created event
         ↓
push inbox: Sarah's agent gets "Amara assigned you checkout redesign [brief]"
         ↓
Sarah's next chat session or websocket push surfaces the task
         ↓
Sarah's agent: "Got it, I'll start now" → task status = in_progress
```

**Flow 2 — Automatic output → input pipeline (Designer → Dev)**

```
Sarah's agent: "Done, pushing to James"
         ↓
coordinator detects handoff intent + extracts output artifact
         ↓
tasks table: Sarah's task = completed, output saved
             new task created: {from=Sarah, to=James, brief=Sarah's output}
         ↓
activity_feed: task_completed + task_handed_off + cross_agent_handoff events
         ↓
James's push inbox: "Sarah completed checkout redesign, it's in your queue"
         ↓
James's agent picks it up with full context (Sarah's output as brief)
```

**Flow 3 — Brain-initiated routing (Brain sees something, routes proactively)**

```
Nightly Brain pass detects: design debt in codebase (from GitHub tool data)
         ↓
Brain identifies: this is a Designer + Dev issue
         ↓
hunt_findings row created
         ↓
push to Designer's agent: "Design system inconsistency detected in 3 components"
push to Dev Lead's agent: "Related tech debt in checkout module"
         ↓
Brain pre-drafts a brief for a potential task if they want to act on it
```

### 9.2 `task_router.py` — the Brain's routing logic

```python
def route_task(intent: TaskIntent, company_id: uuid) -> Task:
    """
    Brain (Flash) decides:
    - Who the right assignee is (from intent + Brain context)
    - What context to include in the brief
    - What the output pipeline should look like (who gets it when done)
    - What priority + deadline to set
    """
    # Get company context for routing decision
    context = brain.context.get_for_routing(intent, company_id)

    # Flash call: extract structured task from natural language + context
    task_data = brain.router.call(
        kind="brain",
        depth="fast",
        prompt=TASK_ROUTING_PROMPT.format(intent=intent, context=context)
    )

    # Build the brief (what the receiving agent will see)
    brief = build_brief(task_data, context)

    # Create task + emit events
    task = db.create_task(
        company_id=company_id,
        from_staff_id=intent.sender_id,
        to_staff_id=task_data.assignee_id,
        title=task_data.title,
        brief=brief,
        priority=task_data.priority,
        next_agent_id=task_data.next_assignee_id,  # output pipeline
        routed_by_brain=True,
        brain_context=task_data.routing_rationale
    )

    activity_feed.emit(company_id, ActivityEvent(
        event_type="task_created", payload=task.dict()
    ))

    push.inbox.deliver(task.to_staff_id, Push(
        kind="task_assignment",
        task_id=task.id,
        message=f"{intent.sender_name} assigned you: {task.title}",
        draft_artifact=brief
    ))

    return task
```

### 9.3 `handoff.py` — output becomes next agent's input

```python
def complete_and_hand_off(task_id: uuid, output: str, artifacts: list):
    task = db.get_task(task_id)

    # Mark complete, save output
    db.update_task(task_id, status="completed", output=output,
                   output_artifacts=artifacts)

    activity_feed.emit(task.company_id, ActivityEvent(
        event_type="task_completed",
        payload={"task_id": task_id, "output_preview": output[:200]}
    ))

    # If there's a next agent in the pipeline, route automatically
    if task.next_agent_id:
        next_task_intent = TaskIntent(
            sender_id=task.to_staff_id,
            target_id=task.next_agent_id,
            title=f"[From {task.to_staff.name}]: {task.title}",
            context=output,                 # Sarah's output IS the brief
            artifacts=artifacts
        )
        route_task(next_task_intent, task.company_id)

        activity_feed.emit(task.company_id, ActivityEvent(
            event_type="cross_agent_handoff",
            payload={
                "from_staff": task.to_staff_id,
                "to_staff": task.next_agent_id,
                "task_id": task_id,
            }
        ))
```

---

## 10. Brain router (`brain/router.py`)

```python
BRAIN_TIERS = {
    "deep": {
        "model": "deepseek-v4-pro",
        "thinking": True,
        "reasoning_effort": "max",
    },
    "fast": {
        "model": "deepseek-v4-flash",
        "thinking": False,
        "reasoning_effort": None,
    },
    "technical_moderate": {
        "model": "deepseek-v4-flash",
        "thinking": True,
        "reasoning_effort": "high",
    },
    "technical_complex": {
        "model": "deepseek-v4-pro",
        "thinking": True,
        "reasoning_effort": "max",
    },
}

ESCALATION_CONFIDENCE_THRESHOLD = 0.6

def call(kind: str, depth: str, prompt: str,
         task_type: str = "triage", **kwargs) -> BrainResponse:
    """
    Route a Brain call to the right DeepSeek tier.
    kind: "brain" always (agent calls are proxied to Hermes directly)
    depth: fast | deep | technical
    task_type: triage | analysis | technical
    """
    if depth == "deep":
        tier = BRAIN_TIERS["deep"]
    elif depth == "technical":
        complexity = classify_technical_complexity(prompt, kwargs)
        tier = BRAIN_TIERS["technical_complex"] if complexity == "complex" \
               else BRAIN_TIERS["technical_moderate"]
    else:
        tier = BRAIN_TIERS["fast"]

    response = _call_deepseek(prompt, tier, **kwargs)

    # Escalate if Flash is not confident
    if tier["model"] == "deepseek-v4-flash":
        if response.confidence < ESCALATION_CONFIDENCE_THRESHOLD \
           or response.flagged_complex:
            response = _call_deepseek(prompt, BRAIN_TIERS["deep"], **kwargs)
            response.escalated = True

    return response

def classify_technical_complexity(prompt: str, context: dict) -> str:
    """
    Cheap heuristic: complex if multi-file, multi-sheet, or
    write/modify intent detected. Fast Flash call to decide.
    """
    signals = [
        len(context.get("files", [])) > 3,
        len(context.get("sheets", [])) > 3,
        any(w in prompt.lower() for w in
            ["refactor", "redesign", "debug", "architecture", "optimize"]),
        context.get("estimated_tokens", 0) > 50_000,
    ]
    return "complex" if sum(signals) >= 2 else "moderate"
```

---

## 11. Pattern detection (`brain/patterns.py`)

```python
# Runs every hour via Inngest
def detect_patterns(company_id: uuid):
    # Get last 30 days of interactions
    interactions = db.get_interactions(company_id, days=30)

    # Semantic clustering of user messages
    clusters = semantic_cluster(interactions, threshold=0.85)

    for cluster in clusters:
        if len(cluster.staff_ids) >= 3:            # ≥3 different staff
            # Brain (Flash) analyzes the cluster
            analysis = brain.router.call(
                kind="brain", depth="fast",
                prompt=PATTERN_ANALYSIS_PROMPT.format(
                    cluster=cluster.sample_messages,
                    staff_count=len(cluster.staff_ids),
                    company_context=get_company_context(company_id)
                )
            )

            pattern = db.save_detected_pattern(
                company_id=company_id,
                pattern_type=analysis.pattern_type,
                title=analysis.title,
                detail=analysis.detail,
                evidence=cluster.interaction_ids,
                staff_involved=cluster.staff_ids,   # anonymised when surfaced
                confidence=analysis.confidence
            )

            # Push to relevant managers/executives
            # Never expose individual names — surface as "multiple staff"
            push_pattern_to_managers(pattern, company_id)

            activity_feed.emit(company_id, ActivityEvent(
                event_type="pattern_detected",
                payload={"pattern_id": pattern.id, "title": pattern.title}
            ))
```

---

## 12. Hunt engine (`brain/hunter.py`)

Five modes, two tiers, one schedule:

```python
HUNT_SCHEDULE = {
    "threat":      {"depth": "fast",  "interval_hours": 1},
    "waste":       {"depth": "fast",  "interval_hours": 6},
    "opportunity": {"depth": "deep",  "interval_hours": 24},  # nightly
    "performance": {"depth": "deep",  "interval_hours": 24},  # nightly
    "knowledge":   {"depth": "fast",  "interval_hours": 6},
}

# Nightly pass: all five modes in one Pro call with 1M context
# (entire company state in one view)
def nightly_deep_pass(company_id: uuid):
    context = assemble_company_context(company_id)  # up to 1M tokens
    # prefix-stable: company preamble first (cached by DeepSeek)
    response = brain.router.call(
        kind="brain", depth="deep",
        prompt=NIGHTLY_HUNT_PROMPT.format(
            context=context,
            open_patterns=db.get_open_patterns(company_id),
            recent_tasks=db.get_recent_tasks(company_id),
            feed_summary=activity_feed.get_summary(company_id, hours=24),
        )
    )
    process_hunt_findings(response.findings, company_id)
```

**Golden push scenarios (build these as tests):**
1. Sales churn-risk flag (threat hunt, Flash)
2. Operations Step-3 bottleneck (waste hunt, pattern detection)
3. CEO 7am briefing (nightly deep pass output → executive push)
4. HR burnout/flight-risk signal (performance hunt, deep, → HR director only)

---

## 13. Privacy (`src/brain/privacy.py` — mandatory, not optional)

- **Staff know.** The onboarding flow in the webapp discloses that agent interactions train the Brain and feed company intelligence. No hidden surveillance.
- **Asymmetric surfacing.** Brain sees named individuals in raw data. Managers and executives see patterns and recommendations — never raw quotes, never "James said X." Surfacing is always framed as patterns + recommended action.
- **Access gates.** HR-type signals (burnout, flight risk) → HR Director and CEO only. Performance signals → direct manager only. Company-wide patterns → executives. Individual tool calls → nobody except audit log.
- **The activity feed is role-gated.** `visible_to` field on every event: `brain | executives | managers | all`. Websocket only pushes what the viewer's role allows.
- **Cross-agent privacy.** A task brief contains what the sender chose to share — not their private agent history. The Brain routes the task; it does not dump one person's session into another's context.
- **Offboarding.** Departed staff's Hermes profile is stopped and archived. Memory namespace marked inactive. Training signals anonymised. Raw session history never surfaced again.
- **DeepSeek disclosure.** Brain reasoning is processed by DeepSeek's API. Disclose this to customers. Enterprise escape hatch: self-hosted DeepSeek (config change only — the router is model-string agnostic).

---

## 14. Isolation (`tests/test_isolation.py` — release gate)

```python
# These tests must ALL pass before any release
def test_no_cross_company_db_read(): ...
def test_no_cross_company_vector_search(): ...
def test_no_cross_company_activity_feed(): ...
def test_no_cross_company_task_routing(): ...
def test_no_cross_company_hermes_api_call(): ...
def test_one_brain_call_one_company(): ...      # DeepSeek never mixes companies
def test_staff_only_sees_own_tasks(): ...
def test_role_cannot_see_above_access_level(): ...
def test_offboarded_staff_namespace_inactive(): ...
```

---

## 15. The webapp — Daemon Chat (`webapp/`)

The only interface staff ever use. Three main surfaces:

**Daemon Chat** (`/chat/[staffId]`)
- Streaming chat with their personal Hermes agent
- Push inbox panel (Brain alerts, task assignments, findings)
- Tool status bar (connected tools shown as WorkDaemon features)
- Task card surface (active tasks, handoff status)

**Activity Feed** (`/dashboard`) — role-gated
- Live stream of company events (role-appropriate view)
- Executives: full company activity
- Managers: their team's activity
- Staff: their own activity + tasks involving them

**Task Board** (`/tasks`)
- Visual board of cross-agent tasks
- Create task → Brain routes to right person
- See handoff chain (PM → Designer → Dev)
- Status updates in real time via websocket

**Tool Connection** (`/settings/tools`)
- Staff see WorkDaemon-branded tool cards (GitHub, Notion, Drive etc.)
- OAuth flow → credentials encrypted → backend writes Hermes MCP config
- Staff see "Connected ✓" — no mention of Hermes, MCP, or config files

---

## 16. Optional gateways (Telegram, WhatsApp etc.)

When a company enables Telegram as an optional channel:

```
Staff sends Telegram message to WorkDaemon bot
         ↓
WorkDaemon Telegram bot (your bot, your branding)
         ↓
WorkDaemon FastAPI backend (/chat/{staff_id})
         → identical path to webapp chat
         → same logging, same Brain visibility, same activity feed
         ↓
Hermes API server for that staff member
         ↓
Response → WorkDaemon backend → WorkDaemon Telegram bot → staff
```

Staff experience: messaging their WorkDaemon assistant on Telegram. Never "Hermes." Never anything else. It's always WorkDaemon.

Implementation: Hermes's built-in Telegram gateway is **not used**. You run your own Telegram bot (python-telegram-bot or grammy) that proxies through your FastAPI chat endpoint. Same for WhatsApp (Twilio or WhatsApp Cloud API).

---

## 17. Environment variables (`.env.example`)

```bash
# ── BRAIN ──────────────────────────────────────────────────────
DEEPSEEK_API_KEY=
DEEPSEEK_BASE_URL=https://api.deepseek.com
BRAIN_DEEP_MODEL=deepseek-v4-pro
BRAIN_FAST_MODEL=deepseek-v4-flash
# WARNING: do NOT use deepseek-chat or deepseek-reasoner
# (retired July 24 2026)
BRAIN_DEEP_REASONING_EFFORT=max
BRAIN_TECHNICAL_REASONING_EFFORT=high
BRAIN_ESCALATION_CONFIDENCE_THRESHOLD=0.6
BRAIN_TECHNICAL_FILE_THRESHOLD=3

# ── HERMES / AGENTS ────────────────────────────────────────────
HERMES_PORT_RANGE_START=8700   # ports 8700-8999 allocated per company VPS
HERMES_ENCRYPTION_KEY=         # for encrypting per-staff API keys in DB

# ── DATA ───────────────────────────────────────────────────────
POSTGRES_URL=postgresql://localhost:5432/workdaemon
REDIS_URL=redis://localhost:6379
VECTOR_BACKEND=pgvector         # pgvector | qdrant | pinecone

# ── EMBEDDINGS ─────────────────────────────────────────────────
OPENAI_API_KEY=                 # embeddings only (text-embedding-3-small)
EMBEDDING_MODEL=text-embedding-3-small

# ── KNOWLEDGE GRAPH ────────────────────────────────────────────
NEO4J_URL=bolt://localhost:7687
NEO4J_USER=neo4j
NEO4J_PASSWORD=

# ── LIVE WEB LEARNING ──────────────────────────────────────────
TAVILY_API_KEY=
FIRECRAWL_API_KEY=

# ── OBSERVABILITY ──────────────────────────────────────────────
LANGSMITH_API_KEY=
LANGSMITH_PROJECT=workdaemon-brain

# ── SCHEDULING ─────────────────────────────────────────────────
INNGEST_EVENT_KEY=
INNGEST_SIGNING_KEY=

# ── OPTIONAL GATEWAYS ──────────────────────────────────────────
TELEGRAM_BOT_TOKEN=            # your WorkDaemon Telegram bot (not Hermes)
TWILIO_ACCOUNT_SID=            # for WhatsApp/SMS if enabled

# ── SECURITY ───────────────────────────────────────────────────
JWT_SECRET=
ENCRYPTION_KEY=

# ── FINE-TUNING (optional, add later) ──────────────────────────
# HF_TOKEN=
# MODAL_ENVIRONMENT=main
```

---

## 18. Build order — 20 steps, each independently testable

1. **Skeleton** — `pyproject.toml`, `.env.example`, `config.py`, `docker-compose.yml` (Postgres+pgvector, Redis, Neo4j).
2. **DB + isolation primitives** — `db.py`, `vectors.py`, `migrations/001_init.sql`. Write `tests/test_isolation.py` immediately. Keep it green forever.
3. **Seed scripts** — `scripts/seed_company.py`, `seed_interactions.py`. Two fake companies, fake staff, fake interactions. Everything tests against these.
4. **Hermes provisioner** — `hermes/provisioner.py`, `hermes/profile_manager.py`. Provision one fake staff member on a test VPS. Verify API server responds on the right port.
5. **Hermes client** — `hermes/client.py`. Call the API server, stream a response, confirm it works.
6. **Tool permissions + MCP writer** — `agents/tool_permissions.py`, `hermes/mcp_writer.py`. Connect a fake Notion tool to a profile. Verify it appears in Hermes config. `tests/test_tool_permissions.py` green.
7. **Agent factory** — `agents/factory.py`, `agents/profiles.py`, `agents/prompts.py`. Full spin_up of one staff member: profile, port, API key, system prompt, memory namespace. DB row saved.
8. **Chat proxy** — `api/routes/chat.py`. Message in → Hermes API → response out. Logging stub only.
9. **Activity feed** — `brain/activity_feed.py`. Every chat proxy call emits to Redis + DB. `tests/test_brain_visibility.py` confirms Brain sees all interactions.
10. **Interaction logger** — `brain/logger.py`. Three learning loops (individual, role, company). Training signals emitted.
11. **Brain router** — `brain/router.py`. Flash/Pro routing, escalation, technical classification. Unit test every routing decision.
12. **Brain context + memory** — `brain/context.py`, `brain/memory.py`. RAG retrieval injected into agent calls.
13. **Pattern detection** — `brain/patterns.py`. Seed ≥3 similar fake interactions → confirm pattern detected and pushed. `tests/test_patterns.py` green.
14. **Hunt engine** — `brain/hunter.py`. All five modes. Nightly deep pass. Four golden scenario tests pass.
15. **Cross-agent tasks** — `cross_agent/task_router.py`, `cross_agent/handoff.py`, `cross_agent/bus.py`. PM assigns to Designer → task created → push delivered. Designer completes → output routes to Dev. `tests/test_cross_agent.py` green.
16. **Push inbox + delivery** — `push/inbox.py`, `push/delivery.py`, `push/calibration.py`. Pushes delivered via websocket. Back-off if ignored.
17. **Ingestion** — `ingestion/` connectors + pipeline. Notion connector end-to-end into vector store + graph.
18. **Webapp — Daemon Chat** — streaming chat UI, push inbox, task cards. No Hermes branding anywhere.
19. **Webapp — settings + tools** — tool connection UI. OAuth → MCP config written silently. Staff sees "Connected ✓".
20. **Full dry run** — two fake companies → ingest → staff chat → task assigned (PM→Designer→Dev) → Brain detects pattern → push sent → isolation test green → no "Hermes" visible anywhere in UI.

---

## 19. Acceptance criteria

- [ ] `tests/test_isolation.py` fully green — no cross-company leakage at any layer.
- [ ] Staff chat flows entirely through WorkDaemon — Hermes, DeepSeek, MCP never visible to staff.
- [ ] One staff member spun up (profile, port, API key, tools, memory) in one `factory.spin_up` call.
- [ ] Brain receives every agent interaction in real time via activity feed.
- [ ] Pattern detected when ≥3 staff have semantically similar interactions in 30 days.
- [ ] PM → Designer → Dev task chain completes without anyone opening Notion.
- [ ] Agent output automatically becomes next agent's input on handoff.
- [ ] Brain routes tasks to correct assignee via Flash call with company context.
- [ ] Four golden hunt scenarios produce correct findings and calibrated pushes.
- [ ] Technical tasks (GitHub/Excel connected) route to Flash-with-thinking (moderate) or Pro-with-thinking (complex).
- [ ] Flash escalates to Pro when confidence < threshold — logged and traceable.
- [ ] Privacy: no staff member's raw words surfaced to another user; HR signals access-gated.
- [ ] Optional Telegram/WhatsApp bridge routes through WorkDaemon backend — not Hermes gateway.
- [ ] `hermes` or `NousResearch` never appears in any staff-facing UI string.

---

## 20. Cost model per company per month

| Item | Cost | Notes |
|---|---|---|
| Brain — V4 Pro | ~$15–22 | Nightly deep pass + escalations + complex technical. Prefix-cached. |
| Brain — V4 Flash | ~$4–8 | All-day triage, routing, pattern detection, moderate technical. |
| Hermes Agent | **$0** | MIT licensed. Free. |
| Company VPS (Hetzner CX22) | ~$6–15 | Runs all staff Hermes profiles. Upgrade VPS not count as companies grow. |
| Supabase (vector + DB) | ~$25 | Shared, amortised across companies. |
| Neo4j | ~$65 | Shared, amortised. |
| Tavily + Firecrawl | ~$46 | Real-world learning. |
| Redis | ~$10 | Activity feed bus. |
| LangSmith | ~$40 | Tracing. Shared. |
| Embeddings | ~$1–5 | OpenAI small. |
| **Total per company** | **~$80–120/mo** | At $99–299/seat pricing this is a rounding error. |
