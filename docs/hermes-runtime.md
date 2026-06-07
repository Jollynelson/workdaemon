# WorkDaemon ⇄ Hermes Agent runtime

> The daemon **is** a per-staff Hermes Agent (NousResearch) that does its own MCP
> tool-calling — no backend executors. WorkDaemon's webapp proxies Daemon Chat to
> each staff member's Hermes agent. Sources: Hermes docs
> (`/docs/user-guide/features/api-server`, `/docs/user-guide/docker`,
> `/docs/reference/cli-commands`, `/docs/user-guide/security`).

## Why this replaces the executors
A connected tool is an **MCP server** on the agent's profile. You `hermes mcp add`
the tool once, then tell the agent in natural language and **it calls the tool
itself**, with Hermes' **built-in approval gate** (Manual / Smart / Off). So the
platform adapts to any tool with zero per-tool WorkDaemon code. The `ACTIONS`
executor framework is a stopgap for non-Hermes workspaces and is superseded here.

## 1. Run Hermes (per company) — use Docker, NOT Modal
Official image `nousresearch/hermes-agent`, OpenAI-compatible API server on **:8642**.
Run it as a plain long-lived container — the way it's designed (and how it ran on
your PC). **`hermes/docker-compose.yml`** is ready to go on a small always-on host
(a ~$5 VPS, your machine, or the Hermes Desktop app):
```bash
export HERMES_API_SERVER_KEY=… DEEPSEEK_API_KEY=…
docker compose -f hermes/docker-compose.yml up -d        # gateway at :8642
```

> **Modal does NOT work for this image** (tried thoroughly, 2026-06-07): the image
> uses s6-overlay (needs PID 1), runs as a non-root user that can't write Modal's
> `/pkg`, and a Modal Volume isn't a normal writable FS for a live server. The
> serverless-function model fights the image at every layer. `hermes/modal_app.py`
> is kept only as a record of that attempt — **do not deploy it.** Use Docker.

## 2. One profile per staff member
At onboarding, for each staff member (the WorkDaemon provisioner does this over the
container/SSH):
```bash
hermes profile create <staff_id>                       # the per-staff agent
cp docs/specs/workdaemon-soul.md ~/.hermes/profiles/<staff_id>/SOUL.md   # identity + JSON block contract
hermes -p <staff_id> model                             # set the company's chosen cloud model
hermes -p <staff_id> config set API_SERVER_ENABLED true
hermes -p <staff_id> config set reasoning_effort low   # keep the JSON-block output clean (SOUL §config)
```
`MEMORY.md` / `USER.md` per profile give each staff member persistent, private memory.

## 3. Connect a tool = add an MCP server (no executor)
When a staff member connects a tool in WorkDaemon's Integrations UI, the backend runs:
```bash
hermes -p <staff_id> mcp add <tool> --command npx --args "-y" "@modelcontextprotocol/server-<tool>" \
  --auth oauth         # or: --url <remote-mcp-url> --auth header
```
The agent can now act on that tool during normal conversation. Config changes take
effect on the next session.

## 4. Point a WorkDaemon workspace at its Hermes (provider hook — DONE)
`api/chat.js` has a `hermes` provider (OpenAI-compatible proxy to the gateway).
Configure a workspace to route Daemon Chat to its Hermes agent:
```
workspace_api_keys: { provider:'hermes',
                      endpoint:'https://<company-hermes-host>:8642',   // or the Modal web URL
                      api_key:'<API_SERVER_KEY>',
                      model:'<staff_id>',                              // selects the profile
                      use_case:'reasoning' }
```
Daemon Chat then POSTs to `{endpoint}/v1/chat/completions`; Hermes runs the agent
loop (tools + approval) and returns the SOUL JSON blocks the UI already renders.
> Per-staff routing: today `model` carries the profile; the full FINAL-spec
> per-user endpoint/key (one port per profile) is stage 3.

## 5. The Company Brain (every agent pulls from it)
Expose WorkDaemon's Supabase brain (knowledge, hunt findings, cross-daemon events)
as an **MCP server** and `hermes mcp add brain` to every profile, so each staff's
agent queries company truth. The chat proxy keeps logging interactions back to the
brain (the visibility layer). — stage 5.

## The Brain ⇄ agents (the entity and its fingertips)
The **Company Brain** is the goal-driven entity — always hunting (threats, waste,
opportunities, performance, knowledge; online and in-company) and self-improving.
It stays in WorkDaemon/Supabase (`brain.js` + crons + the learning substrate); the
Hermes agents are how it reaches and acts for each staff member. Two flows:
- **Push (works today):** `api/chat.js` injects the Brain's hunt findings,
  cross-daemon events, and patterns into the system prompt for *every* provider,
  including `hermes` — so the Brain's intelligence already flows into the agent.
- **Pull (stage 5):** `hermes/brain_mcp.py` exposes the Brain as an MCP server;
  `hermes mcp add brain` on each profile lets the agent query company truth.

## Wiring the workspace to its Hermes runtime
After deploying `hermes/modal_app.py`, store the company's Hermes connection on a
`workspace_integrations` row (this is what `api/_lib/hermes_admin.js` reads; the
whole integration is **inert** for workspaces without it):
```
workspace_integrations: provider='hermes', status='connected',
  access_token = <encrypted HERMES_ADMIN_TOKEN>,
  metadata = { admin_url: '<modal admin endpoint URL>',
               gateway_url: '<modal :8642 gateway URL>',
               model_provider: 'anthropic', model: 'claude-sonnet-4-6' }
```
And the chat route (`provider='hermes'`) on `workspace_api_keys` (endpoint =
gateway_url, api_key = API_SERVER_KEY, model = `<staff_id>`).

## Build order
1. ✅ `hermes` provider proxy in `api/chat.js`.
2. ✅ `hermes/modal_app.py` — Hermes image on Modal (:8642) + token-secured `admin`
   HTTP endpoint (provision + connect). **Deployable, not yet deployed/verified.**
3. ✅ Provision wired: `POST /api/brain {action:'provision_hermes'}` → creates the
   caller's profile (SOUL stub + model). Call it at onboarding per staff.
4. ✅ Tool-connect wired: `api/_lib/oauth.js` callback → `connectTool()` adds the
   tool's MCP server to the staff's profile (replaces the executor path).
5. ✅ `hermes/brain_mcp.py` — Brain-as-MCP server (deployable; verify endpoints).
   Interaction logging already flows via `daemon_messages`.

> All WorkDaemon-side wiring (stages 3–4) is **inert until a workspace has the
> Hermes integration row** — it never affects non-Hermes workspaces.

## Verify (first milestone)
Deploy stage 2 for one company (Cobalt), provision one staff profile, connect
GitHub via MCP, set that workspace to `provider:'hermes'`, then in Daemon Chat:
"comment on BUG-119 that it's escalated" → the agent posts it itself and surfaces
Hermes' approval prompt. No WorkDaemon executor involved.
