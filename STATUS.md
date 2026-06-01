# WorkDaemon — Status Snapshot

_Last updated: 2026-06-01 · HEAD `dcba4b5` on `origin/main` (instant-response layer merged)_

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
  `src/lib/brainApi.js` + `VITE_BRAIN_API_URL`.

## Production-ready for PILOT companies ✅ (6-task program)
1. ✅ RAG (pgvector, live)         4. ✅ Training on (autonomous 48h)
2. ✅ Onboarding + ingestion       5. ✅ Real tools (Notion/Slack/GDrive/GCal)
3. ✅ Hardening (retries, SECURITY.md)   6. ⏸️ Billing — DEFERRED (free pilots)

120 backend tests passing. Tenant isolation gate green.

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

## TO DO NEXT (needs YOU)
1. **Paste tool OAuth keys** in root `.env` (placeholders ready):
   NOTION_/SLACK_/GOOGLE_CLIENT_ID+SECRET + a real ENCRYPTION_KEY.
   See `WHERE_TO_ADD_KEYS.md`. Then tell Claude → it refreshes the Modal secret
   `workdaemon-backend-secret` + redeploys so tools go live.
2. **Eyeball the deployed app in a browser** — rich-block chat verified via API,
   not yet visually.
3. Connect a real company's data (POST /api/integrations/connect) → first live
   ingest is the true test of the connectors.

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
# redeploy backend (app-stop busts Modal's stale src mount — see modal-mount-cache-gotcha)
cd backend && /Users/mac/workdaemon/finetuning/.venv/bin/modal app stop workdaemon-backend --yes \
  && /Users/mac/workdaemon/finetuning/.venv/bin/modal deploy deploy/modal_app.py
```

## Gotcha
Modal caches the `src` mount across redeploys — if a code change isn't live,
`modal app stop <app> --yes` then redeploy. Verify deployed traceback line numbers
match local. (`modal-mount-cache-gotcha.md`)
