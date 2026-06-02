# WorkDaemon — Status Snapshot

_Last updated: 2026-06-02 · HEAD `52eec33` on `origin/main` (proactive Company Brain shipped + deployed + verified)_

Quick re-entry after a restart. For deep detail see Claude memory
(`~/.claude/projects/-Users-mac-workdaemon/memory/`) — start with
`project_final_buildspec.md`.

## What this is
Per-company AI "brain" platform (WorkDaemon_FINAL_BuildSpec). Each company gets an
isolated brain that learns from its own usage. **DeepSeek V4** does reasoning
(hosted API); each company also trains its **own Hermes-3 LoRA** (`wd-{company_id}`)
on a 48h cycle — agent chat routes to the company's own model when it has one, else
DeepSeek (hybrid). Free local embeddings (fastembed) for RAG. Self-hosted is the
committed direction (not DeepSeek-only) — see `decision-self-hosted-brain.md`.

## Architecture (3 live Modal apps + Supabase + frontend)
- `workdaemon-backend` (CPU, scale-to-zero) — FastAPI: agents, chat, RAG, tasks,
  hunts, integrations. URL: https://nelsonanyanime--workdaemon-backend-fastapi-app.modal.run
- `workdaemon-serving` (T4, **scale-to-zero**, idle=$0) — serves per-company models.
  Now exposes `/api/serve/warm` (Modal `.spawn()`, non-blocking) + `/api/serve/ready`
  (reads the `serving_heartbeat` table — never wakes the GPU).
- `workdaemon-finetuning` — training: `run_training` (GPU), `run_company_remote`,
  scheduled `training_cycle` (modal.Cron, 48h).
- Supabase (Postgres + pgvector) — data, RAG (`memory_chunks`), isolation.
- Frontend: existing Vite/React app (`src/`), talks to backend via
  `src/lib/brainApi.js` + `VITE_BRAIN_API_URL`. **Deployed on Vercel via GitHub
  git-integration: merge to `main` → auto Production deploy at `workdaemon.vercel.app`;
  branch push → Preview.** (No manual frontend deploy needed.)

## Production-ready for PILOT companies ✅ (6-task program)
1. ✅ RAG (pgvector, live)         4. ✅ Training on (autonomous 48h)
2. ✅ Onboarding + ingestion       5. ✅ Real tools (Notion/Slack/GDrive/GCal)
3. ✅ Hardening (retries, SECURITY.md)   6. ⏸️ Billing — DEFERRED (free pilots)

126 backend tests passing. Tenant isolation gate green.

## Instant-response chat ✅ (live in prod, 2026-06-01)
User always gets a reply in ~1s; the company's own Hermes phases in as it warms.
1. **Prewarm on login** — `brainApi.warm()` on `SIGNED_IN` → backend `/api/warm` →
   serving `/api/serve/warm` (`.spawn()`) boots the GPU while the user reads.
2. **Catch-up content** — `[SESSION_START]` is forced onto fast hosted DeepSeek (never
   the cold GPU) + a recent-activity digest, so the greeting is instant.
3. **Readiness gate** — `serving_heartbeat` table replaces the timeout race.
   `CompanyModel.chat()` probes `/api/serve/ready`: warm → Hermes (`follow_redirects`),
   cold → instant DeepSeek + background warm. No more ~150s cold-start hang.
Verified live (company aaaa…01): cold `/ready`=false 2.2s (no wake) → warm at t+205s →
warm `/chat` 3.7s on `wd-{cid}`. Migration `003_serving_heartbeat.sql` applied to prod.

