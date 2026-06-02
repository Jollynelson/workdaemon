# WorkDaemon — Status Snapshot

_Last updated: 2026-06-02 · HEAD `52eec33` on `origin/main` (proactive Company Brain shipped + deployed + verified)_

Quick re-entry after a restart. For deep detail see Claude memory
(`~/.claude/projects/-Users-mac-workdaemon/memory/`) — for the **live Vercel app**
(most work) start with `project-proactive-brain.md` + `project_security_hardening.md`;
for the **Modal/Hermes model track** see `project_final_buildspec.md`.

## What this is
Per-company AI "brain" platform. Each company gets an isolated **daemon** (the per-user
agent users chat with) backed by a company-wide **Company Brain** (knowledge graph,
cross-user patterns, external-news findings) that learns from its own usage. Daemon ≠
Brain: the daemon is per-user and draws on the shared Brain (see
`project-daemon-architecture.md`).

**Two implementation tracks — know which you're touching:**
1. **LIVE PRODUCT (primary): the Vercel app** — `api/` serverless + `src/` React/Vite +
   Supabase. This is what users actually use at **workdaemon-prod.vercel.app**, and where
   ALL recent work ships (security hardening, signup research, the proactive Company
   Brain). Reasoning runs on a **pluggable per-workspace provider key** (OpenRouter /
   Anthropic / OpenAI / Google / Mistral / DeepSeek / Azure / Ollama / **Modal**),
   resolved in `api/chat.js` (`use_case='reasoning'` → workspace `openrouter_key` → env
   `ANTHROPIC_API_KEY` Sonnet fallback). DeepSeek powers research/scanner synthesis.
2. **SELF-HOSTED MODEL TRACK (in progress / optional): Modal + per-company Hermes** —
   the `WorkDaemon_FINAL_BuildSpec` direction: **DeepSeek V4** brain + each company's
   **own Hermes-3 LoRA** (`wd-{company_id}`, 48h train cycle), self-hosted per-company
   models being the committed long-term differentiation (`decision-self-hosted-brain.md`).
   The live app can reach it **only if a workspace configures the `modal` provider** —
   it is NOT the default daemon path, and per `project_hermes_serving_gap.md` the
   per-company Hermes serving is not yet wired in as standard. `backend/` + `finetuning/`.

## Architecture
### Live production stack (Vercel) — what everything recent targets
- **`api/*` serverless functions** (Node, Vercel): `chat`, `brain`, `inbox`, `tasks`,
  `overview`, `auth/*`, `workspace/*`, `user/*`. Shared libs in `api/_lib/`
  (`security`, `supabase`, `research`, `research_actions`).
- **Supabase** (Postgres + pgvector) — all app data: profiles/workspaces, `daemon_messages`,
  `daemon_memory`, `brain_interactions`, `hunt_findings`, `inbox_items`, `workspace_api_keys`.
  Local `.env`'s `DATABASE_URL_UNPOOLED` IS this prod DB (migrations applied via `pg`).
- **Frontend** (`src/`, React/Vite). `useBrainFetch` calls `VITE_BRAIN_API_URL` if set,
  else the Vercel `/api/*` routes — **and `VITE_BRAIN_API_URL` is NOT set in prod**, so
  the live app runs entirely on the Vercel functions (not the Modal backend).
