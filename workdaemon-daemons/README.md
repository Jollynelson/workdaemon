# WorkDaemon Daemons

The staff agent layer. One Daemon per employee — built on OpenClaw, powered by the Brain.

---

## How it all connects

```
Employee types on Slack
        ↓
   Slack Channel (receives message)
        ↓
   Gateway (routes by email)
        ↓
   Daemon Registry (finds the right Daemon)
        ↓
   Staff Daemon (PM / Designer / Dev / Default)
        ↓
   Layer 1: Personal Memory  ← instant, no API call
   Layer 2: Company Brain    ← RAG via Qdrant + LLM
   Layer 3: Live tool read   ← direct MCP call if fresh data needed
        ↓
   Permission Service        ← L1 suggest / L2 preview / L3 execute
        ↓
   Action executes via MCP   ← Notion, Jira, Gmail etc
        ↓
   Cross-Daemon Bus           ← notify next person's Daemon
        ↓
   Slack Channel (reply)      ← employee sees result
```

---

## File structure

```
src/
├── index.ts              # Entry point — boots Gateway
├── types.ts              # All shared types
├── gateway/
│   └── index.ts          # WorkDaemonGateway — one per company
├── daemon/
│   ├── base.ts           # BaseDaemon — all Daemons extend this
│   ├── registry.ts       # Spawns + tracks all Daemons
│   └── roles/
│       ├── pm.ts         # PM Daemon — task assignment, handoffs
│       └── default.ts    # Default — every other employee
├── bus/
│   └── index.ts          # Cross-Daemon message bus (Redis pub/sub)
├── permissions/
│   └── index.ts          # L1/L2/L3 permission service
├── memory/
│   └── personal.ts       # Personal Daemon memory (Redis)
└── channels/
    └── slack.ts          # Slack delivery + Socket Mode listener
```

---

## Setup

### 1. Add to .env

```env
# Company
COMPANY_ID=acme-corp
COMPANY_NAME="Acme Corp"

# Redis (for bus + personal memory)
REDIS_URL=redis://localhost:6379

# Slack
SLACK_BOT_TOKEN=xoxb-your-bot-token
SLACK_APP_TOKEN=xapp-your-app-token

# Database (same Postgres as Brain)
DATABASE_URL=postgresql://workdaemon:password@localhost:5432/workdaemon
```

### 2. Slack app setup

Create a Slack app at api.slack.com/apps:
- Enable Socket Mode
- Add Bot Token Scopes: `chat:write`, `users:read`, `users:read.email`
- Enable Event Subscriptions: `message.im`
- Install to your workspace

### 3. Add employees to database

```sql
INSERT INTO employees (company_id, name, email, role, daemon_level, channel_pref)
VALUES
  ('acme-corp', 'Nelson',  'nelson@acme.com',  'executive', 3, 'slack'),
  ('acme-corp', 'Amara',   'amara@acme.com',   'pm',        2, 'slack'),
  ('acme-corp', 'Sarah',   'sarah@acme.com',   'designer',  1, 'slack'),
  ('acme-corp', 'James',   'james@acme.com',   'developer', 2, 'slack');
```

### 4. Run

```bash
npm install
npm run dev
```

---

## The demo flow

Nelson messages his Daemon on Slack:

> "Assign the checkout redesign to Sarah, high priority"

What happens:
1. Nelson's Daemon (PM, Level 3) receives it
2. Brain parses the intent — finds Sarah's email
3. Permission check — Level 3, executes immediately
4. Task created in Notion via MCP
5. Bus sends `task_assignment` to Sarah's Daemon
6. Sarah's Daemon checks her capacity — she's got 2 high-priority tasks already
7. Sarah's Daemon notifies her on Slack: "Amara assigned you checkout redesign (high priority). Context: [brief]"
8. Capacity alert sent back to Nelson's Daemon: "Sarah is at capacity"
9. Nelson's Daemon replies to Nelson: "Done — but heads up, Sarah's already got 2 high-priority tasks. Want to adjust the deadline?"

**Nobody opened Notion.**

---

## Adding role-specific Daemons

```typescript
// src/daemon/roles/designer.ts
export class DesignerDaemon extends BaseDaemon {
  protected async on_employee_message(text: string): Promise<boolean> {
    // Handle design-specific intents
    // e.g. "brief received", "requesting feedback", "pushing to dev"
    return false;
  }
}
```

Register it in `src/daemon/registry.ts`:
```typescript
case 'designer': return new DesignerDaemon(deps);
```

---

Built by WorkDaemon · workdaemon.com · Confidential