## Daemon UX ✅ (live in prod, 2026-06-01)
- **Per-staff identity fixed** — daemon introduces as "{name}'s Daemon" (not "the
  Company Brain"); sidebar Tasks/Inbox badges are live counts (were hardcoded 3/7).
- **Persistent chat history** — `GET /api/chat/history` restores the transcript on
  login; returning users get `[SESSION_RESUME]` ("welcome back" + what's new), genuinely
  fresh sessions get `[SESSION_START]` (full boot greeting). History is reconstructed
  from the `interactions` table.
- **Daemon character** — `agent_profiles.daemon_name/preferred_name/persona` (migration
  `005_daemon_identity.sql`). `DEFAULT_PERSONA` baseline; greetings render in the daemon's
  voice. Edit 3 ways: in chat (always-allowed `update_daemon` tool), Settings → "Your
  Daemon", or the first-run "offer to be named" greeting. REST: `GET`/`PATCH /api/daemon`.

## Signup-time research + competitor intel ✅ (live in prod, 2026-06-02)
On signup a new user's daemon researches its **role** and the **company/competitors**
on the open web (Brave) and synthesises with DeepSeek, so daemons proactively say
"your competitor just did X → you should Y."
- Engine: `api/_lib/research.js` (Brave search + `resolveLLM` workspace-key→env fallback
  DeepSeek→Anthropic→OpenAI + `callLLM`); domain logic in `api/_lib/research_actions.js`.
- Exposed as `POST /api/brain` actions **`research_role`** (any member → one
  `daemon_memory` `role-brief` row; chat.js `buildMemoriesContext` injects it) and
  **`research_company`** (admin → `workspaces.context` competitors + `<!--auto-market-intel-->`
  notes block; timely moves → `hunt_findings` opportunity|threat surfaced by
  `buildHuntContext`). Kept as brain.js actions (NOT new routes) to stay under the
  **Vercel Hobby 12-serverless-function limit** — standalone routes hit 14 and failed
  to deploy. `Onboarding.jsx` fires both fire-and-forget after setup.
- Verified live (signup→setup→actions via API): role `web_grounded:true`; company
  `web_grounded:true` ~24 sources, real competitors, `findings_created:5` with dated
  events. Prod env (`workdaemon-prod`, the env-provisioned project — NOT the empty
  `workdaemon` project): added `DEEPSEEK_API_KEY/BASE_URL` + `BRAVE_SEARCH_API_KEY`
  (Production + Preview).
- ⚠️ **Prod DB was under-migrated** (same project as local `.env`'s
  `DATABASE_URL_UNPOOLED`): it lacked `daemon_messages`/`daemon_memory`/`brain_interactions`
  and had the old-shape `hunt_findings` — meaning persistent history, daemon memory, AND
  hunt/competitor alerts had silently never worked in prod. Fixed via pg: created the
  missing tables + added `workspace_id` (+v2 cols) to `hunt_findings`, relaxed legacy
  NOT NULLs. See `project-prod-db-undermigrated.md`.

## Security hardening ✅ (live in prod, 2026-06-02 · PR #6)
Full OWASP-aligned pass over the **Vercel app** (`api/` + `src/` + `vercel.json`).
Shared primitives in `api/_lib/security.js`; posture doc `SECURITY.md`. All shipped,
deployed to `workdaemon-prod`, and verified live (headers, API, browser render,
end-to-end encryption round-trip).
- **IDOR/BOLA closed** — no handler trusts client-supplied `user_id`/`workspace_id`;
  every client row-id scoped by `workspace_id`. Fixed priv-esc: `update_agent` is
  admin-only + target-member-checked (a user could previously self-set `executive`).
- **Prompt injection** — user/web/memory content reaching a system prompt (company
  context, memories, hunt findings, research snippets) wrapped in `«UNTRUSTED_INPUT»`
  delimiters + notice; end-user msgs stay in user position; identity fields sanitized.
- **Secrets at rest** — provider API keys AES-256-GCM encrypted (`ENCRYPTION_KEY`);
  backward-compatible. Migration `scripts/encrypt_api_keys.mjs` **applied** (DB now 0
  plaintext keys). No hardcoded secrets; client uses only public `VITE_` vars.
- **SSRF guard** (`assertSafeUrl`) on every user endpoint (ollama/azure/modal + model
  proxy): https-only, blocks loopback/private/link-local/metadata.
- **Rate limiting** — every public endpoint, IP+user, graceful 429, distributed via
  Upstash REST (in-memory fallback). Verified firing in prod.
- **Input validation** — schema-based `validateBody` (types, length, enum, strict
  unknown-field reject) on auth/setup/invite/chat/settings/brain.
- **Headers** in `vercel.json`: CSP (no inline JS), HSTS preload, X-Frame-Options
  DENY, nosniff, Referrer-Policy, Permissions-Policy, COOP.
- **Vercel env**: added `ENCRYPTION_KEY` + `UPSTASH_REDIS_REST_URL/TOKEN` to
  **Production AND Preview** (Preview via REST API, all-branches). The user-facing
  prod project is **`workdaemon-prod`** (the `workdaemon` project is a stale empty
  duplicate). Preview has NO Supabase/DB creds by design (inert; staging DB declined).

## Proactive Company Brain ✅ (live in prod, 2026-06-02)
The brain now watches the outside world and acts — scan → reason → route → draft →
inbox → (optionally) auto-publish. All of it is **global** (runs for every workspace;
verified findings created for Beta Tenant AND Falcon Technologies), not per-company code.
Same daemon-prompt session also fixed: real current date injected, dropped the "Company
Brain" self-identity (it's the per-user **daemon**, drawing on the company-wide Brain;
"Brain · …" tags reserved for genuine brain-sourced intelligence), role-tailored persona,
and the `[SESSION_RESUME]` sentinel no longer persists as a user bubble.

- **Daemon live web search** — `api/chat.js` detects fresh-info intent (search/news/
  latest/online/trending) on the latest user msg → `braveSearchMany` → injects delimited
  (untrusted) "LIVE WEB RESULTS" into the system prompt; prompt forbids "I cannot search
  online". Empty results → answer from knowledge, note it. (commit `adf1217`)
- **External-news scanner** — `scanExternal`/`scanAllWorkspaces` in
  `api/_lib/research_actions.js` (NOT new routes — api/ is AT the 12-fn Hobby cap). Per
  workspace: Brave search scoped to industry + `workspaces.location` (past week) →
  DeepSeek picks MATERIAL developments → deduped `hunt_findings` with `affected_roles`
  (canonical ROLE_TAGS) + `recommendation` + optional `draft`. (commit `cf07646`)
- **Trigger** — `GET /api/brain?action=scan_external` guarded by `CRON_SECRET` (branch
  BEFORE `requireAuth`); **Vercel cron daily 07:00 UTC** (`vercel.json`); `api/brain.js`
  `maxDuration` 60s. `CRON_SECRET` set via the **Vercel REST API** (CLI 54 can't take
  stdin for `env add`; sensitive vars unreadable on `pull`) using the CLI auth token at
  `~/Library/Application Support/com.vercel.cli/auth.json`; env changes need a NEW
  deployment — empty commits / `vercel --prod` (165MB local dir > 100MB) DON'T work,
  `vercel redeploy <prodUrl>` does. Verified live: correct secret → `{"ok":true,…}`,
  wrong → 401.
- **Auto-draft** — scan prompt also drafts a ready-to-post social asset for
  marketing-routed content findings → `hunt_findings.draft`. (commit `bfd33ae`)
- **Role-aware surfacing** — `api/chat.js` `roleToTags(title)` (shared in `research.js`);
  `buildHuntContext` prioritizes findings routed to the user (CEO sees all), shows drafts,
  raises them tagged "Brain · …".
- **Inbox delivery + actions** — scanner pushes `inbox_items` (type 'alert', source
  'daemon', metadata incl. `draft`) to members whose role matches `affected_roles`; sets
  `pushed_to_inbox`. `api/inbox.js`: GET shapes rows (unread/time/level/icon/draft); POST
  marks read/unread. `InboxPage`: click-to-read, MARK ALL READ, **inline detail view**
  (expand body + role chips + draft card), **"Use draft"** seeds the daemon composer via
  `sessionStorage` key `wd_daemon_seed`, Copy. (commits `4113f69`, `65a517d`, `8f16182`)
- **L3 autonomous publishing** — opt-in, triple-gated. `workspaces.auto_publish` +
  `publish_webhook_url` + `hunt_findings.auto_published`. When on, `scanExternal` POSTs
  each content draft to the webhook (SSRF-guarded `assertSafeUrl` → Zapier/Make/n8n/Slack
  → socials), marks `auto_published`, and pushes an "✓ Auto-posted" report (type 'update')
  instead of a confirm-first draft. Settings → "Autonomous Publishing · Level 3"
  (`settings.js` `?publishing=true` GET + `update_publishing` POST, admin-only, refuses
  enable without webhook). Off by default. Verified: real POST to public webhook (payload
  intact) + SSRF blocks internal/non-https. Not enabled on any real workspace. (commit `52eec33`)
- **Location** — `workspaces.location` column; auto-detected from Vercel edge geo headers
  (`security.detectLocation`), exposed via `/api/auth/me`, pre-fills a new Onboarding
  "primary market" field, persisted by `api/user/setup.js`.
- **Migrations applied to prod** (via pg over `DATABASE_URL_UNPOOLED`):
  `migration_workspace_location.sql`, `migration_huntfindings_draft.sql`,
  `migration_l3_autopublish.sql`. See memory `project-proactive-brain.md`.

## TO DO NEXT (needs YOU)
1. **Paste tool OAuth keys** in root `.env` (placeholders ready):
   NOTION_/SLACK_/GOOGLE_CLIENT_ID+SECRET + a real ENCRYPTION_KEY.
   See `WHERE_TO_ADD_KEYS.md`. Then tell Claude → it refreshes the Modal secret
   `workdaemon-backend-secret` + redeploys so tools go live.
2. **Eyeball the deployed app in a browser** — rich-block chat verified via API,
   not yet visually.
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