- **Deploy**: GitHub git-integration → merge to `main` = auto Production deploy at
  **workdaemon-prod.vercel.app** (the `workdaemon` project is a stale empty duplicate);
  branch push → Preview. **Hobby plan caps a deployment at 12 serverless functions and
  `api/` is AT the cap** — new capabilities ship as actions/branches inside existing
  routes, never new files. `vercel.json` holds the daily brain-scan **cron** + security
  headers. Env/secrets best set via the Vercel REST API (CLI 54 can't take stdin); env
  changes need a new deployment (`vercel redeploy <prodUrl>`; CLI `--prod` fails on the
  165MB local dir).

### Self-hosted per-company model track (Modal) — in progress / optional
- `workdaemon-backend` (CPU, scale-to-zero) — FastAPI: agents, chat, RAG, tasks, hunts,
  integrations. URL: https://nelsonanyanime--workdaemon-backend-fastapi-app.modal.run
- `workdaemon-serving` (T4, **scale-to-zero**, idle=$0) — serves per-company models;
  `/api/serve/warm` (`.spawn()`) + `/api/serve/ready` (reads `serving_heartbeat`, never
  wakes the GPU).
- `workdaemon-finetuning` — `run_training` (GPU), `run_company_remote`, scheduled
  `training_cycle` (modal.Cron, 48h). Free local embeddings (fastembed) for RAG.
- Reachable from the live app via the `api/chat.js` `modal` provider (serving base URL +
  `company_id`); the Modal-track milestones below predate the move of active work to the
  Vercel app.

## Shipped milestones — Vercel app (current focus)
_Compact log; deep detail in the linked memory files._
- **Browser QA + three fixes** (06-02) — eyeballed prod end-to-end in a real browser
  (agent-browser); throwaway signup confirmed the daemon now replies (DeepSeek fallback),
  correct date, role-tailored, "Brain ·" attribution. Surfaced + fixed: **(1)** prod
  `agent_profiles` was the Modal track's table (`company_id`/`staff_id`, FK→companies/staff),
  so the app's `user_id`/`access_level` queries silently errored → every user defaulted to
  `junior` and interaction/trust learning never persisted. Fix: gave the app its own
  `app_agent_profiles` table (`migration_app_agent_profiles.sql`, applied) and repointed
  chat.js/brain.js. **(2)** new workspaces 503'd ("No AI provider configured") because
  chat.js's only env fallback was `ANTHROPIC_API_KEY` (unset in prod). Fix: fallback chain
  **DeepSeek → Anthropic → OpenAI** (+ a `deepseek` case in `callProvider`), so a fresh
  workspace's daemon works out-of-the-box on the already-configured DeepSeek key (per-
  workspace key still overrides: `workspace_api_keys` `reasoning` → `openrouter_key` → env).
  **(3)** chat.js persisted via bare fire-and-forget `persist()` → Vercel froze the function
  after `res` returned and **dropped the writes** on slow LLM turns (history/memories/
  interactions/agent-profile). Fix: `waitUntil(persist())` (`@vercel/functions`) keeps the
  function alive until writes finish, no added response latency.
- **Proactive Company Brain** (06-02) — daily 07:00 UTC `vercel.json` cron scans each
  company's market (Brave→DeepSeek) → role-targeted `hunt_findings` + auto-drafted social
  posts → inbox delivery + actions (mark-read, "Use draft", inline detail view). Plus
  daemon live web search, role-aware surfacing, and opt-in **L3 auto-publish** via
  SSRF-guarded webhook (`workspaces.auto_publish`/`publish_webhook_url`). Global across
  all workspaces, not Beta-only. Migrations `workspace_location` / `huntfindings_draft` /
  `l3_autopublish` applied to prod. `project-proactive-brain.md`.
