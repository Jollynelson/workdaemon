# WorkDaemon — Setup Guide
## From zero to running in under 30 minutes

---

## What you'll have at the end

A fully running WorkDaemon with:
- **Company Brain** — ingesting your Google Drive, answering questions
- **Staff Daemons** — one per employee, with permission levels
- **Cross-Daemon bus** — Daemons talking to each other
- **Web GUI** — chat with any Daemon, watch the bus live at `http://localhost:3000`

---

## Prerequisites

Install these if you don't have them:

| Tool | Version | Install |
|---|---|---|
| Node.js | 20+ | nodejs.org |
| Docker Desktop | latest | docker.com |
| Git | any | git-scm.com |

Check your versions:
```bash
node --version    # should be v20+
docker --version
git --version
```

---

## Step 1 — Get the code

```bash
# Create your project folder
mkdir workdaemon && cd workdaemon

# Copy both zip files here, then unzip
unzip workdaemon-brain.zip
unzip workdaemon-daemons.zip
```

Your structure should look like:
```
workdaemon/
├── workdaemon-brain/
└── workdaemon-daemons/
```

---

## Step 2 — Start the infrastructure

This starts Qdrant (vector store), Ollama (embedding model), and Postgres (knowledge graph).

```bash
cd workdaemon-brain
docker-compose up -d
```

Wait about 30 seconds, then check everything is running:
```bash
docker ps
# Should show: workdaemon-qdrant, workdaemon-ollama, workdaemon-postgres
```

---

## Step 3 — Pull the embedding model

This downloads `nomic-embed-text` into your local Ollama. Only needed once.

```bash
docker exec workdaemon-ollama ollama pull nomic-embed-text
```

Takes 2–3 minutes. You'll see a progress bar.

---

## Step 4 — Start Redis

Redis powers the cross-Daemon bus and personal memory.

```bash
docker run -d --name workdaemon-redis -p 6379:6379 redis:alpine
```

---

## Step 5 — Get your API keys

You need two keys minimum to run the Brain:

### 5a. Groq API key (free — for Llama 3.1 70B)
1. Go to **console.groq.com**
2. Sign up (free)
3. Go to API Keys → Create new key
4. Copy the key

### 5b. Anthropic API key (for Claude Sonnet on complex queries)
1. Go to **console.anthropic.com**
2. Sign up or log in
3. Go to API Keys → Create key
4. Copy the key

---

## Step 6 — Set up Google Drive access

The Brain reads your Google Drive. You need a Service Account.

1. Go to **console.cloud.google.com**
2. Create a new project (or use existing)
3. Enable the **Google Drive API**:
   - Search "Google Drive API" → Enable
4. Create a Service Account:
   - IAM & Admin → Service Accounts → Create
   - Give it a name: `workdaemon-brain`
   - Click Done
5. Create a key:
   - Click the service account → Keys → Add Key → JSON
   - Download the JSON file
6. **Share your Google Drive folder** with the service account email:
   - Open the downloaded JSON file
   - Find `client_email` — it looks like `workdaemon-brain@project.iam.gserviceaccount.com`
   - Right-click your Drive folder → Share → paste the email → Viewer access

---

## Step 7 — Configure the Brain

```bash
cd workdaemon-brain
cp .env.example .env
```

Open `.env` and fill in:

```env
# Your company
COMPANY_ID=your-company-name          # e.g. acme-corp (no spaces)
COMPANY_NAME="Your Company Name"

# From Step 5a
GROQ_API_KEY=gsk_xxxxxxxxxxxxxxxxxxxx

# From Step 5b
ANTHROPIC_API_KEY=sk-ant-xxxxxxxxxxxx

# From the downloaded JSON file (Step 6)
GDRIVE_CLIENT_EMAIL=workdaemon-brain@your-project.iam.gserviceaccount.com
GDRIVE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\nMIIEvg...\n-----END PRIVATE KEY-----\n"

# Leave everything else as default for now
```

**Important for the private key:**
- Open the downloaded JSON file
- Find the `private_key` field
- Copy the entire value (including `-----BEGIN PRIVATE KEY-----`)
- Paste it into .env inside double quotes

