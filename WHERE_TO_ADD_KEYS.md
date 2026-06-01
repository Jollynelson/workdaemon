# Where to add keys (production)

All real values go in the **gitignored root `.env`** (`/Users/mac/workdaemon/.env`).
After editing `.env`, the secrets used by deployed Modal apps must be refreshed
(see "Push to Modal" at the bottom). The frontend reads `VITE_*` vars at build.

## 1. Tool OAuth apps — YOURS, one set, global (NOT access to anyone's data)
These register WorkDaemon as an app so it can ASK each company for access. Each
company then connects its OWN Notion/Slack; we store THEIR token encrypted per
company. You create these once:

```
# Notion → https://www.notion.so/my-integrations  (create a public OAuth integration)
NOTION_CLIENT_ID=
NOTION_CLIENT_SECRET=

# Slack → https://api.slack.com/apps  (create app → OAuth & Permissions;
#   bot scopes: channels:history, chat:write, search:read)
SLACK_CLIENT_ID=
SLACK_CLIENT_SECRET=

OAUTH_REDIRECT_BASE=https://nelsonanyanime--workdaemon-backend-fastapi-app.modal.run
```

NOTE: today a company can connect immediately by pasting a **Notion internal
integration token** or **Slack bot token** via POST /api/integrations/connect —
the OAuth client_id/secret above are for the polished "Connect" button flow.

## 2. Already set (don't touch unless rotating)
- `DEEPSEEK_API_KEY` — the brain. ✅ set
- `NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `DATABASE_URL[_UNPOOLED]` — DB. ✅
- `HF_TOKEN` — where trained adapters are stored. ✅
- `SERVE_MASTER_SECRET` — per-company serving auth. ✅
- `ENCRYPTION_KEY` — encrypts integration tokens at rest. ⚠️ SET A REAL ONE for
  production (a dev fallback is used if empty — fine locally, not for real data).
- `VITE_BRAIN_API_URL` — frontend → backend. ✅

## 3. Optional / later
- `OPENAI_API_KEY` — only if you switch embeddings to OpenAI (default is free local).
- `NEO4J_*` — knowledge graph (RAG works without it).
- `TAVILY_API_KEY`, `FIRECRAWL_API_KEY` — live web learning.
- `LANGSMITH_API_KEY` — tracing.
- Stripe keys — when billing is built (task 23).

## Push to Modal after editing .env
Deployed apps read from Modal secrets, not your local .env. After adding keys:

```
# backend (DeepSeek, Supabase, serving, ENCRYPTION_KEY, tool OAuth):
finetuning/.venv/bin/python - <<'PY'
# recreate workdaemon-backend-secret from .env  (see prior pattern)
PY
# then redeploy:  cd backend && .venv/bin/modal app stop workdaemon-backend --yes && .venv/bin/modal deploy deploy/modal_app.py
```

(For the tool OAuth keys specifically, they must be added to
`workdaemon-backend-secret` so the deployed backend can use them. Tell Claude the
var names are set in .env and it will refresh the Modal secret + redeploy.)
