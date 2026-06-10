# WorkDaemon

Per-company AI platform: every employee gets a personal **daemon** (an LLM agent
tuned to their role) backed by a shared **Company Brain** (knowledge graph,
cross-user patterns, hunt findings, skills library), with native tool
integrations (Slack live), autonomous role-agents, and cross-daemon messaging.

**Live app:** https://app.workdaemon.com (Vercel project `workdaemon-prod`;
merging to `main` auto-deploys production).

## The live stack

| Layer | Where |
|---|---|
| Frontend | `src/` — React 18 + Vite SPA |
| Backend | `api/` — Vercel serverless functions (12, at the Hobby-plan cap; new capabilities ship as actions inside existing routes — see rewrites in `vercel.json`) |
| Shared server libs | `api/_lib/` — `security.js`, `prompt.js`, `providers.js`, connectors, agents engine |
| Data | Supabase (Postgres + pgvector), service-role access, tenant scoping per query |
| Migrations | `migrations/` (numbered), applied via `node scripts/run_migration.mjs` — **targets the prod DB** |

Side tracks (parked, not the live product): `finetuning/` + `hermes/` +
`backend/` — the Modal/self-hosted per-company-model track. See
`docs/PROGRESS.md` for what's real vs. spec.

## Start here

1. **`STATUS.md`** — architecture, shipped milestones, known gaps, gotchas. Read this first.
2. **`update.md`** — session-by-session change log (most recent context).
3. **`DEMO.md`** — the Cobalt demo workspace (logins, seeding, teardown).
4. **`SECURITY.md`** + `docs/specs/` — hardening notes and the product specs.
5. **`.env.example`** — the complete env surface; copy to `.env` and fill.

## Develop

```bash
npm install
npm run dev      # Vite dev server (frontend; /api needs `vercel dev` or prod)
npm test         # vitest — api/_lib unit tests
npm run lint     # eslint over api/ + src/
npm run build    # production build (CI runs test + lint + build on every PR)
```

## Operational cautions

- The `.env` `DATABASE_URL_UNPOOLED` **is the production database**. Migration
  and seed scripts in `scripts/` operate on live customer data; `delete_*.mjs`
  scripts are guarded but treat them accordingly.
- Tenant isolation is enforced per-query (`.eq('workspace_id', …)`) on a
  service-role client — every new query MUST scope by workspace/user.
- Secrets fail closed: `SERVICE_TOKEN_SECRET` / `OAUTH_STATE_SECRET` /
  `ENCRYPTION_KEY` must be set in any deployed env or signing endpoints 500.
