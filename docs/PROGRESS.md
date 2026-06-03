# WorkDaemon — Spec Implementation Progress

> **Read this first in any new session.** It tracks what the four specs in
> `docs/specs/` ask for vs. what is actually built in the **live Vercel+Supabase
> app** (`/api`, `/src`). Updated 2026-06-03.

## The specs (in `docs/specs/`)
1. **WorkDaemon_FINAL_BuildSpec.md** — declares itself authoritative; supersedes the others.
   Target stack: Python/FastAPI + per-company VPS + Hermes Agent product + Neo4j +
   Redis pub/sub + Inngest + DeepSeek V4 two-tier brain + cross-agent layer.
2. **CompanyBrain_MasterBuildSpec.md** — original: fine-tuned Hermes-3-8B per company on Modal.
3. **CompanyBrain_ChangeSpec_DeepSeekV4.md** — patch: DeepSeek V4 Pro/Flash brain + local Hermes agents.
4. **workdaemon-cross-daemon-communication.md** — the cross-daemon vision (negotiation, capacity, broadcasts).

## Governing decision (2026-06-03)
**Build spec *capabilities* additively into the live Vercel+Supabase app — NOT a
literal rebuild to the FINAL spec's stack.** A live YC demo (Cobalt, logins sent
to Y Combinator) must not break; a backend rewrite would risk it. **Brain stays
multi-provider** (the live `api/chat.js` routes 9 providers incl. deepseek+modal) —
no forced DeepSeek-only or self-hosted-Hermes swap. See memory `project-cross-daemon`.