- **Security hardening** (06-02, PR #6) — OWASP pass over `api/`+`src/`+`vercel.json`:
  IDOR/priv-esc closed, prompt-injection delimiting, AES-256-GCM key encryption, SSRF
  guard, Upstash rate limits, schema validation, CSP/HSTS headers.
  `project_security_hardening.md` · `SECURITY.md`.
- **Signup-time research** (06-02) — on signup the daemon researches role + company/
  competitors (Brave+DeepSeek) → role brief (`daemon_memory`) + competitor `hunt_findings`.
  `project_signup_research.md`. ⚠️ Also surfaced/fixed that the **prod DB was
  under-migrated** (missing `daemon_messages`/`daemon_memory`/`brain_interactions`; old
  `hunt_findings` shape) → history/memory/alerts had silently never worked.
  `project_dev_supabase_stale.md`.

## Shipped milestones — Modal/Hermes track (older; see top matter)
- **Instant-response chat** (06-01) — ~1s reply via hosted DeepSeek; the company's Hermes
  phases in once warm via a `serving_heartbeat` readiness gate (no cold-start hang).
  `project_instant_response_live.md`.
- **Daemon UX** (06-01) — per-staff identity, persistent chat history, daemon name/persona.
- **Pilot-ready** — RAG (pgvector), onboarding/ingestion, real tools (Notion/Slack/
  GDrive/GCal), autonomous 48h training; billing deferred. 126 backend tests passing.

## TO DO NEXT (needs YOU)
1. **Paste tool OAuth keys** in root `.env` (placeholders ready):
   NOTION_/SLACK_/GOOGLE_CLIENT_ID+SECRET + a real ENCRYPTION_KEY.
   See `WHERE_TO_ADD_KEYS.md`. Then tell Claude → it refreshes the Modal secret
   `workdaemon-backend-secret` + redeploys so tools go live.
2. ✅ **DONE (2026-06-02)** — browser-eyeballed prod via agent-browser (throwaway
   signup, cleaned up): login, full onboarding incl. the auto-detected location field,
   app shell, Settings → L3 publishing, inbox push + inline detail view all render
   correctly. Surfaced + fixed two issues — see the Browser-QA milestone above.
3. Connect a real company's data (POST /api/integrations/connect) → first live
   ingest is the true test of the connectors.
4. ✅ **DONE (2026-06-02)** — onboarding now captures a "primary market / location"
   field (auto-detected from IP, user-confirmable) → `workspaces.location`, feeding the
   proactive scanner's queries. See the Proactive Company Brain section above.
5. **Delete-a-user from the app UI** (TO BE DONE LATER) — DB side already unblocked:
   `migration_user_delete_fkeys.sql` (commit `fdf6697`, applied to prod) set the four
   dangling `auth.users(id)` FKs (`workspaces.owner_id`, `tasks.assignee_id`,
   `tasks.created_by`, `workspace_invites.invited_by`) to `ON DELETE SET NULL`, so user
   deletes no longer fail. Still need: an API route using the Supabase **service-role**
   Admin API (`auth.admin.deleteUser`), admin/self authz (consistent with the IDOR
   fixes), a confirm UI in member/settings, and an owner-deletion decision (transfer
   vs. orphan, since SET NULL currently orphans owned workspaces). Code task, not a blocker.

## Integrations (planned — Zapier-breadth, native OAuth)
Big workstream scoped: native OAuth connectors so any company can connect its tools
(the daemon reads/acts on real data). Master to-build list = the 9,637-app Zapier
directory (`docs/integrations/CATALOG.md`, Zapier links stripped — we build each
against the app's own OAuth). Architecture + priority order (P0 Slack/Google/MS/
Notion/GitHub/Jira/HubSpot/Salesforce first) + per-app OAuth docs + Definition of Done
in **`INTEGRATIONS.md`**. Key constraint: one `/api/oauth` route for all providers
(12-fn Hobby cap). First connector to build: Slack (reference impl). Not started.

## Known gaps (NOT blockers)
- Cold first turn after idle is served by DeepSeek (instant), not the company's Hermes —
  Hermes phases in once warm (~minutes). For Hermes on turn 1 every time, add a
  business-hours `min_containers=1` warm pool in `finetuning/modal/serve_app.py` (cost).
- Real-time websocket fan-out degraded (REDIS_URL is localhost; Upstash is
  REST-only). Feed persists to DB; UI can poll.
- Trained per-company model needs ~weeks of usage before it beats base DeepSeek.
- Multi-LoRA serving (`finetuning/MULTI_LORA_PLAN.md`) — build at ≥3 trained
  companies for many-companies-per-GPU economics.
- RLS policies are no-ops today (isolation via service-role + CompanyDB); see
  `backend/SECURITY.md`.
- **Shared-DB two-track table collisions** — the Vercel app and the Modal backend share
  one Postgres. Where a v2 app migration used `create table if not exists` and the Modal
  table already squatted the name with a different shape, the app silently ran on the
  wrong schema (hit so far: `daemon_messages`/`daemon_memory`/`brain_interactions`/
  `hunt_findings` → fixed earlier; `agent_profiles` → fixed via `app_agent_profiles`).
  When adding app tables, check for a Modal-shaped table of the same name first.

## Commands
```
# tests
cd backend && .venv/bin/python -m pytest -q
# live end-to-end dry run (seeds throwaway company, real DeepSeek + isolation)
cd backend && .venv/bin/python scripts/dry_run.py
# apply a migration
.venv/bin/python backend/scripts/apply_migration.py backend/migrations/00X.sql
# manually trigger the proactive brain scan (daily cron runs this at 07:00 UTC)
curl -H "Authorization: Bearer $CRON_SECRET" \
  "https://workdaemon-prod.vercel.app/api/brain?action=scan_external"
# redeploy backend (app-stop busts Modal's stale src mount — see modal-mount-cache-gotcha)
cd backend && /Users/mac/workdaemon/finetuning/.venv/bin/modal app stop workdaemon-backend --yes \
  && /Users/mac/workdaemon/finetuning/.venv/bin/modal deploy deploy/modal_app.py
```

## Gotcha
Modal caches the `src` mount across redeploys — if a code change isn't live,
`modal app stop <app> --yes` then redeploy. Verify deployed traceback line numbers
match local. (`modal-mount-cache-gotcha.md`)
