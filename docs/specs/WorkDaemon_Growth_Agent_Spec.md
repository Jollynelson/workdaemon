# WorkDaemon — Autonomous Role Agents (Growth Agent first)

Status: **building** · Created 2026-06-06 · Owner: Nelson

## Why
The product thesis: companies don't want a chatbot, they want **autonomous AI
employees** — each with a role, a target, connected tools, and the authority to
act. The first proof is dogfooding: **WorkDaemon runs a Growth Agent whose KPI is
getting WorkDaemon paying customers.** When that agent books real revenue on its
own, the product sells itself (and the next investor conversation is trivial).

## The abstraction: an Agent
An **Agent** is a goal-driven autonomous worker, distinct from today's reactive
per-person daemon. It has:
- **role** — `sales` | `social` | `support` | `research` | custom
- **objective** — natural-language mission ("get WorkDaemon paying customers")
- **kpi** — measurable target (`{ metric: 'prospects_contacted', target: 50, window: 'week' }`)
- **channels** — which outbound channels it may use (`email`, `x`, `linkedin`)
- **autonomy** — `approve_first` → graduates to `auto_send` per channel as trust climbs
  (reuses the existing L2-confirm → L3-auto permission ladder)
- **schedule** — cron cadence for its run-loop
- **status** — `active` | `paused`

## The loop (one run)
Each run, the agent: **PLAN → RESEARCH → SCORE → DRAFT → QUEUE → (approve) → SEND → MEASURE**

1. **PLAN** — derive/refresh the ICP from the objective (LLM).
2. **RESEARCH** — Brave + web search for matching companies/people (reuses
   `research.js`). Extract firmographics + a contact handle per channel.
3. **SCORE** — rank prospects against the ICP; dedupe against existing targets.
4. **DRAFT** — write a personalized message per target per channel (LLM,
   grounded in the research snippet so it's specific, not spam).
5. **QUEUE** — write `outreach_messages` as `draft`, surface in the inbox.
6. **APPROVE** — human one-click approves (or edits). In `auto_send` mode for a
   trusted channel, this step is skipped.
7. **SEND** — dispatch via the channel plug; record provider id + status.
8. **MEASURE** — track sent/delivered/replied against the KPI; feed the next run.

## Channels (pluggable — `api/_lib/channels/`)
Every channel exposes the same interface so the agent is channel-agnostic:
```
{ id, label, capabilities: { send, dm, post }, configured(env|tokens),
  send({ db, workspaceId, to, subject, body, meta }) -> { providerId, status } }
```
Build order (all three are the target; sequenced by leverage + legality):
1. **email** — highest leverage, fully API-legal. Via ESP (default **Resend**,
   pluggable to SES/Postmark). **Must** use a dedicated sending domain
   (`mail.getworkdaemon.com`) with SPF/DKIM/DMARC + warmup; CAN-SPAM/GDPR
   (physical address + one-click unsubscribe + suppression list). Never send
   from the primary apex domain.
2. **x** — official paid API (post + DM). Rate-limited; good for the social role.
3. **linkedin** — **post-only + engagement** via the official API. **No** cold
   connection requests / DMs — LinkedIn has no API for it and automation gets
   accounts banned. Cold outreach on LinkedIn is explicitly out of scope.

## Data model (`migration_agents.sql`)
- `agents` — the agent definitions (per workspace).
- `agent_runs` — one row per loop execution; metrics + log.
- `outreach_targets` — discovered prospects (company/person/contact/score/status).
- `outreach_messages` — drafted→approved→sent→replied messages, per target/channel.
- `suppression_list` — emails/handles that opted out or bounced (compliance).

## API (one route — Vercel 12-fn cap)
`api/agents.js`, action-router like `brain.js`:
- `POST action=create|update|pause|resume`
- `GET` (list agents) · `GET ?id=` (agent detail + targets + queued messages)
- `POST action=run` — manual trigger of one agent's loop (rate-limited)
- `POST action=approve { messageId, edits? }` — approve → send
- `POST action=reject { messageId }`
- `GET action=run_due` — **cron** (Bearer CRON_SECRET): run every active agent whose schedule is due.

Cron: add `/api/agents?action=run_due` to `vercel.json` crons.

## Guardrails (non-negotiable)
- Approve-first default; auto-send earned per channel via trust score.
- Suppression list checked before every send; honor unsubscribes.
- Rate caps per agent per window (avoid spam/ban thresholds).
- All outbound logged with provider id for audit.
- LinkedIn cold outreach disabled by design.

## Phases
- **P1 (now):** Schema + engine + channel layer + email send + Agents UI; create
  WorkDaemon's own Growth Agent and dogfood approve-first.
- **P2:** X + LinkedIn(post) channels; auto-send graduation; reply tracking.
- **P3:** Generalize so any customer spins up role-agents (Sales/Social/Support).
