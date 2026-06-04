# WorkDaemon — Status Snapshot

_Last updated: 2026-06-03 · `origin/main` (full spec-capability build on the live app: cross-daemon, two-tier routing, pattern/hunt engine, knowledge graph + viz, ingestion + pgvector embeddings on Modal, per-staff Slack + access-scoped privacy; Slack install scope-fix)_

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

- **Daemon latency fix — chat was HANGING, not just slow** (06-04). Live `POST /api/chat`
  never returned (120s+, HTTP 000) for EVERY workspace incl. the Cobalt demo. Root cause:
  `api/_lib/ingestion.js` `embed()` did a `fetch` with **no timeout**, and the Modal
  embeddings endpoint (`workdaemon-embeddings`, scale-to-zero) was failing to cold-start
  (hangs 90s+). Every user turn → `retrieveDocuments` → `embed()` → hung forever; the
  surrounding try/catch can't catch a hang. Fixes: (1) `embed()` now uses
  `AbortSignal.timeout(EMBED_TIMEOUT_MS, default 7000)` on both fetches → on a dead/slow
  endpoint it returns null → keyword-search fallback (daemon responds). (2) **Parallelized**
  the serial context-gathering DB queries in `chat.js` (agent_profile/memory/hunt_findings/
  integrations/history in one `Promise.all`; graph + docs in another) — cuts pre-LLM
  latency. (3) `vercel.json` `api/chat.js` `maxDuration: 45` as a backstop so nothing can
  hang indefinitely again. (4) ✅ **REDEPLOYED `workdaemon-embeddings`** — root cause was it
  wasn't deployed at all (only backend/serving/finetuning were), so the endpoint hung;
  `modal deploy finetuning/modal/embeddings_app.py` restored it at the same URL Vercel uses
  (verified cold 6.2s / warm 1.3s / dim 768). Timeout 7s covers the ~6.2s cold start so
  semantic survives cold turns, yet fails fast if it drops again. Live POST /api/chat:
  hung 120s+ → 200 in ~12s (broken-embeddings build) → ~5s warm expected now. Shipped via
  PR #8 (hang fix) + a follow-up commit (embeddings redeploy + 7s timeout). Also noticed:
  root `.env` has a typo'd `NEXT_PUBLIC_SUPABASE_ANON_KEY==` (double `=`); harmless (prod
  uses Vercel env). Memory: `project-daemon-latency-embeddings`.