## Architecture reality
- **Live/deployed:** Vercel serverless JS (`/api/*.js`, 12-fn Hobby limit — CONSOLIDATE,
  don't add files) + Supabase Postgres. Frontend Vite/React in `/src`. app.workdaemon.com.
- **In-repo but NOT deployed:** `/backend` (Python/FastAPI), `/finetuning`, `/workdaemon-brain`.
  These are the spec's stack, parked. The shipped product is the Vercel app only.
- **Gotcha:** never embed `auth.users` via PostgREST (e.g. `assignee:assignee_id(...)`).
  Auth schema isn't exposed → query errors. Resolve names via the public `profiles` table.
- **Testing:** Vercel Attack Challenge Mode intermittently blocks headless browser/curl
  on the prod domain (real users unaffected). Verify backend via service-role DB scripts
  run from the repo dir (so `pg`/`@supabase/supabase-js` resolve). `scripts/run_migration.mjs`
  applies SQL over DATABASE_URL_UNPOOLED.

## Capability scorecard (spec → live app)
| Capability | Status | Notes |
|---|---|---|
| Multi-tenant isolation by company | ✅ | `workspace_id` everywhere |
| Per-staff agent profiles (access level, trust, interactions) | ✅ | `app_agent_profiles` |
| Interaction logging | ✅ | `brain_interactions` |
| Role-scoped tool permissions | ✅ | in `api/chat.js` |
| Daemon memory / learned prefs | ✅ | `daemon_memory` |
| Web search (retrieval augmentation) | ✅ | Brave; `api/chat.js` |
| Slack ingestion + grounding | ✅ | `slack_messages`; demo only |
| Hunt engine: 5 modes × 2 tiers + nightly deep pass | ✅ **SHIPPED** | `runHuntScan` (5 heuristic modes) + `nightlyDeepPass` (deep-model, whole-company) |
| Brain→agent finding routing / finding→task (Flow 3) | ✅ **SHIPPED** | `routeTaskFromFinding`: finding → brain-routed cross-daemon task to the role owner |
| **Cross-daemon communication** | ✅ **SHIPPED** | see below |
| **Two-tier brain routing (Flash→Pro escalation, technical routing)** | ✅ **SHIPPED** | `api/_lib/brain_router.js` + `api/chat.js`; provider-agnostic, see below |
| **Cross-staff pattern detection (≥3 staff)** | ✅ **SHIPPED** | `api/brain.js` detectPatterns → `app_detected_patterns`; runs on the scan_external cron + manual action |
| Realtime push (websockets) | ✅ **SHIPPED** | Supabase Realtime on inbox_items + daemon_events; sidebar Inbox badge ticks live (E2E-verified) |
| Knowledge graph (people/projects/risks) | ✅ **SHIPPED** | Postgres approximation (spec sanctions it); `buildGraph` + injected into daemon prompt |
| Per-company VPS + Hermes provisioning + MCP writer | ❌ | requires the parked Python stack |
| Push calibration / back-off | ✅ **SHIPPED** | `calibration.js`; backs off proactive pushes a user ignores; engagement stats |

## Cross-Daemon Communication — SHIPPED (commits 631179f, 44b51b8, 11a37f6, + Tasks UI)
Implements `workdaemon-cross-daemon-communication.md` in the live stack. The Brain
(`daemon_events` table + `inbox_items`) is the single source of truth; daemons never
talk directly. "Realtime" = surface on next chat/inbox load (doc's stated polling fallback).
- **DB** (`migration_cross_daemon.sql`, applied to prod): `daemon_events` bus;
  additive `tasks` cols (from_user_id, brief, next_assignee_id, routed_by_brain, output,
  parent_task_id); `app_agent_profiles.availability(+reason,+until)`.
- **`api/_lib/capacity.js`**: `assessCapacity` (open/overdue tasks + availability →
  low/medium/high) + `suggestAlternatives` (lowest-load first).
- **`api/tasks.js`** (extended, not a new fn): GET list + `?events=1`; POST actions
  `assign` (capacity check → `assigned` or surfaced `risk` w/ alternatives), `accept`,
  `flag` (counter-proposal), `broadcast` (senior→all), `set_availability`, `resolve_event`.
- **`api/chat.js`**: injects pending `daemon_events` into the system prompt → daemons
  surface assignments/flags/broadcasts proactively. VERIFIED LIVE (Maya's daemon
  surfaces Priya's capacity flag with options).
- **UI** (`src/pages/Dashboard.jsx` Tasks page): assigner→assignee, brain-routed badge,
  pending daemon-event cards (accept/flag), an "Assign via daemon" composer that shows
  the capacity-risk decision (Scenario 2) with alternatives.
- **Demo seed** (`scripts/seed_cross_daemon.mjs`, idempotent): Priya HIGH_LOAD +
  Maya→Priya assignment + Priya→Maya capacity flag; Sofia→Marcus handoff; Aisha
  parental-leave broadcast. Documented in `DEMO.md`.

## Two-Tier Brain Routing — SHIPPED
Implements FINAL §10 + ChangeSpec §2b, adapted to multi-provider (the lever is the
MODEL, not a DeepSeek-only tier). `api/_lib/brain_router.js`:
- `classifyTurn(text)` — heuristic (no LLM): strategic/analytical → `deep`; code/
  spreadsheet/data → `technical` (complex if refactor/debug/architecture/multi-file);
  session pings + casual → `fast`.
- `pickTierModels(keyRow)` — per-provider {fast, deep} pair (deepseek chat→reasoner,
  google flash→pro, openai 4o-mini→4o, anthropic sonnet→opus); keyRow.model wins as
  fast; env `BRAIN_FAST_MODEL`/`BRAIN_DEEP_MODEL` override; `BRAIN_TWO_TIER=off` disables.
  Providers without a known sibling stay single-tier (twoTier=false).
- `responseIsThin()` — escalation gate (empty / tiny lone text / hedging).
`api/chat.js`: deep/complex turns call the deep model directly; fast turns call fast and
**escalate fast→deep when thin**; any routed/deep error **falls back to the workspace's
configured model** (today's behavior) → demo-safe. Logs `[chat] route depth=.. model=.. escalated=..`.

## Cross-Staff Pattern Detection — SHIPPED
Implements FINAL §11 + §13 (anonymised surfacing). `api/brain.js` `detectPatterns(workspaceId, db)`:
clusters last-30-day `brain_interactions` by topic tag; a tag touched by **≥3 distinct
staff** → a typed pattern (`shared_blocker` / `cross_team_dependency` / `repeated_question`)
written to **`app_detected_patterns`** (own table — Python backend owns `detected_patterns`
by company_id; same `app_` convention as app_agent_profiles). Pushes to **executives only**
(§13: company-wide → executives), **anonymised** (counts + roles, never names; staff ids
stored but never surfaced). Dedups vs open patterns. Runs on the `scan_external` cron +
manual `POST /api/brain {action:'detect_patterns'}`. `detectPatterns` is exported for
scripts. Cobalt seeded → 5 live patterns (Close Automation, SOC 2 audit, Ramp) in Maya &
Daniel's inbox. **Also injected into the executive daemon's chat prompt** (`api/chat.js`):
open `app_detected_patterns` are loaded for `access_level==='executive'` and appended as a
"CROSS-STAFF PATTERNS" block (anonymised) so the CEO's daemon raises them proactively, tagged
"Brain · Pattern". Non-execs never see them.

## Hunt Engine — SHIPPED (FINAL §12 / ChangeSpec §3)
- **Fast tier (`runHuntScan`, heuristic):** all 5 modes — knowledge/performance/waste
  (existing) + **threat** (churn/security/financial/people, role-targeted) + **opportunity**
  (expansion/upsell). Manual `POST /api/brain {action:'hunt_scan'}`.
- **Deep tier (`nightlyDeepPass`, LLM):** company context + interactions + open findings +
  patterns + tasks → ONE deep-model call (`deepseek-reasoner` via `pickTierModels`) → ranked
  `hunt_findings` across all 5 modes + a **CEO morning briefing** to executives (golden
  scenario #3). OpenAI-compatible providers only; others skip LLM (heuristic still runs).
  Best-effort. Runs in the 7am `scan_external` cron + manual `{action:'nightly_pass'}`.
  Verified live on Cobalt → 6 findings + briefing.

## Hunt finding → cross-daemon task — SHIPPED (FINAL §9.1 Flow 3)
`api/brain.js` `routeTaskFromFinding(workspaceId, db, finding)`: resolves the finding's
affected role to a workspace member (fuzzy role-word match; executive fallback), creates a
**brain-routed task** (`from_user_id=null`, `routed_by_brain=true`, `source_finding_id` for
dedup) + a `daemon_events` assignment (`payload.source='brain'`) + an inbox push. The owner's
daemon surfaces it as **"The Company Brain routed you: …"** (chat injection + Tasks UI both
label brain-sourced work). Auto-runs for the top ≤2 **critical** findings in `nightlyDeepPass`;
manual `POST /api/brain {action:'spawn_task', finding_id}`. Migration `migration_task_from_finding.sql`
adds `tasks.source_finding_id`. Verified on Cobalt → SOC 2→Daniel (CTO), Q3 pipeline→Marcus
(Sales), FASB→Tom (Finance).

## Realtime push — SHIPPED (cross-daemon doc: "notified immediately")
`migration_realtime.sql` adds `inbox_items` + `daemon_events` to the `supabase_realtime`
publication. `AuthContext` exports the `supabase` client; `Sidebar` calls
`supabase.realtime.setAuth(token)` and subscribes to `inbox_items` INSERTs filtered to the
user (RLS-scoped) → the **Inbox badge increments instantly** when a daemon assigns/flags/
broadcasts or the Brain routes a task. Graceful: try/catch, no-op on failure, fetch-based
count still works. E2E-verified headlessly (subscribe as Maya → server insert → push delivered).
Password logins work because `/api/auth/login` returns a Supabase JWT used for `setAuth`.

## Knowledge graph — SHIPPED (FINAL §3: "Neo4j or Postgres recursive")
Postgres approximation. `migration_knowledge_graph.sql`: `app_graph_nodes` + `app_graph_edges`.
`api/brain.js` `buildGraph(workspaceId, db)` rebuilds deterministically from relational data:
nodes = person/task/risk/pattern; edges = owns / routed / addresses (task→risk) / affects
(risk→person via role match) / involves (pattern→person). `graphSummary()` renders a compact
"ORG GRAPH" block injected into the daemon prompt (who owns what, which risk affects whom,
what's addressing it). Rebuilt in the nightly cron; manual `{action:'build_graph'}`;
`GET /api/brain?tab=graph` returns nodes+edges. Verified on Cobalt → 33 nodes / 67 edges.
**Graph viz UI shipped:** Company Brain → **GRAPH** tab (`GraphTab` in Dashboard.jsx) renders a
deterministic layered SVG (People → own → Tasks → address → Risks; risks show severity +
affected names; patterns as chips) with a Rebuild button. Pure SVG, no graph library.

## Ingestion connectors — SHIPPED (FINAL §17 / Master §12; see INTEGRATIONS.md)
Document grounding pipeline + connector framework extended per `INTEGRATIONS.md`.
- `migration_ingestion.sql`: `workspace_documents` (normalized doc store — the spec's
  pgvector sink, approximated with keyword retrieval; no vector DB in the live stack).
- `api/_lib/ingestion.js`: `upsertDocuments` (normalize+dedup) + `retrieveDocuments`
  (keyword-overlap scoring, title-weighted).
- `api/_lib/oauth.js`: PROVIDERS registry + **github / notion / google** (added Notion
  Basic-auth token exchange + Google offline-access to the framework). They show in the
  Integrations UI; gated by `providerConfigured` until `<PROVIDER>_CLIENT_ID/SECRET` set.
- `api/_lib/connectors/github.js` + `notion.js`: real `ingest(db, ws, token)`. Run via
  `POST /api/brain {action:'ingest', provider}` (admin) once connected.
- `api/chat.js`: retrieves query-relevant docs → injects a "COMPANY DOCUMENTS" grounding
  block (cite source+title). Verified: SOC 2 query→runbook, GA query→spec+FX issue.
- Cobalt seeded with 6 docs (Notion runbook/spec/board/battlecard + 2 GitHub issues).
  LIVE OAuth is creds-gated; the pipeline + grounding work now off ingested/seeded docs.

## Push calibration — SHIPPED (Master §10.2 / FINAL push/calibration.py)
`migration_push_calibration.sql`: `inbox_items.acted_on` + `acted_at`. `api/_lib/calibration.js`:
- `shouldDeliver(db, userId, category)` — backs off SOFT/proactive categories
  (pattern/briefing/finding/insight) when a user has an ignore streak ≥4 (unread AND
  unacted AND >2d old); any read/acted push resets it. Direct/critical (assignment/flag/
  broadcast) never suppressed.
- `recordTaskAction` — accept/flag a task marks the source push acted_on (engagement signal).
- `engagement(db, ws)` — per-category read/act rates (`POST /api/brain {action:'push_stats'}`).
Wired into the pattern pushes (detectPatterns) + the CEO briefing (nightlyDeepPass). Verified:
4 ignored → back-off; engagement → resets.

## Connectors — deepened
- `api/_lib/connectors/index.js`: shared `CONNECTORS` registry (github / notion / google).
- `connectors/gdrive.js`: Google Drive — lists recent files, exports Google Docs to text.
- `api/brain.js`: ingest action uses the registry; **nightly cron auto-ingests** every
  connected provider's data into `workspace_documents` (FINAL §17 polling). All creds-gated.

## Bucket A — COMPLETE (this session)
- **Connector breadth**: Slack + Google (Drive/Gmail/Calendar) + Microsoft (Outlook) +
  Atlassian (Jira) + Salesforce + HubSpot + Notion + GitHub — all registered with valid
  authorize URLs + ingest data layers; manual `{action:'ingest'}` + nightly auto-ingest.
- **Write-actions** (`api/_lib/actions.js` + `execute_action`): daemon proposes `exec` on
  action_confirm → confirm runs it (slack.post/react), permission-gated + audited.
- **pgvector** (`migration_pgvector.sql` + `ingestion.js`): embedding column + `match_documents`
  RPC + embed-on-ingest + vector-first retrieval; **falls back to keyword** when no embedding
  key. (Verified fallback; vector path activates with a real OPENAI_API_KEY.)
- **Realtime toast** + Inbox-badge fix.

## Creds the owner must provide to make the above LIVE (not code — config)
- OAuth apps per connector: `<PROVIDER>_CLIENT_ID` / `<PROVIDER>_CLIENT_SECRET`
  (SLACK already set; GITHUB/NOTION/GOOGLE/MICROSOFT/ATLASSIAN/SALESFORCE/HUBSPOT pending).
- `OPENAI_API_KEY` (real) to switch document retrieval from keyword → pgvector semantic.

## Practically unbounded (build on demand, not "finishable")
- The 9,637-app connector long tail in `docs/integrations/CATALOG.md`.

## Deliberately NOT built (architecture decision — protects the live demo)
- Per-company VPS + Hermes-agent-per-staff; Neo4j (→ Postgres graph); Redis pub/sub
  (→ Supabase Realtime + polling); Inngest (→ Vercel cron); DeepSeek-only (→ multi-provider).

## How to run / verify
```bash
node scripts/run_migration.mjs <file.sql>     # apply SQL to prod (DATABASE_URL_UNPOOLED)
node scripts/seed_cross_daemon.mjs            # (re)seed cross-daemon demo (idempotent)
# Cobalt logins + demo script: see DEMO.md. delete_demo.mjs to tear down.
```