---

## Step 8 — Install Brain dependencies

```bash
cd workdaemon-brain
npm install
```

---

## Step 9 — Run the Brain onboarding

This scans your entire Google Drive and builds the company intelligence model.
Run this **once** on first setup.

```bash
npm run onboard
```

You'll see:
```
🧠 WorkDaemon Brain — Onboarding: Your Company Name
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

📂 Phase 1 — Deep scanning Google Drive...
   Scanned 47 files... (latest: Q3 Roadmap.gdoc)
   ✓ Google Drive: 47 documents

⚡ Phase 2 — Embedding 47 documents...
   Embedded 312 chunks from 47/47 docs...
   ✓ Total chunks stored: 312

🤖 Phase 3 — Building company intelligence model...

✅ Onboarding complete!
   • 47 documents ingested
   • 8 people mapped
   • 12 active projects found
   • 23 key decisions extracted
   • 3 current blockers identified
   • 31 company terms learned

🚀 All Daemons are now context-aware and ready.
```

---

## Step 10 — Set up Notion (for task creation)

The PM Daemon creates tasks in Notion when you assign work.

1. Go to **notion.so/my-integrations**
2. Click New Integration
3. Name it `WorkDaemon`
4. Select your workspace
5. Copy the **Internal Integration Token**
6. Share your tasks database with the integration:
   - Open your Notion tasks database
   - Click ··· → Connections → Connect WorkDaemon
7. Copy the database ID from the URL:
   - URL looks like: `notion.so/your-workspace/`**`abc123def456...`**`?v=...`
   - The long ID before the `?` is your database ID

---

## Step 11 — Configure the Daemons

```bash
cd ../workdaemon-daemons
cp .env.example .env
```

Open `.env` and fill in:

```env
# Same as Brain
COMPANY_ID=your-company-name
COMPANY_NAME="Your Company Name"

# Redis
REDIS_URL=redis://localhost:6379

# Database (same Postgres as Brain)
DATABASE_URL=postgresql://workdaemon:password@localhost:5432/workdaemon

# Notion (from Step 10)
NOTION_API_KEY=secret_xxxxxxxxxxxx
NOTION_TASKS_DB_ID=abc123def456...

# Dev mode (no MCP runtime needed)
USE_MCP=false
```

---

## Step 12 — Add your employees to the database

```bash
# Connect to Postgres
docker exec -it workdaemon-postgres psql -U workdaemon -d workdaemon
```

Run this SQL (edit with your real team):

```sql
-- Add your team
INSERT INTO employees (company_id, name, email, role, daemon_level, channel_pref) VALUES
  ('your-company-name', 'Nelson',  'nelson@yourcompany.com',  'executive', 3, 'app'),
  ('your-company-name', 'Amara',   'amara@yourcompany.com',   'pm',        2, 'app'),
  ('your-company-name', 'Sarah',   'sarah@yourcompany.com',   'designer',  1, 'app'),
  ('your-company-name', 'James',   'james@yourcompany.com',   'developer', 2, 'app');

-- Verify
SELECT name, email, role, daemon_level FROM employees;
\q
```

---

## Step 13 — Install Daemon dependencies

```bash
cd workdaemon-daemons
npm install
```

---

## Step 14 — Run the Daemons

```bash
npm run dev
```

You'll see:
```
👻 WorkDaemon Gateway booting...
   Company: Your Company Name
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

✓ Brain ready — 312 chunks in knowledge base
[Bus] Connected — company: your-company-name
[Gateway] Loaded 4 employees
[Tools] Available MCP servers:
   ○ notion (direct API fallback)
   ○ gmail (direct API fallback)
   ○ calendar (direct API fallback)
[Daemon:nelson@yourcompany.com] Booted | Level 3 | 0 tasks | ✓ capacity ok
[Daemon:amara@yourcompany.com]  Booted | Level 2 | 0 tasks | ✓ capacity ok
[Daemon:sarah@yourcompany.com]  Booted | Level 1 | 0 tasks | ✓ capacity ok
[Daemon:james@yourcompany.com]  Booted | Level 2 | 0 tasks | ✓ capacity ok
[HTTP] Web GUI at http://localhost:3000
[WebChannel] WebSocket server on ws://localhost:3001

✅ Gateway ready
   4 Daemons active
   Listening on web channel
```