- **Spec-capability build — the 4 specs implemented INTO the live app** (06-03). Decision:
  build the `docs/specs/*` capabilities **additively into the Vercel+Supabase app**, NOT
  rebuild to the specs' Python/VPS/Hermes/Neo4j stack; keep the app multi-provider (no
  forced DeepSeek/Hermes swap). The detailed per-capability scorecard is **`docs/PROGRESS.md`**
  (read that first). What shipped + verified on prod this session:
  - **Cross-daemon layer** — daemons assign/accept/flag/broadcast tasks + set availability +
    resolve events. `api/tasks.js` (cross-daemon actions + `execute_action` write-actions +
    GET tasks/members/events), `migration_cross_daemon.sql`. `src/pages/Dashboard.jsx`
    `TasksPage` (DaemonEventCard, AssignComposer, brain-routed badges). Names resolve via
    public `profiles` (auth.users is NOT PostgREST-embeddable — applies everywhere).
  - **Two-tier brain routing** — Flash/Pro escalation adapted to multi-provider by model-string
    swap. `api/_lib/brain_router.js` (`classifyTurn`, `pickTierModels`, `responseIsThin`,
    `wantsDeep`); wired in `api/chat.js`.
  - **Pattern detection + nightly deep pass + hunt engine** — `api/brain.js` actions
    `detect_patterns`/`nightly_pass`/`spawn_task`; `app_detected_patterns` table (the `app_`
    convention — `detected_patterns` was squatted by the parked Python backend). Patterns
    inject into chat (exec-only). `migration_detected_patterns.sql`, `migration_task_from_finding.sql`.
  - **Knowledge graph + graph viz UI** — `buildGraph`/`graphSummary` in `api/brain.js`
    (`build_graph` action), `migration_knowledge_graph.sql`; `GraphTab` in Dashboard injects
    a graph context into chat. Web search + role-aware surfacing already live from 06-02.
  - **Ingestion pipeline + pgvector** — `api/_lib/ingestion.js` (`embed`, `upsertDocuments`,
    `reindexWorkspace`, access-scoped `retrieveDocuments`). `migration_ingestion.sql`,
    `migration_pgvector.sql`, `migration_embeddings_dim.sql` (`vector(768)` for nomic).
    Retrieval falls back to keyword whenever embeddings are absent → KB never breaks.
  - **Platform-managed embeddings on Modal** — customers connect only a *reasoning* key;
    embeddings run on OUR infra. `finetuning/modal/embeddings_app.py` (Ollama nomic-embed-text,
    768-dim, bearer-auth, scale-to-zero). Provider-flexible (`modal`/`ollama`/`openai`/`mistral`
    + `EMBEDDINGS_OPENAI_BASE_URL` for ANY OpenAI-compatible host). Runbook + platform-switching
    matrix: **`docs/EMBEDDINGS_MODAL.md`**; env surface in **`.env.example`** (EMBEDDINGS /
    SENSITIVE blocks). Sensitive-tier reasoning routes to our `modal` provider, not a hosted API.
    Both surfaces are env-config so a later **VPS move is a redeploy, not a code change**.
  - **Per-staff Slack + access-scoped privacy** — staff connect their OWN daemon to Slack
    (per-user user tokens, `slack_user_map`); the Brain knows who-is-who and filters by access.
    `retrieveDocuments` returns `{visible, restricted}`: a non-member gets a *pointer only*
    (title + who to ask), NEVER restricted content, so the daemon suggests "reach out to X"
    or answers minimally instead of oversharing. `migration_doc_access.sql` (visibility +
    allowed_users), `migration_user_integrations.sql`. Verified at DB level: member sees
    private #leadership content; non-member gets pointer only.
  - **Broader Slack ingest + rate-limit backoff** — `_pullViaToken` (users.conversations +
    history + thread replies + pins + files, member-scoped, 1:1 DMs excluded), merges
    per-user ∪ bot tokens by channel id; `slackApi()` honors 429/Retry-After (4 attempts).
  - **Push calibration** — `api/_lib/calibration.js` (`shouldDeliver`, `recordTaskAction`,
    `engagement` back-off). Only read/acted resets the streak; fresh-unread is neutral.
    `migration_push_calibration.sql`. Realtime: `migration_realtime.sql` + Sidebar subscription.
  - **Slack install scope-fix** (06-03, the install-failure screenshot) — public-distribution
    install was erroring **"Invalid permissions requested."** Two causes, both fixed:
    (1) `reminders:write` is a **deprecated** Slack scope → removed from `oauth.js`, the
    manifest, and the dead `add_reminder` tool/`addReminder` fn in the connector; (2) the
    manifest's configured scopes had drifted from what the OAuth URL requests (missing bot
    `channels:join`/`pins:read`/`files:read`; user list missing the channel/history/pins/files
    scopes) — for a *distributed* app any URL scope not in the dashboard = unapproved_scope.
    `docs/integrations/slack-app-manifest.yml` now mirrors `oauth.js` exactly. **Owner action
    to finish: update the Slack app's OAuth scopes to match the manifest (or re-import it),
    then reinstall** — see TO DO NEXT #6.
  - ⚠️ Verification note: prod is behind Vercel's bot-challenge, so headless-browser QA is
    blocked — each capability was verified with **DB-level scripts** (real prod DB via
    `DATABASE_URL_UNPOOLED`), not the browser. Frontend builds clean (vite); all deploys clean.

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
6. **Finish the Slack scope-fix install** (06-03) — code + manifest are fixed; the live
   Slack app config still needs to match. In api.slack.com → your app **A0B7Q4W45NH**:
   either re-import `docs/integrations/slack-app-manifest.yml`, or in **OAuth & Permissions**
   set Bot + User token scopes to exactly the manifest's lists (remove `reminders:write`),
   then **Reinstall** the app. After that the "Invalid permissions requested" install error
   is gone. Existing connected users should disconnect→reconnect to pick up the broader scopes.
