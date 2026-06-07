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
