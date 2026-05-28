# WorkDaemon Brain

The intelligence layer of WorkDaemon. Ingests all company knowledge, builds a living knowledge graph, and answers any question about your company in plain language.

---

## What's in here

```
src/
├── index.ts              # Brain class — main entry point
├── config.ts             # All configuration via env vars
├── types.ts              # Shared TypeScript types
├── store/
│   ├── qdrant.ts         # Vector store — semantic search
│   ├── postgres.ts       # Knowledge graph, cache, behaviour
│   └── schema.sql        # Postgres schema (auto-loaded by Docker)
├── embedder/
│   └── ollama.ts         # nomic-embed-text — free, self-hosted
├── chunker/
│   └── index.ts          # Semantic document chunker
├── connectors/
│   └── gdrive.ts         # Google Drive connector (Phase 1)
├── models/
│   └── router.ts         # Llama 3.1 70B + Claude Sonnet router
├── query/
│   └── rag.ts            # RAG query pipeline
└── onboarding/
    └── index.ts          # Fast onboarding engine
```

---

## Setup

### 1. Start infrastructure

```bash
docker-compose up -d
```

This starts:
- **Qdrant** on port 6333 (vector store)
- **Ollama** on port 11434 (embedding model)
- **Postgres** on port 5432 (knowledge graph)

### 2. Pull the embedding model

```bash
# In a new terminal
ollama pull nomic-embed-text
```

Takes 2–3 minutes. Only needed once.

### 3. Configure environment

```bash
cp .env.example .env
```

Edit `.env` and fill in:
- `COMPANY_ID` and `COMPANY_NAME`
- `GROQ_API_KEY` — free at console.groq.com (for Llama 3.1 70B)
- `ANTHROPIC_API_KEY` — for Claude Sonnet on complex queries
- Google Drive service account credentials

### 4. Set up Google Drive access

Create a service account in Google Cloud Console:
1. Go to IAM & Admin → Service Accounts
2. Create new service account
3. Download JSON key
4. Copy `client_email` and `private_key` into `.env`
5. Share your Google Drive folder with the service account email

### 5. Install dependencies

```bash
npm install
```

### 6. Run onboarding (first time only)

```bash
npm run onboard
```

This will:
- Scan all your Google Drive files
- Embed and index everything (~30–60 minutes depending on size)
- Build your company model using Claude
- Make all Daemons context-aware from day one

---

## Usage

### In your Daemon code

```typescript
import { brain } from 'workdaemon-brain';

// Boot the brain
await brain.boot();

// Query from a Daemon
const answer = await brain.query({
  company_id: 'acme-corp',
  question:   'Who owns the checkout redesign project?',
  asked_by:   'nelson@acme.com',
});

console.log(answer.answer);
// → "Sarah owns the checkout redesign project, assigned by Nelson on May 3rd..."

console.log(answer.model_used);
// → "llama" or "claude"

console.log(answer.cached);
// → true if served from cache

// Start continuous sync (runs every 15 minutes)
brain.start_continuous_sync();
```

### Accept a correction

```typescript
await brain.correct({
  query:          'Who handles onboarding?',
  wrong_answer:   'James handles onboarding',
  correct_answer: 'Amara handles all onboarding from HR',
  corrected_by:   'nelson@acme.com',
});
// Brain never gets this wrong again
```

### Get the company model

```typescript
const model = await brain.get_company_model();
console.log(model.org_structure);     // everyone mapped
console.log(model.active_projects);   // what's in flight
console.log(model.blockers);          // what's stuck
console.log(model.glossary);          // company-specific terms
```

---

## Cost model

| Component | Cost |
|---|---|
| nomic-embed-text (Ollama) | **$0** — self-hosted |
| Llama 3.1 70B (Groq) | **$0** — free tier |
| Claude Sonnet | **$0** on paid tiers — customer BYOK |
| Qdrant | **$0** — self-hosted |
| Postgres | **$0** — self-hosted |
| Server costs | ~$90/month for 4,000 companies |

---

## Adding more connectors

Phase 2+ connectors (Slack, Gmail, Notion, GitHub) slot in here:

```typescript
// src/connectors/slack.ts   — coming Phase 4
// src/connectors/notion.ts  — coming Phase 4
// src/connectors/gmail.ts   — coming Phase 1
```

Each connector implements:
- `full_scan()` — for onboarding
- `delta_sync(cursor)` — for continuous updates

The Brain ingests them automatically without any other changes.

---

## Architecture

```
Google Drive ──┐
Notion ─────── ┤
Slack ──────── ┤──→ Ingestion pipeline
Gmail ──────── ┤      ↓ chunk + embed (nomic-embed-text / Ollama)
GitHub ─────── ┘      ↓
                    Qdrant (vectors) + Postgres (graph, cache, behaviour)
                      ↓
                    RAG Query Engine
                      ↓
              Llama 3.1 70B (simple) or Claude Sonnet (complex)
                      ↓
                 Answer → Daemon → Employee
```

---

Built by WorkDaemon · workdaemon.com · Confidential