7. ✅ **DONE (2026-06-04)** — Modal embeddings deployed + wired + reindexed. App
   `workdaemon-embeddings` live at `https://nelsonanyanime--workdaemon-embeddings-embeddings.modal.run`
   (Ollama nomic-embed-text, **dim 768**, bearer-auth, scale-to-zero). Deploy needed two
   fixes: `zstd` in the image (ollama's installer extracts `.tar.zst`) and a `request: Request`
   annotation (FastAPI was treating it as a query param → 422); both committed (`fc1f176`).
   `EMBEDDINGS_PROVIDER=modal` / `MODAL_EMBEDDINGS_URL` / `MODAL_SERVE_SECRET` set in Vercel
   **Production** (Preview not set — CLI piping flaked; non-critical, previews keyword-fallback).
   Reindexed all docs via `scripts/reindex_embeddings.mjs`: **17/17 documents embedded**
   (Beta Tenant 4, Cobalt 13). Verified semantic re-rank fires (engineering query → #engineering
   @ 0.672 cosine). New ingests auto-embed going forward. Runbook + switching matrix:
   `docs/EMBEDDINGS_MODAL.md`.
8. **Privacy-policy disclosure (do later)** — the per-staff Slack model means each user's
   own token lets the Brain read what THAT user can see; disclose the access-scoped
   read + need-to-know answering behavior in the privacy policy / onboarding consent
   (`public/privacy.html`). Carried over from this session's privacy work.
9. **✅ DONE (2026-06-04) — per-company finetune base = Qwen3-32B, validated on L40S.**
   The base model was swapped twice this session (Gemma 4 12B → Mistral Small 24B → **Qwen3-32B**),
   driven by: wanting "Mistral-24B-like capacity + a large context window" while keeping the
   pipeline **text-only** (so GGUF→Ollama export stays clean). Final pick **`unsloth/Qwen3-32B-unsloth-bnb-4bit`**
   (`finetuning/src/config.py`): 32B, Apache-2.0, **text-only**, native 32K context **extensible to
   128K via YaRN**. (Mistral Small 3.1/3.2 also give 24B+128K+Apache but are *multimodal* — Unsloth's
   vision-model GGUF export is unreliable, so they were rejected.)
   - **Train GPU = L40S (48GB), training-only.** Qwen3-32B 4-bit (~19GB) does NOT fit the L4's 24GB
     (fails at *load*: "modules dispatched on CPU/disk" — not an activation/seq problem). Bumped
     `run_training` to `gpu="L40S"` in `modal_app.py`; it's scale-to-zero so the L40S is billed only
     during a train (~1–2h), never idle. Orchestrator/dataset/GGUF-quant stay CPU; serving is a
     separate fn (still T4). L4 ceiling found empirically: ~24B fits, 32B doesn't.
   - Hyperparams (`config.py`+`hyperparams.py`): `max_seq_length`=**4096**, batch=1, grad_accum=8.
     `modal_app.py` timeouts 6h/7h.
   - **Validated end-to-end** via `scripts/validate_train.py` (GPU-only path: build dataset → train →
     GGUF → HF push; skips the local Ollama gate, unfit for a 24B/32B on a 16GB Mac + no
     ANTHROPIC_API_KEY judge). Result: clean **19.8GB `qwen3-32b.Q4_K_M.gguf`** pushed to HF
     (revision `600de36…`, 56 examples). Mistral 24B 2501 also validated first as a baseline (14.3GB GGUF).
   - **⚠️ KEY GOTCHA fixed:** `base_model` uses `validation_alias="BASE_MODEL"`, and BOTH the root
     `.env` AND the Modal secret `workdaemon-secrets` carried a stale `BASE_MODEL=unsloth/Hermes-3-Llama-3.1-8B-bnb-4bit`.
     **An env var overrides the code default**, so every code-level base swap (Gemma, Mistral) was
     silently INERT — the first "successful" run actually trained Hermes-3-8B (~5GB llama GGUF, the tell).
     Fixed: updated `.env` + recreated the secret (8 keys, only BASE_MODEL changed) → now Qwen3.
     If you change the base again, update `.env` AND the secret, not just `config.py`.
   - Test data: `scripts/seed_test_signals.py --reset` (Acme/Nexus, 60 signals each → 56 examples,
     clears the ≥50 gate). To re-run: `cd finetuning && .venv/bin/modal run scripts/validate_train.py`.
   ⚠️ Still the **sidelined self-hosted track** — per-company models are NOT wired into the live
   daemon (`api/chat.js` `modal` provider unused). Remaining follow-ups (none block this validation):
   (a) serving (`serve_app.py`/`runtime.py`) still parses **Hermes-3** `<tool_call>` format — Qwen3
   uses its own tool-call format; (b) **128K serving** needs YaRN rope-scaling in the Ollama Modelfile
   (cf. `unsloth/Qwen3-32B-128K-GGUF`); (c) ✅ **DONE — gate judge is now provider-configurable**
   (`gate.py` + `config.py` `judge_provider`/`judge_model`), defaulting to **DeepSeek** (was hardcoded to
   Claude via the empty `ANTHROPIC_API_KEY` → 0.5 fallback). DeepSeek/OpenAI go via httpx (OpenAI-compatible),
   Anthropic via SDK. Smoke-tested: good answer→1.0, wrong→0.0; (d) image pre-builds llama.cpp but Unsloth rebuilds it anyway (path
   mismatch, +1–3min, harmless); (e) the `torch==2.6.0/cu124` pin in `modal_app.py` is redundant —
   Unsloth upgrades torch to 2.10.0 itself. Memory: `project-base-model-upgrade-deferred`.

## Integrations — native OAuth connectors (Zapier-breadth)
Native OAuth connectors so any company connects its tools; daemon reads/acts on real
data. Master to-build list = 9,637-app directory (`docs/integrations/CATALOG.md`, Zapier
links stripped). Plan/priority/OAuth-docs/DoD in **`INTEGRATIONS.md`**.

**Foundation BUILT (2026-06-02), deployed:**
- `workspace_integrations` table — encrypted tokens (`migration_workspace_integrations.sql`, applied).
- `api/_lib/oauth.js` — provider registry (`PROVIDERS`), HMAC-signed state, code exchange,
  encrypted upsert (`encryptSecret`), `getAccessToken` (decrypt), `handleOAuthCallback`.
- OAuth hosted in `api/workspace/settings.js` (NO new function — 12-fn cap): pre-auth
  callback branch + POST `oauth_start`/`oauth_disconnect` + GET `?integrations=true`;
  clean `/api/oauth` path via a `vercel.json` rewrite.
- `api/_lib/connectors/slack.js` — Slack Web API reads (channels/history).
- `IntegrationsPage` (replaces placeholder route) — Connect/Disconnect/status + banner.
- chat.js injects connected tools into the daemon prompt (no more "no tools connected").
- Verified: state sign/verify (+tamper reject), authorize-URL build, config detection.

**Slack: LIVE (2026-06-03).** App ID `A0B7Q4W45NH`, public distribution on.
`SLACK_CLIENT_ID/SECRET/SIGNING_SECRET` set in Vercel (prod+preview). Full 32-tool
connector (`api/_lib/connectors/slack.js`, `SLACK_TOOLS`+`runSlackTool`, dual bot/user
tokens). Real-time **Events API** (`api/_lib/connectors/slack_events.js`, signature-
verified, hosted in `api/overview.js` w/ bodyParser off via `/api/slack/events` rewrite):
stores `slack_messages`, @mention→inbox alerts, **@WorkDaemon replies in-thread**.
chat.js now loads recent `slack_messages` into daemon context when Slack is connected.
Manifest: `docs/integrations/slack-app-manifest.yml`.

## Production domain + YC demo (live 2026-06-03)
- **app.workdaemon.com** is live (CNAME `app`→`cname.vercel-dns.com`, auto-SSL); this
  Vercel project serves ONLY the app. Homepage (workdaemon.com) is hosted separately by
  the user. Slack redirect + events URLs updated to app.workdaemon.com (vercel.app kept
  as fallback). `public/privacy.html` is the Slack listing's Privacy URL.
- **Cobalt demo** — a fully-seeded Series-A fintech demo workspace + 7 role logins for
  the YC demo. Everything in **`DEMO.md`** (logins, what's seeded, isolation, manage).
  Scripts (committed): `scripts/seed_demo.mjs`, `scripts/seed_slack.mjs`,
  `scripts/delete_demo.mjs` (`--dry` to preview; safety-guarded to only ever touch
  "Cobalt"/@cobalt-hq.com). Runs on the env DeepSeek key. **To remove: `node
  scripts/delete_demo.mjs`** — clears all data + 7 auth users in seconds, real companies untouched.

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