---

## Step 15 — Open the web GUI

Open your browser:

```
http://localhost:3000
```

You'll see the WorkDaemon Dev Console:
- **Left sidebar** — your employees (click one to chat with their Daemon)
- **Centre** — chat window
- **Right sidebar** — live activity feed (bus messages, Brain queries)

---

## Testing the demo flow

### Test 1 — Brain query (any employee)

Select **Nelson**. Type:
```
What active projects do we have right now?
```
The Brain searches your Drive and answers. Watch the right sidebar — you'll see the Brain query, which model answered it, and whether it was cached.

---

### Test 2 — Task assignment (PM only)

Select **Amara** (PM, Level 2). Type:
```
Assign the checkout redesign to Sarah, high priority
```
1. Amara's Daemon parses the intent via Brain
2. **Level 2 preview card** appears — "Assign checkout redesign to Sarah..."
3. Click **Approve**
4. Task created in Notion ✓
5. Switch to **Sarah** — her Daemon notified her
6. Right sidebar shows the bus event: Amara's Daemon → Sarah's Daemon

---

### Test 3 — Capacity check

Select **Amara**. Type:
```
Assign another urgent task to Sarah
```
Sarah's Daemon will flag she's at capacity. Amara's Daemon asks what to do.

---

### Test 4 — Blocker escalation

Select **Sarah**. Type:
```
I'm blocked — I don't have the design brief for checkout
```
Sarah's Daemon finds the PM (Amara) and sends a blocker flag via the bus. Switch to **Amara** — she's been notified.

---

### Test 5 — Brain correction

Select **Nelson**. Type something, get a wrong answer. Then type:
```
That's wrong. The correct answer is: [correct info]
```
The correction is embedded back into the Brain. Ask the same question again — it answers correctly.

---

## Running both Brain and Daemons together

You need two terminal windows:

**Terminal 1 — Brain continuous sync:**
```bash
cd workdaemon-brain
npm run dev
```

**Terminal 2 — Daemon Gateway:**
```bash
cd workdaemon-daemons
npm run dev
```

Both must be running for the full system to work.

---

## Troubleshooting

| Problem | Fix |
|---|---|
| `Ollama not reachable` | Run `docker-compose up -d` in workdaemon-brain |
| `nomic-embed-text not found` | Run `docker exec workdaemon-ollama ollama pull nomic-embed-text` |
| `No connection for email` | Refresh the web GUI and click the employee again |
| `Notion task not created` | Check NOTION_API_KEY and NOTION_TASKS_DB_ID in .env |
| `Brain returns empty answers` | Re-run `npm run onboard` — Drive may not have been scanned |
| `WebSocket disconnected` | Check Gateway is running on port 3001 |
| `GROQ_API_KEY missing` | Get free key at console.groq.com |

---

## What's running where

| Service | Port | What it does |
|---|---|---|
| Qdrant | 6333 | Vector store — Brain's long-term memory |
| Ollama | 11434 | Embedding model — nomic-embed-text |
| Postgres | 5432 | Knowledge graph, cache, employees |
| Redis | 6379 | Cross-Daemon bus, personal memory |
| HTTP server | 3000 | Serves the web GUI |
| WebSocket | 3001 | Real-time Daemon ↔ GUI communication |

---

## Next steps after setup

1. **Add more employees** — insert into the `employees` table
2. **Add Slack integration** — swap `WebChannel` back to `SlackChannel`
3. **Add Notion connector** to Brain — see `src/connectors/` (copy gdrive.ts pattern)
4. **Build role Daemons** — extend `BaseDaemon` for HR, Finance, Sales
5. **Deploy to cloud** — each company gets one Docker container

---

*WorkDaemon · workdaemon.com · Confidential · May 2026*
