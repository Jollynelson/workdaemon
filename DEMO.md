# Cobalt — YC demo company (seeded)

A rich, lived-in **demo** workspace for the Y Combinator demo. Everything is
scoped to one workspace + 7 throwaway accounts and is **fully isolated from real
companies**. Deletable in seconds with one command (safety-guarded).

> This file is the durable log so a new Claude session — or a fresh machine —
> can run, verify, or remove the demo without re-deriving anything.

## Logins
- **URL:** https://app.workdaemon.com/login
- **Password (all 7):** `CobaltDemo2026!`

| Role | Email |
|------|-------|
| CEO & Co-founder (Maya Okafor) | `maya@cobalt-hq.com` |
| CTO & Co-founder (Daniel Levin) | `daniel@cobalt-hq.com` |
| Head of Product (Priya Raman) | `priya@cobalt-hq.com` |
| Head of Sales (Marcus Bell) | `marcus@cobalt-hq.com` |
| Head of Marketing (Sofia Reyes) | `sofia@cobalt-hq.com` |
| Head of People (Aisha Khan) | `aisha@cobalt-hq.com` |
| Head of Finance & Ops (Tom Nakamura) | `tom@cobalt-hq.com` |

## The company
**Cobalt** — Series-A AI-native spend management SaaS (corporate cards + spend
controls + automated month-end close), San Francisco, ~$3.2M ARR, 34 staff,
founded 2022. Runs on the **env DeepSeek key** (no per-workspace key — `api/chat.js`
falls back to `DEEPSEEK_API_KEY`).

## What's seeded
- Rich **Company Brain context** (11 fields), **role-expert briefs** + learned prefs per daemon.
- **8 brain findings** (Ramp price hike, FASB rule, SOC 2 risk, pipeline coverage, hiring, Northwind expansion…) routed to roles, some with drafts → mirrored into inboxes.
- **~89 interactions** spread over 90 days, a recent **chat transcript** per staff, **12 tasks** across statuses.
- **Slack connected** (`Cobalt HQ`) + **22 messages across 6 channels** (#engineering, #sales, #product, #leadership, #marketing, #people, #general) + slack_user_map. The **#engineering ledger-cutover debate** is the showcase; the daemon reads it (`api/chat.js` loads recent `slack_messages` when Slack is connected) and surfaces it as a finding.

## Demo moments
- Log in as **different roles** → each daemon is role-tailored (CEO=board/runway, Sales=pipeline, HR=hiring/confidential).
- The daemon **greets with a proactive briefing** on login.
- As **Daniel**, ask *"what's the debate in #engineering?"* → it summarizes the Slack thread, ties it to the SOC 2 finding, and offers an action_confirm.
- Click **Inbox** (findings + Use draft), **Company Brain**, **Tasks**, **Overview**.

## Manage the demo
```bash
# (re)create from scratch — also (re)generates demo_cobalt_ids.json
node scripts/seed_demo.mjs        # workspace + 7 staff + context/history/findings/tasks
node scripts/seed_slack.mjs       # Slack connected + channels/messages + debate finding

# check what would be removed (no changes)
node scripts/delete_demo.mjs --dry

# REMOVE everything (workspace, all data, all 7 auth users) — safety-guarded to
# only ever touch "Cobalt" with @cobalt-hq.com members; finishes in seconds
node scripts/delete_demo.mjs
```

## Isolation guarantees
- Every seeded row carries `workspace_id = Cobalt`; no insert touches another workspace.
- The only global code change (daemon reads Slack activity) runs **only when that
  workspace has Slack connected** and loads **only that workspace's** messages.
- `delete_demo.mjs` finds the target **by name "Cobalt"**, aborts if there isn't
  exactly one, and **aborts unless every member email ends in `@cobalt-hq.com`** —
  so it can never delete a real company even if run carelessly.
- Note: the **daily brain-scan cron** also scans Cobalt (adds findings over time);
  deleting the workspace stops that. Costs a trivial amount of DeepSeek/Brave/day.
