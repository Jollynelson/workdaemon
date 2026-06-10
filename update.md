# WorkDaemon — Update Log

## 2026-06-06 → 06-07 · Self-improvement loop, adaptive actions, and Hermes-on-Modal

A long build session. Everything below is merged to `main` and deployed unless noted.

### 1. Self-improvement loop (the Brain that always improves)
One substrate — **capture signals → distill insights → adapt** — behind four surfaces, all workspace-scoped.
- Tables `learning_signals` + `learning_insights`; engine `api/_lib/learning.js`. (PR #11)
- **Agents** learn from approve/reject/edit (a prompt-style bandit) + research yield → the `MEASURE` loop is real.
- **Daemons** learn from 👍/👎/edits → a per-user "LEARNED PREFERENCES" block.
- **Brain** self-audits (staleness, confidence, contradiction scan) on the daily cron.
- **Codebase** clusters its own errors → proposals routed to the WorkDaemon HQ **inbox** for approval (→ optional GitHub issue via OAuth, never a PR). (PR #17)
- 10k-user **cron scaling**: round-robin cursor + wall-clock budget + skip-inactive + poison-pill hardening. (PRs #12, #15)
- Migrations applied to prod: `migration_agents.sql`, `migration_learning.sql`, `migration_scale.sql`.

### 2. Daemon polish
- **JSON-render fix**: recover unclosed/malformed model JSON so blocks render instead of raw text. (PR #16)
- **SOUL alignment**: cap `reasoning_effort` on reasoner models; add the `broadcast` block. (PR #18)

### 3. Adaptive action cards + executors
- `staged_action` block — an **adaptive** card; buttons adapt to the conversation (Verify & Apply / Reject; Copy / Email…). (PR #19)
- Real executors via `execute_action`: **slack.post/react, slack.dm, jira.comment, gmail.send, gdrive.create_doc, gcal.create_event, notion.create_page/append_text** (+ OAuth scopes + token refresh). (PRs #20, #22)
- **Multi-step orchestration**: one confirm runs a plan across tools → an execution-log timeline. (PR #21)

### 4. Hermes Agent pivot — and Hermes running on Modal ✅
Recognized (from the Hermes docs) the daemon should *be* a per-staff Hermes agent doing its own MCP tool-calling — executors are the cloud-LLM stopgap.
- `hermes` chat provider proxies Daemon Chat to a Hermes gateway (`api/chat.js`). (PR #23)
- Runtime + provisioning + Brain-as-MCP artifacts (PRs #24, #25); Docker alternative (PR #26).
- **Hermes is LIVE on Modal**, verified end to end — the public gateway answered a real `/v1/chat/completions`. The four fixes: clean `debian_slim` + `install.sh` as **root** (not the prebuilt Docker image); `@modal.web_server` must **Popen + return** (blocking was the core bug); a **strong `API_SERVER_KEY`**; and **`custom` provider → `api.deepseek.com`** (built-in deepseek routes via OpenRouter). (PR #27, `hermes/modal_app.py`)

### Current state / open items
- **Cobalt is wired to the Hermes gateway** (test bed; reversible: delete its `workspace_api_keys` provider='hermes' row). Verified the exact `chat.js` path returns 200.
- Hermes gateway: `min_containers=0` (**$0 idle**; first call after idle cold-starts ~60–90s — may exceed the 45s chat timeout. Bump to `min_containers=1` while actively testing: edit `hermes/modal_app.py` + `modal deploy`).
- Modal app: `workdaemon-hermes-cobalt` (gateway + admin + diag). Secret `hermes-cobalt`. Pilot keys saved in `.env` (`HERMES_COBALT_*`).
- **Deferred:** connect a tool to the Cobalt agent via MCP (`admin connect_tool` / `hermes mcp add`) — needs GitHub OAuth creds + a live test; do this next to demo the agent *acting* on a real tool.
- Optional infra to activate later: `GITHUB_CLIENT_ID/SECRET` (code-proposal issues + repo ingest); Vercel **Pro** for >daily crons; a retention job for `learning_signals`.

## 2026-06-07 · Company Brain wired into the Cobalt agent as an MCP tool ✅

The deferred "demo the agent *acting* on a real tool" item — done and live-verified.

- **Read-only Brain-as-MCP surface** on the live API: `GET /api/brain?action=mcp&tool=context|hunt|search` (PR #29, `api/brain.js`). Hardened: token-gated, bound to ONE workspace via `BRAIN_MCP_WORKSPACE_ID` (no caller-supplied workspace id → no IDOR), GET-only, restricted-doc content never exposed, `q` sanitized against PostgREST filter injection. Verified on prod: good token→200 (real Cobalt data), bad token→401, unknown tool→400.
- **`hermes/brain_mcp.py`** points at that surface and runs as a **local stdio subprocess inside the gateway container** — the token never leaves the container, nothing is internet-exposed.
- **`hermes/modal_app.py`**: bundles `brain_mcp.py` + `mcp[cli]`/`httpx` into the image; `gateway()` registers the stdio MCP at startup. **GOTCHA (PR #30):** `hermes mcp add` discovers the tools then asks `Enable all N tools? [Y/n/select]` on a TTY — headless it cancels and saves nothing; feed `y` to stdin. (`--accept-hooks` only covers shell hooks, not this prompt.) Used the one-off `inspect()` entrypoint (`modal run hermes/modal_app.py::inspect`) to verify the real CLI flags + the enable fix without a full gateway cold-start.
- **Config:** Vercel prod has `BRAIN_MCP_TOKEN` + `BRAIN_MCP_WORKSPACE_ID` (=Cobalt `6451c7c2-…836f`); Modal `hermes-cobalt` secret has `BRAIN_MCP_TOKEN` + `WORKDAEMON_API_BASE=https://app.workdaemon.com`. Token also recorded in `.env` (gitignored).
- **Live proof:** Cobalt agent calls `mcp_brain_{company_context,list_hunt_findings,search_knowledge}` and answers with real truth — $3.2M ARR / Series A / Ramp-IPO threat, etc.

**Next:** GitHub MCP for the agent (creds in `.env`; needs the OAuth flow done in the Hermes runtime — interactive, the harder headless case). Gateway is still `min_containers=0` so the first call cold-starts ~60–90s.

## 2026-06-07 (cont.) · Hermes as the daemon for ALL companies + fixes

A long session driven by "make Hermes the daemon for every company, per staff." Grounded in `WorkDaemon_FINAL_BuildSpec.md` + `workdaemon-soul.md` (each agent connected to its company Brain) and the real Hermes docs.

### Fixes shipped (all companies)
- **Daemon raw-JSON render bug** (Gemini emitted malformed JSON → raw `{"blocks"}` wall): force JSON output mode (Gemini `responseMimeType`, OpenAI-compatible `response_format`) + `salvageEnvelope()` recovery. (PR #33)
- **Cloud fallback**: if the self-hosted (hermes) provider fails/times out, the daemon falls back to deepseek → never breaks. (PR #36)
- **GitHub OAuth → agent wiring** (per-workspace) + **per-staff** memory (`X-Hermes-Session-Key`) and tool tokens (executors use each staff's own token). (PRs #32, #35)

### Architecture decided (grounded in spec + Hermes docs + Modal limits)
- Hermes "profiles" are per-PORT/process (profile-per-staff = cost explosion). Per-staff identity rides the per-user **system message** (already built); per-staff **memory** rides `X-Hermes-Session-Key` on a shared gateway; per-staff **tool actions** ride the **executor path** (Hermes MCP tools are fixed per-gateway).
- **Modal caps at 8 web functions** → per-company gateways scale to only ~4. So: **one shared brain-connected gateway is the platform default for all companies**, with dedicated brain-MCP gateways (Cobalt) as premium.
- **The brain reaches every company via context injection** `api/chat.js` already does (RAG docs + hunt findings + graph in `sys`) — so the shared gateway IS brain-connected per company; dedicated gateways add the active brain-MCP *pull*.
- **Per-company signed Brain-MCP tokens** (HMAC, encode workspace_id) so one endpoint serves any company, IDOR-safe. (PR #37)

### Rolled out
- **Shared gateway** `workdaemon-hermes-shared` (warm, `min_containers=1`) serves the fleet; verified `FLEET-OK`.
- All 7 non-Cobalt workspaces pointed at it (`scripts/point_to_shared.mjs`); **Cobalt stays dedicated** (brain-MCP, verified pulling its own brain).
- **Auto-onboard**: chat.js defaults a keyless workspace to the shared gateway (`HERMES_SHARED_GATEWAY_URL/_API_KEY` on Vercel) → every current AND future company auto-runs on a brain-connected Hermes daemon, no per-company deploy/DB row. (PR #38)
- **Cost**: one warm shared container for the whole fleet + Cobalt's scale-to-zero dedicated. Stale per-company secrets/gateways cleaned up.

**GOTCHA (caused a brief Cobalt outage, reverted PR #34):** a Modal Volume CANNOT mount at `/root/.hermes` (Hermes install populates `skills/`; Modal refuses non-empty mount). Persistence (if ever needed) must relocate the home.

**Next:** prewarm tuning (cold path still falls back on a cold shared container if traffic is sparse — currently warm); per-staff GitHub *actions* via executors (wiring shipped, needs a live OAuth connect); optional dedicated gateways for premium companies (mind the 8-web-fn cap).

## 2026-06-08 · Agentic brain pull for all + live verification + history scrub

### Agentic Company-Brain pull — now universal (PR #39)
Hermes can't pass per-request context to MCP tools (docs confirmed), so active brain pull on the shared gateway isn't possible Hermes-side. Implemented it at the **api/chat.js proxy** instead (the FINAL spec's backend-mediated model): the agent may emit a top-level `brain_queries` array (search/hunt/context, max 3); chat.js runs them server-side against THAT workspace's brain (`runBrainQuery` — workspaceId from the authed session, never the prompt → IDOR-safe, no tokens in prompt) and re-calls once with results. So EVERY company — shared-gateway fleet included — gets active multi-hop brain pull, all providers, no per-company gateway. Cobalt's Hermes-native brain-MCP still works too.

### Live verification (agent-browser, prod)
- **Cobalt** (dedicated gateway): logged in as Maya (CEO) — daemon answered with cited company data (Ramp battlecard + SOC 2), sources `Notion / Slack / Company Brain`, clean blocks, **0 raw JSON**, adaptive action card.
- **Beta Tenant** (shared gateway): logged in as Nelson (CEO) — daemon pulled Beta-Tenant-specific brain intel (Lagos tenancy law, $22M FDI) and cited `Company Brain Intelligence / Org Graph`. Confirms the shared-fleet path end to end.

### Render-bug history scrub
- Recovered the 2 pre-fix double-wrapped messages (Beta Tenant) — extracted real blocks (one kanban, one 4 text blocks), **recovered not deleted**. Verified live: the old "My apologies…" raw-JSON message now renders as clean prose; **0 raw-JSON across all history**.
- Made the scrub a first-class capability (PR #40): `api/_lib/scrub.js` (shared salvage/recover lib) + admin action `POST /api/brain {action:"scrub_raw_messages", dry_run?}` (admin-only, workspace-scoped, no new Vercel fn) + `scripts/scrub_raw_messages.mjs` (cross-company CLI, same lib). Verified the admin action live in prod: `200 {scanned:35, fixed:0, deleted:0, dryRun:true}`.
- **Cross-company real scrub run: 67 daemon messages scanned, 0 recovered, 0 deleted** — clean platform-wide.

### Beta Tenant password
Reset to the owner's control (temp password used for the live test was rotated out).

### First automated tests for the api/ backend (vitest)
The JS/api side had no test suite (only the Python `finetuning/` suite, 101 passing). Scaffolded one over the highest-risk logic added this session.
- **Tooling:** vitest 4.x, `npm test` (= `vitest run`), `vitest.config.js` scoped to `api/**/*.test.js` so the Vite/React build + bundle are untouched.
- **Refactor for testability:** extracted `repairJsonEnvelope` + `parseJsonResponse` from `api/chat.js` into `api/_lib/envelope.js` (reusing `salvageEnvelope` from `scrub.js` — single source). Behaviour unchanged (verbatim move; chat.js imports cleanly, all call sites intact).
- **Coverage (26 tests, 3 files, all green):**
  - `scrub.test.js` — salvage / isLeakedEnvelope / recover, incl. the exact production render-bug payload; prose never misclassified.
  - `security.test.js` — signed service tokens: round-trip, tampered sig/body, garbage, and cross-secret rejection (the per-company-token IDOR guarantee).
  - `envelope.test.js` — the full `parseJsonResponse` recovery ladder (clean / fenced / prose-wrapped / `<thinking>`-stripped / truncation-repair / one-bad-block salvage / raw-text fallback / empty).
- So the render fix, per-company token security, and history-scrub logic are now under automated test. **Next candidates:** oauth token parsing, executor per-staff token selection.

## 2026-06-09 · Calendar, autonomous Daemons, and a self-growing Brain Skill Library

Long session, all merged to `main` and deployed (prod DB migrations applied). Commits `acc2b71` → `0fd9fac` (+ this entry).

### 0. Prod data hygiene
- Deleted all non-demo accounts/workspaces (kept only the Cobalt demo): `scripts/delete_nondemo.mjs` (safety-guarded inverse of `delete_demo.mjs`). 7 workspaces + 5 users + child rows removed.

### 1. Calendar (Google + Microsoft + Notion)
- `api/_lib/calendar.js` aggregates upcoming events across Google Calendar + Microsoft 365 (live) + a Notion database (pseudo-calendar; Notion has no real calendar API). Mounted at `GET /api/brain?tab=calendar`; new **Calendar** sidebar tab. Needs `GOOGLE_/MICROSOFT_/NOTION_CLIENT_ID`+`_SECRET` on Vercel — see `docs/CALENDAR_OAUTH_SETUP.md`.

### 2. Daemons — n8n-style, brain-native automations
- Generalized the outreach `agents` engine into autonomous **knowledge daemons**: give one a mission + schedule, it reads the Company Brain and proposes approve-first actions (task/note/draft/alert) that materialize into real tasks/memory/inbox items. `migration_daemons_general.sql` (agents.kind + `daemon_actions` queue); `runKnowledgeDaemon` + `approveAction` in `agent_engine.js`; new **Daemons** sidebar tab.

### 3. Hermes-first daemons
- `chat.js` was already Hermes-first (shared-gateway auto-onboard). Made the autonomous engine + brain synthesis match: `resolveLLM`/`callLLM` now prefer the shared Hermes gateway with a DeepSeek resilience fallback. Daemons run Hermes by default **once `HERMES_SHARED_GATEWAY_URL` + `HERMES_SHARED_API_KEY` are set on Vercel** (still pending → currently DeepSeek). See `docs/HERMES_DAEMON_DEFAULT.md`.

### 4. Brain Skill Library — the "Skills" pillar
The brain HOLDS skills and PASSES them to every daemon at runtime (the agentskills.io runtime-injection model — confirmed via the 2026 Hermes-skill sources; NOT fine-tuned into weights).
- `migration_brain_skills.sql` + `scripts/seed_brain_skills.mjs`: `brain_skills` table (global + per-workspace), seeded with **18 best-practice skills** mapped to the five pillars (Memory · Skills · Soul · Crons · Self-improvement).
- `api/_lib/skills.js`: relevant-skill selection + prompt rendering (injected into the autonomous daemon engine AND `api/chat.js`), MCP exposure (`?action=mcp&tool=list_skills|get_skill` → the Hermes agent pulls the same library), and a **SKILLS tab** in the Brain page.

### 5. Self-growing skills (reactive → autonomous → anticipatory)
- **Learn from approvals:** `learnSkillFromAction` distills a reusable skill when you approve/edit a daemon action.
- **Discover online:** `discoverSkills` finds current capability gaps, searches the web (Brave), and learns grounded skills with source URLs. `migration_brain_skills_discovered.sql` adds `learned_from='discovered'`.
- **Anticipate (super brain):** `anticipateSkills` forecasts skills the company will need in 1–3 months — from trajectory, upcoming calendar, open signals, and rising question topics — and pre-learns them before anyone asks.
- **Self-extend (super daemon):** a knowledge daemon that hits a capability it lacks mid-run names the `skill_gap`; `learnTargetedSkill` learns it on the spot.
- **Event-triggered:** a fresh hunt finding fires `anticipateForEvent` → learns a needed skill immediately (gated/deduped).
- **Decay/curation:** `curateSkills` archives self-acquired skills that go unused past a 30-day TTL (never touches seeded/experience/global).
- Wiring: `growSkills` (reactive + anticipatory + curation) runs in the nightly brain cron per workspace (cooldown-gated) and behind the **"Discover skills online"** button. Discovery needs `BRAVE_SEARCH_API_KEY` (set in prod).
- Verified live on Cobalt: seeded 18; learn-loop minted a skill from an approval; discovery learned 3 gap skills; anticipation forecast EBITDA-modeling / win-loss-battlecards / SOC2-automation; self-extension + event-trigger + curation all confirmed.

### Also
- Installed the `social` / `content-strategy` / `video` marketing skills into the repo (`.agents/skills/`, `skills-lock.json`).

### Open items (yours, not code) — DEFERRED, owner to tackle later
The only two things still gated (documented, not code). Owner said: "I would tackle it later."
- Set Calendar OAuth creds on Vercel (`docs/CALENDAR_OAUTH_SETUP.md`).
- Set `HERMES_SHARED_*` env + keep the gateway warm to flip all daemons to Hermes (`docs/HERMES_DAEMON_DEFAULT.md`).

## 2026-06-10 · Repo audit → hardening pass (branch `audit/hardening`, NOT yet merged)

A full principal-level audit of the repo (4 phases: map → findings → strategy →
task plan), then the plan executed. **Everything below is committed on the
`audit/hardening` branch — review + merge to main to deploy.** 45 tests passing,
lint 0 errors, build clean at every commit.

### Milestone 0 — safety net (didn't exist before)
- **CI**: `.github/workflows/ci.yml` — every push/PR runs `npm ci` + lint +
  test + build. main auto-deploys to prod, so this is the first machine
  between a typo and live users.
- **ESLint**: flat config (`eslint.config.js`), pragmatic ruleset; `npm run
  lint` = 0 errors / 17 warnings. react-hooks v7 compiler rules deferred.
- **Migration ledger**: 33 unordered root `migration_*.sql` → numbered
  `migrations/NNN_name.sql` (ordered by git-add date). `run_migration.mjs`
  now keeps a `schema_migrations` table: `up` / `status` / `--baseline` /
  refuses re-apply + out-of-order. **Prod DB baselined 33/33** (no SQL re-run).
  This kills the "prod under-migrated, nobody knew" failure class (06-02).
- **Tenant-isolation tests** (`api/__tests__/isolation.test.js`): real inbox /
  chat-history / brain-MCP handlers driven against a two-workspace in-memory
  fixture — cross-user reads return nothing, scoped updates are no-ops,
  forged/wrong-scope MCP tokens 401.

### Milestone 1 — security & correctness
- **Fail-closed secrets**: removed the hardcoded `'workdaemon-dev-secret'`
  fallback in `security.js` + `oauth.js`. No secret env → signing THROWS
  (was: silently forgeable brain-MCP tokens + OAuth state). Prod unaffected
  (chain still ends at ENCRYPTION_KEY, which is set).
- **Service tokens**: now stamp `iat`, support `{ expiresInSec }` → `exp`
  honored at verify. Old tokens stay valid. Legacy `BRAIN_MCP_TOKEN` compare
  is now constant-time. `verifyState` no longer throws on mismatched-length
  signatures. In-memory rate-limit map capped (10k buckets).
- **Auth sessions**: password logins now hand the session to the Supabase SDK
  (`setSession`) so the refresh token rotates — sessions no longer hard-expire
  after ~1h; `TOKEN_REFRESHED` keeps the stored token in sync.
- **react-router CVE** (open redirect, GHSA-2j2x-hqr9-3h42) fixed via
  `npm audit fix`. Remaining 2 moderates are esbuild-via-vite (dev-only;
  needs a Vite major bump — deferred).

### Milestone 2 — structure
- **chat.js decomposed** (1,197 → 697 lines): prompt builder →
  `api/_lib/prompt.js` (now unit-tested: injection sanitization, hunt
  routing, connected-tool truth), 9-provider dispatcher →
  `api/_lib/providers.js`, `extractTopicTags` → `api/_lib/topics.js`
  (was duplicated verbatim in chat.js + brain.js).
- **Dashboard.jsx split** (5,024 → 119-line shell): `src/lib/{theme,hooks,
  daemonApi}`, `src/components/{ui,blocks}.jsx`, 13 lazy-loaded page modules
  in `src/pages/app/`. Vite now code-splits per route (pages are 4–35kB
  chunks). Pure mechanical move; dead `PlaceholderPage` dropped.
- **Dead chat paths removed**: the direct-browser Anthropic call
  (`anthropic-dangerous-direct-browser-access` + client-built prompt, gated
  on a `wd_apiKey` nothing sets) and the client `buildDaemonPrompt` are gone —
  the server (`api/_lib/prompt.js`) is the only prompt author.

### Repo hygiene
- Deleted: `workdaemon-ui/` (stale duplicate of src/, untouched since the
  initial commit), `notion/`, both committed code zips, and the `apps/` +
  `packages/` monorepo husks (~300MB of orphaned build artifacts).
- Root package renamed `workdaemon-ui` → `workdaemon`.
- **`.env.example` now documents the FULL env surface** (~70 vars incl. all
  OAuth client pairs; was 15) with required-vs-optional marked.
- **`README.md`** added: entry path (STATUS.md first) + operational cautions.
- `pg` declared as a devDependency (scripts imported it undeclared).

### Deferred (decisions for the owner, from the audit's Open Questions)
- **Vercel Pro?** The 12-function cap is the single constraint most
  distorting the API architecture (multiplexed mega-endpoints). Pay $20/mo
  or write an ADR blessing multiplexing permanently.
- **Python track** (`finetuning/ hermes/ backend/`): quarantine/split/keep —
  left untouched (Modal deploy paths reference current locations).
- **Error reporting** (Sentry or a Vercel log-drain alert): needs an account
  decision; today a prod 500-storm is only visible in Vercel logs.
- **Per-workspace token revocation** before more companies share the Hermes
  gateway (current remedy = rotate the global secret, breaks all).
- Vite major bump for the dev-only esbuild moderates.
