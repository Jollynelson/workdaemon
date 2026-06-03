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
| Single hunt scan + findings | 🟡 | `api/brain.js` `runHuntScan`; spec wants **5 modes × 2 tiers + nightly deep pass** |
| Brain→agent finding routing | 🟡 | prompt-level ("⟵ ROUTED TO YOU") |
| **Cross-daemon communication** | ✅ **SHIPPED** | see below |
| **Two-tier brain routing (Flash→Pro escalation, technical routing)** | ✅ **SHIPPED** | `api/_lib/brain_router.js` + `api/chat.js`; provider-agnostic, see below |
| **Cross-staff pattern detection (≥3 staff)** | ✅ **SHIPPED** | `api/brain.js` detectPatterns → `app_detected_patterns`; runs on the scan_external cron + manual action |
| **Activity feed bus + realtime websockets** | ❌ | serverless req/res only; cross-daemon uses polling (chat + inbox) |
| Knowledge graph (Neo4j) | ❌ | not in live stack |
| Per-company VPS + Hermes provisioning + MCP writer | ❌ | requires the parked Python stack |
| Push calibration / back-off | ❌ | inbox exists, no calibration |

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

## Suggested next (priority order)
1. **Full 5-mode hunt engine + nightly deep pass** — expand `api/brain.js` `runHuntScan`
   (has knowledge/performance/waste; add threat/opportunity + a deep nightly pass).
3. **Realtime** — websockets need a non-Vercel channel (Supabase Realtime is the additive
   option if we want true push instead of the current chat/inbox polling).

## How to run / verify
```bash
node scripts/run_migration.mjs <file.sql>     # apply SQL to prod (DATABASE_URL_UNPOOLED)
node scripts/seed_cross_daemon.mjs            # (re)seed cross-daemon demo (idempotent)
# Cobalt logins + demo script: see DEMO.md. delete_demo.mjs to tear down.
```
