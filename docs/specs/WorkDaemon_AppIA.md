# WorkDaemon — App Information Architecture

> **Document type:** AI-readable product specification  
> **Covers:** Full app flow, every page, sidebar, auth, profile, settings, sharing model  
> **Version:** 2.0 — June 2026  
> **URL:** app.workdaemon.com  
> **Status:** Active reference — update this document when product decisions change

---

## 1. Document Purpose

This document is the authoritative information architecture (IA) for the WorkDaemon web application. It is written to be parsed and understood by AI systems (Claude Code, Claude in chat, future AI tooling) and human developers alike. When building, extending, or reasoning about any page in the WorkDaemon app, this document takes precedence over prior conversation context.

**What this document covers:**
- Auth and onboarding flows
- Full sidebar navigation structure (all items, descriptions, visibility rules)
- Every page in the app: purpose, URL, what is displayed, what actions are available
- The Team Daemon sharing model
- Profile page contents
- Settings page (all tabs)
- Key terminology and permission system

**What this document does not cover:**
- Backend architecture (see `WorkDaemon_FINAL_BuildSpec.md`)
- Company Brain technical architecture (see `WorkDaemon_CompanyBrain.docx`)
- Brand/visual design tokens (see homepage HTML and `SOUL.md`)

---

## 2. Product Context

### 2.1 What is WorkDaemon?

WorkDaemon is a two-layer AI operating system for companies. It gives every employee a personal AI agent (called a Daemon) and gives the company a shared intelligence layer (called the Company Brain). Work moves between people through Daemon-to-Daemon communication — without anyone switching apps.

**Core tagline:** Your company, queryable.

**Target customer:** 20–200 person tech startups and agencies, initially targeting Google Workspace companies in the Lagos/Nigerian market.

### 2.2 The Two-Layer Architecture

| Layer | Name | What It Does |
|---|---|---|
| Layer 1 | Company Brain | Ingests and indexes all company tools (Slack, Notion, GitHub, Drive, Gmail). Builds a living knowledge graph. Answers plain-language queries in real time. |
| Layer 2 | Staff Daemons | Each employee gets a personal AI agent pre-configured to their role. Reads from the Brain, takes actions, communicates with other Daemons. |

### 2.3 Key Terminology

These terms are used consistently throughout the product and this document. AI systems should map user language to these canonical terms.

| Term | Definition |
|---|---|
| **My Daemon** | The personal conversational AI agent assigned to a specific employee. One per person. Accessed via the My Daemon page. This is a chat interface. |
| **Daemon (autonomous)** | A scheduled, autonomous worker that runs on a defined mission and schedule, reads the Company Brain, and proposes actions for a user to approve. Created by any employee. Distinct from "My Daemon." |
| **Team Daemon** | An autonomous Daemon that has been shared with specific people, a department, or the whole company. Any employee can create one and manage its access. |
| **Company Brain** | The shared company knowledge layer. Indexes content from all connected tools. Answers queries. Feeds context to all Daemons. |
| **Skill** | A reusable capability module that can be attached to any Daemon (personal or autonomous). Examples: Email drafter, Report builder, Meeting briefer. |
| **Daemon Feed** | The real-time stream of structured action logs that Daemons push to the Brain. Ensures the Brain has a complete audit trail. |
| **Connector / Integration** | A tool connected to WorkDaemon. Admin-level connectors feed the Company Brain (read). Personal-level connectors give individual Daemons action capability (write). |
| **Permission Level** | The autonomy tier of a user's personal Daemon (Level 1, 2, or 3). Controls whether the Daemon acts, confirms, or only suggests. |
| **BYOK** | Bring Your Own Key. Paid-tier users provide their own LLM API key. WorkDaemon does not absorb model costs on paid tiers. |

### 2.4 User Roles

| Role | Description | Default Daemon Level | Admin Sidebar Visible |
|---|---|---|---|
| Workspace Creator / Founder | The person who created the workspace. Full admin. | Level 2 | Yes |
| Admin | Granted admin by a workspace creator. | Level 2 | Yes |
| Employee (invited) | Joined via invite link. Standard member. | Level 1 | No |

### 2.5 Daemon Permission Levels

| Level | Name | What the Daemon Does |
|---|---|---|
| Level 1 | Copilot | Reads, summarises, reminds, and suggests. Never executes without explicit user instruction. Default for invited employees. |
| Level 2 | Assistant | Drafts actions and sends them to Inbox for user approval before executing. Default for workspace creators. |
| Level 3 | Autonomous | Executes fully and reports back when done. User-granted only — requires admin approval to unlock. |

---

## 3. Sidebar Navigation

The sidebar is a persistent left panel visible across the entire app. It is divided into two sections: Workspace (visible to all users) and Admin (visible only to users with admin role). Settings and the user profile avatar are always pinned at the bottom.

### 3.1 Workspace Section

| Sidebar Item | Icon | URL | Visible To | Description |
|---|---|---|---|---|
| My Daemon | home | /daemon | All users | Primary interface. Chat with your personal AI agent. Default landing page after login. |
| Daemons | robot | /daemons | All users | Create and manage autonomous scheduled agents. Tabs: My Daemons, Team Daemons. |
| Skills | puzzle | /skills | All users | Library of reusable capability modules attachable to any Daemon. |
| Calendar | calendar | /calendar | All users | Schedule synced from Google Calendar. Daemon meeting prep attached to events. |
| Tasks | checkbox | /tasks | All users | Aggregated view of tasks assigned to the user across all connected tools. |
| Inbox | inbox | /inbox | All users | Approval requests, cross-Daemon messages, broadcasts, alerts. Unread count badge. |
| Integrations | plug | /integrations | All users | Personal OAuth connections that give the user's Daemon action capability. |

**Sidebar order:** My Daemon → Daemons → Skills → Calendar → Tasks → Inbox → Integrations

**Note on Skills position:** Skills sits between Daemons and Calendar because it is a configuration/setup item — accessed when building Daemons or customising My Daemon — not a daily workflow item like Tasks or Inbox. This keeps it discoverable without cluttering the core daily navigation.

### 3.2 Admin Section

Visible only to users with admin role. Shown below a divider after the Workspace section.

| Sidebar Item | Icon | URL | Description |
|---|---|---|---|
| Overview | layout-dashboard | /admin/overview | Company-wide health dashboard: active Daemons, Brain status, pending approvals. |
| Team | users | /admin/team | Manage members, Daemon permission levels, invite and remove staff. |
| Company Brain | brain | /admin/brain | Admin-level data integrations, indexing status, Brain config, embedding model. |
| Audit Log | list-check | /admin/audit | Full chronological log of all Daemon actions across the company. |

### 3.3 Bottom Items (Always Visible)

| Item | Description |
|---|---|
| Settings | Workspace and personal settings. Tabbed page. Admin-only tabs are hidden for non-admins. |
| User avatar | Clicking opens the Profile page (/profile). Displays user initials, name, role, and company beneath it. |

### 3.4 Sidebar Header

The top of the sidebar displays:
- WorkDaemon daemon mark (horseshoe arch SVG icon)
- "WORKDAEMON" in Orbitron typeface
- "Your company, queryable." tagline
- Notification bell icon (top right of header)

---

## 4. Auth & Onboarding

### 4.1 /signup — Sign Up Page

**Layout:** Centred card. WorkDaemon logo above the form.

**Content:**
- Email input + password input
- "Continue with Google" OAuth button (primary option for Google Workspace companies)
- "Already have an account? Log in" link
- After submission: choose path — "I'm setting up my company" or "I received an invite link"

---

### 4.2 New Workspace Flow — /onboarding

For users creating a new company workspace. 5 sequential steps.

**Step 1 — Account**
- Email and password (pre-filled if signed up with email)
- Or Google OAuth confirmation
- Work email strongly preferred — used for domain-based auto-approval of future teammates

**Step 2 — Company details**
- Company name (required)
- Company size: 1–10 / 10–50 / 50–200 / 200+ (single select)
- Industry: Tech startup / Agency / E-commerce / Healthcare / Other (single select)
- Work email domain (e.g. acmecorp.com) — used to auto-approve invite links from colleagues on the same domain

**Step 3 — Your Daemon setup**
- Choose your role: CEO/Founder / PM / HR / Developer / Designer / Finance / Sales / Other
- This role sets the Daemon's default focus, capability set, and opening behaviour
- Daemon permission level: workspace creator starts at Level 2 (Assistant) by default
- Optional: Daemon context brief — a short personal note the Daemon reads every session (e.g. "I'm focused on Q3 launch, prefer concise updates, flag only blockers")

**Step 4 — Connect first integration**
- Google Workspace (recommended — covers Gmail, Calendar, Drive in one OAuth)
- Notion
- Slack
- Skip for now (can be done from Admin > Company Brain later)
- This first connection seeds the Company Brain

**Step 5 — Invite your team**
- Multi-email input field
- Role assignment per invitee
- Skippable — can be done from Admin > Team later
- Invites expire after 7 days
- Auto-approve toggle for same email domain

**On completion:** Redirect to /daemon. Daemon sends a welcome message with company context and first suggested action.

---

### 4.3 Invited Employee Flow — /invite/:token

For users joining an existing workspace via an email invite link.

**Step 1 — Confirm account**
- Pre-filled email from invite token
- Set name + password, or sign in with Google
- Email verified against workspace domain

**Step 2 — Daemon profile**
- Role type pre-set by admin who sent invite (editable)
- Optional context brief: "I'm frontend-focused, prefer async updates"
- Permission starts at Level 1 (Copilot) unless admin pre-set a different level

**Step 3 — Connect personal tools**
- Google (Gmail, Calendar) for action capability
- Skippable — available later from /integrations

**On completion:** Redirect to /daemon. Daemon welcomes with role context and relevant Brain knowledge.

---

### 4.4 /login — Login Page

- Email + password or Google OAuth
- "Forgot password" → sends reset email
- SSO (Enterprise tier) → redirects to company identity provider
- On success → /daemon
- If workspace setup incomplete → resume onboarding

---

## 5. Pages — Workspace

---

### 5.1 My Daemon — /daemon

**Purpose:** The primary interface. A persistent conversational chat with the user's personal AI agent. This is the page users return to most. Default landing page after login.

**Top bar:**
- Role badge (e.g. CEO,FOUNDER)
- Company name (e.g. Beta Tenant)
- NEW button — starts a fresh conversation thread
- Online/Offline toggle — Offline queues messages and delivers when back online

**Daemon status card (top of chat area):**
This card appears at the top of each conversation and shows the current state of the Daemon:

| Field | Description |
|---|---|
| Integrations | Connected tools, or "No tools connected yet" |
| Permission | Current level: Level 1 / Level 2 / Level 3 with plain-language label |
| Memory | Count of loaded Daemon memories |
| Brain intelligence | Active patterns detected, or "No patterns detected yet" |

**Chat area:**
- Daemon messages: left-aligned, dark bubble, WorkDaemon brand mark icon
- User messages: right-aligned, Electric Blue (#3b6ef7) bubble
- Action confirmation cards: appear when Daemon proposes an action (Level 2). Shows what it will do with Approve / Reject / Edit options. On approval, Daemon executes and reports back.
- Error states: red-bordered message bubble (e.g. "Server error 504")
- Thread history: previous conversations accessible from NEW button dropdown

**Input area:**
- Placeholder: "Message your Daemon — Enter to send, Shift+Enter for new line"
- File attachment button (adds document to Daemon context for that message)
- Send button (arrow icon, right side)

---

### 5.2 Daemons — /daemons

**Purpose:** Create and manage autonomous scheduled agents — workers that run on a mission and a schedule, read the Company Brain, and propose actions for approval. These are distinct from My Daemon (the personal chat agent).

**Header:**
- "AUTONOMOUS" eyebrow label (uppercase, Electric Blue)
- "Daemons" page title
- "+ New daemon" button (top right, Electric Blue)

**Tabs:**
- My Daemons
- Team Daemons

---

#### 5.2.1 My Daemons Tab

Shows autonomous Daemons created by the current user. Private by default until shared.

**Daemon card contains:**
- Icon (set by user on creation)
- Daemon name
- Schedule (e.g. "Every Monday 8:00 AM", "Daily at 9:00 AM", "On trigger")
- Status badge: Running / Idle / Error / Paused
- Short mission description
- "Last run" timestamp and result (success / proposed X actions / failed)

**Empty state:**
- Icon centred on page
- "No daemons yet"
- Description: "Create your first autonomous daemon — give it a mission and a schedule, and it will propose brain-grounded actions for you to approve."
- "+ New daemon" button (full width, prominent)

**Creating a new Daemon (modal or new page):**

| Field | Description |
|---|---|
| Name | Daemon display name (e.g. "Weekly metrics report") |
| Mission | Plain-language description of what this Daemon should do (e.g. "Every Monday, pull KPIs from Notion and Linear, draft a summary, and propose sending it to leadership") |
| Schedule | When it runs: specific time / recurring (daily, weekly, monthly) / on trigger (webhook or manual) |
| Skills | Which skills to attach (multi-select from Skills library) |
| Integrations | Which tools this Daemon is allowed to read and act on |
| Output | What it proposes: Draft message / Create task / Send report / Custom |
| Approval required | Toggle — if on, all proposed actions queue in the creator's Inbox for approval before executing |

---

#### 5.2.2 Team Daemons Tab

Shows Daemons that have been shared with the current user, or that the current user has created and shared with others.

**Daemon card (Team):** Same structure as My Daemons card, plus:
- "Shared" badge (Electric Blue)
- "Created by [Name] · [Role]" subtitle
- User's access level displayed (Viewer / User / Editor / Owner)

**Empty state:**
- "No team daemons yet"
- "When a teammate shares a daemon with you, it will appear here."

---

#### 5.2.3 Team Daemon Sharing Model

Any employee (not just admins) can create an autonomous Daemon and share it with specific people, departments, or the whole company. Sharing works like Google Docs — the creator controls access at a granular level.

**Sharing is accessed via:** Share button on any Daemon card, or from inside the Daemon detail view.

**Share dialog fields:**
- Search field: type a name, email, or department to add people
- Company-wide toggle: "Share with everyone at [Company Name]"
- Per-person access level selector (see table below)

**Access levels for Team Daemons:**

| Access Level | What This Person Can Do |
|---|---|
| Viewer | See the Daemon exists, its mission, and its output history. Cannot trigger or modify it. |
| User | Everything Viewer can do, plus manually trigger the Daemon to run. Approval requests for this run go to the Daemon's owner. |
| Editor | Everything User can do, plus modify the Daemon's name, mission, schedule, skills, and config. Cannot delete or transfer ownership. |
| Owner | Full control — all Editor permissions, plus delete, transfer ownership, and manage access for others. |

**Ownership rules:**
- Creator is the default Owner
- There must always be at least one Owner
- Ownership can be transferred to another user by the current Owner
- Admins can view all Team Daemons in the workspace but do not automatically have Editor access — they must be explicitly added

**Access change flow:**
- Changes to access take effect immediately
- The affected person sees the Daemon appear (or disappear) from their Team Daemons tab
- Owners receive a notification when access is modified by another Owner

---

### 5.3 Skills — /skills

**Purpose:** A library of reusable capability modules that can be attached to any Daemon — both My Daemon (personal conversational agent) and autonomous Daemons. Skills define what a Daemon can do beyond reasoning: draft emails, build reports, create tasks, summarise documents, prep meetings.

**Header:**
- "CAPABILITIES" eyebrow label
- "Skills" page title
- "+ Custom skill" button (top right)

**Page description:** "Reusable capabilities you can attach to any Daemon — personal or autonomous."

**Skills grid:** Cards arranged in a responsive grid (3 columns on desktop).

**Skill card contains:**
- Icon (representing the skill's function)
- Skill name
- Short description of what the skill does
- "Attached to: [list of Daemon names]" — shows where this skill is currently active
- Attach / Detach button

**Default skills (pre-built, available to all workspaces):**

| Skill | Description |
|---|---|
| Email drafter | Composes emails in the user's tone using context from the Company Brain. |
| Report builder | Pulls metrics from connected tools and structures them into a readable report. |
| Task creator | Creates and assigns tasks in Notion or Linear from natural language instructions. |
| Meeting briefer | Generates prep notes before any calendar event using attendee history from the Brain. |
| Doc summariser | Reads and condenses any document from Drive or Notion into a structured summary. |
| Broadcast composer | Drafts company-wide announcements, personalising them per recipient role via Daemon-to-Daemon routing. |

**Custom skills:**
- Users can define custom skills in plain language (e.g. "Every Friday, check Linear for overdue tickets and draft a message to the PM")
- Admin can publish a custom skill to the whole workspace so all employees can attach it
- Future: skills marketplace (Phase 5+)

**Skill attachment:**
- Skills can be attached from /skills or from within a Daemon's config screen
- My Daemon (personal) skills are set in Profile > Daemon config or from /skills
- Autonomous Daemon skills are set on Daemon creation or in Daemon settings

---

### 5.4 Calendar — /calendar

**Purpose:** The user's schedule, synced from their connected Google Calendar. Daemon meeting prep is attached to each event, making every meeting context-aware before it starts.

**Views:** Month / Week / Day (toggle, top right)

**Event card displays:**
- Event title, time, location
- Attendee avatars (from company directory)
- Brain icon badge when a Daemon prep brief is ready

**"Prepare me" button (on each event):**
- Daemon generates a meeting brief from the Company Brain:
  - Who is attending and their recent Daemon activity
  - Relevant documents and decisions linked to this meeting's topic
  - Open action items between the user and attendees
  - Suggested agenda points
- Brief appears as a Daemon message in the My Daemon chat (does not navigate away)

**Create event via natural language:**
- Input field at top: "Schedule a review with James Friday 2pm"
- Daemon creates the calendar event and sends the invite
- Requires Google Calendar connected in /integrations

**Day view side panel:**
- Today's schedule in a compact list
- Prep status per meeting (Ready / Preparing / Not started)

---

### 5.5 Tasks — /tasks

**Purpose:** Aggregates all tasks assigned to the current user from every connected tool into a single unified view. Not a replacement for Notion, Jira, or Linear — a surface layer above them.

**Views:**
- Kanban (default): columns are To Do / In Progress / Blocked / Done
- List: flat sortable list with all fields visible

**Filters:** Source tool / Priority / Due date / Assigned by

**Task card displays:**
- Title
- Status badge
- Priority (High / Medium / Low)
- Due date (red if overdue)
- Source tool badge: Notion / Jira / Linear
- "Assigned by" — the Daemon or person that routed this task

**Task card actions:**
- "Ask Daemon" — opens My Daemon with task context pre-loaded. User can ask "what do I need to know about this?" or "what's blocking this?"
- "Mark done + hand off" — marks complete in source tool and routes to the next person via Daemon-to-Daemon communication

---

### 5.6 Inbox — /inbox

**Purpose:** The action centre. Every notification, approval request, cross-Daemon message, and broadcast lands here. Level 2 users see pending Daemon approval requests before any action executes. Unread count badge on sidebar item.

**Filter tabs:** All · Approvals · Messages · Broadcasts · Alerts

**Inbox item types:**

| Type | Description | Primary Action |
|---|---|---|
| Pending approval | My Daemon wants to execute an action (Level 2 mode). Shows exactly what it will do. | Approve / Reject / Edit |
| Daemon-to-Daemon message | A teammate's Daemon sent a task, update, or request via yours. | Reply / Accept task / Dismiss |
| Broadcast | Company-wide announcement routed through your Daemon, summarised in context of your role. | Read / Acknowledge |
| Proactive alert | Daemon detected a blocker, approaching deadline, duplicated work, or missed loop. | Resolve / Snooze / Dismiss |
| System notification | Brain sync complete, integration connected, permission level changed. | Dismiss |

**Per item:**
- Timestamp
- Source (which Daemon or system generated it)
- Priority indicator for alerts
- Mark as done button

---

### 5.7 Integrations — /integrations

**Purpose:** Personal OAuth connections that give the user's Daemon action capability in specific tools. These are separate from the admin-level Company Brain integrations (which handle data ingestion). Connecting here means the Daemon can act on behalf of the user — send emails, create events, assign tasks.

**Key distinction:**
- Company Brain reads tools at the admin level for indexing (passive, read-only)
- Personal integrations give the Daemon write capability on behalf of the individual user

**"Connect to act" pattern:** The Daemon also prompts inline in My Daemon chat the first time it needs a new action type. The user can connect from that prompt without navigating to /integrations.

**Supported personal integrations:**

| Integration | Capabilities Unlocked |
|---|---|
| Google (Gmail, Calendar, Drive) | Send emails, create/edit calendar events, create and share Drive documents |
| Notion | Create pages, assign tasks, add comments |
| GitHub | Create issues, comment on PRs, update status |
| Slack | Send messages, update status |
| Linear | Create issues, update status, assign tasks |

**Per integration card shows:**
- Tool name and icon
- Connection status (Connected / Not connected)
- Last used timestamp
- Disconnect button (on connected integrations)
- Connect button (triggers in-app OAuth flow)

---

## 6. Pages — Admin

These pages are visible only to users with admin role. Non-admins do not see the Admin section in the sidebar.

---

### 6.1 Overview — /admin/overview

**Purpose:** Company-wide health dashboard. The first thing an admin sees when they want to know how the company's Daemons and Brain are performing.

**Metric cards (top row):**
- Active Daemons (users with My Daemon online)
- Tasks completed today (across all Daemons)
- Brain queries today
- Pending approvals (across all Level 2 users)

**Live activity feed:**
Real-time log of Daemon actions across the company. Format: "[Name]'s Daemon → [Action] → [Tool] → [Result]" with timestamp.

**Integration health panel:**
One row per connected company tool. Status: green (syncing normally) / yellow (delayed) / red (error). Last synced timestamp. Link to fix in Company Brain.

**Additional panels:**
- Token usage: this month vs. budget (if BYOK budget alert is configured)
- New member activity: recently joined users and their Daemon setup status
- System alerts: Brain sync errors, integration failures, approvals stale over 24 hours

**Quick actions:**
- Invite team member
- Connect integration
- Broadcast message to all Daemons

---

### 6.2 Team — /admin/team

**Purpose:** Manage all workspace members, their roles, and their Daemon permission levels.

**Members table columns:**
- Name + avatar
- Role
- Daemon level (Level 1 / 2 / 3)
- Status (Active / Invited / Inactive)
- Last active timestamp
- Actions: Edit, Remove

**Top bar:**
- Search by name, role, or department
- Filter by: Daemon level / department / status
- "+ Invite member" button

**Invite member flow:**
- Email input (multi)
- Role assignment
- Optional Daemon level preset (default: Level 1)
- Generates a 7-day invite link
- Auto-approve toggle for same email domain

**Click member row → slide-out panel:**
- Name, email, role, join date, last active
- Daemon permission level — admin can upgrade (Level 1 → 2 → 3) or downgrade. Requires confirmation.
- Connected personal integrations (read-only view)
- Recent Daemon activity: last 10 actions taken by this member's Daemon
- Remove from workspace (with confirmation modal and data retention choice)

---

### 6.3 Company Brain — /admin/brain

**Purpose:** Manage the company's knowledge layer. Connect tools for indexing, monitor Brain health, configure ingestion settings.

**Note:** These are admin-level integrations for data ingestion — distinct from /integrations (personal action capability). The Brain reads tools passively; it does not write to them.

**Brain health panel:**
- Status indicator: Active / Syncing / Error (with colour dot)
- Total documents indexed
- Total vector chunks stored
- Queries today and this month
- Re-index button — triggers full re-ingestion job across all connected tools

**Integrations grid:**
One card per connected tool:
- Tool name and icon
- Status dot (Active / Syncing / Error)
- Documents indexed count
- Last synced timestamp
- Configure button (sync frequency, content scope, exclude folders/channels)
- Disconnect button

**"+ Connect new integration" button:**
Opens integration picker. Available integrations:

| Integration | Phase | Sync Method | Content Indexed |
|---|---|---|---|
| Notion | Phase 1 | API polling (15 min) | Pages, databases, comments, history |
| Gmail | Phase 1 | Gmail MCP / OAuth | Emails, threads, attachments (text) |
| Google Calendar | Phase 1 | Calendar MCP / OAuth | Events, attendees, descriptions, notes |
| Slack | Phase 4 | Events API webhook | Messages, threads, files, channels |
| Google Drive | Phase 4 | Drive API polling | Docs, Sheets, Slides, PDFs |
| GitHub | Phase 4 | Webhooks | PRs, issues, comments, README |
| Jira / Linear | Phase 4 | REST API polling | Tickets, comments, status changes |
| Fireflies / Otter | Phase 4 | Webhook on transcript | Meeting transcripts, summaries, action items |

**Brain configuration section:**
- Embedding model selector: text-embedding-3-small / text-embedding-3-large / nomic-embed-text. Warning banner if switching: "Changing embedding model requires re-indexing all content. This runs in the background but may take several hours."
- Chunk size setting: 256–512 tokens
- Chunk overlap: 64 tokens (default)
- Default sync frequency: 15 min / 1 hr / daily

---

### 6.4 Audit Log — /admin/audit

**Purpose:** Full chronological log of every Daemon action across the company. Transparency layer for admins.

**Log table columns:**
- Timestamp
- Member name
- Daemon action (description)
- Tool affected
- Result (Success / Failed)
- Latency (ms)

**Filters:** Date range / Member / Action type (Read / Write / Communicate / Execute) / Tool / Result

**Search:** Keyword or member name

**Expand row:** Shows full detail:
- Exact prompt sent to Daemon
- Daemon reasoning chain
- Tool API payload
- Raw response
- Token count

**Export:** CSV — filtered selection or full log

---

## 7. Profile — /profile

**Purpose:** Personal identity page and Daemon configuration. Every employee has this page. Accessed by clicking the user avatar at the bottom of the sidebar.

**Sections:**

### 7.1 Identity
- Avatar upload (circle crop)
- Full name (editable)
- Email address (read-only — tied to workspace auth)
- Role title (editable, freeform — "CEO & Founder", "Lead Designer", etc.)
- Company (read-only)

### 7.2 Daemon Configuration
- Daemon display name: defaults to "[Name]'s Daemon", editable
- Role type: the category that shapes Daemon's focus (CEO, PM, Developer, Designer, HR, Finance, Sales, Other). Changeable if role shifts.
- Permission level: shows current level (Level 1 / 2 / 3). "Request upgrade" button sends a request to admin for approval.
- Daemon context brief: optional plain-language note the Daemon reads at the start of every session. Example: "I'm leading the Q3 product launch. I prefer concise updates. Flag only blockers, not status. I'm on Google Calendar and Notion."

### 7.3 Notifications
- Email notifications: on/off toggle
- Telegram: connect Telegram account + on/off toggle
- Alert types (each individually toggleable):
  - Task assigned to me
  - Daemon action completed
  - Broadcast received
  - Approval needed
  - Proactive alert flagged

### 7.4 Personal Integrations
Same content as /integrations page, surfaced here for quick access. See section 5.7.

### 7.5 API Key (Pro/Enterprise only)
- Visible only on Pro and Enterprise tiers where BYOK is active
- Add or replace API key per provider: Anthropic, OpenAI, Google, Azure, Mistral, Ollama
- Key is stored encrypted, never displayed in full after entry

### 7.6 Security
- Change password: current password + new password fields
- Two-factor authentication toggle (if admin has enabled 2FA requirement for the workspace)

---

## 8. Settings — /settings

**Purpose:** Workspace configuration and personal preferences. Tabbed page. Admin-only tabs are hidden entirely from non-admin users. Non-admins may see a subset of tabs relevant to them (e.g. Notifications).

### Tab 1 — Workspace (Admin only)

| Field | Description |
|---|---|
| Company name | Editable text field |
| Company logo | Upload (square crop, shown in sidebar header) |
| Work email domain | Domain for auto-approving invite links (e.g. acmecorp.com) |
| Timezone | Workspace-wide timezone for scheduling Daemons and calendar events |
| Default Daemon level for new members | Level 1 (recommended) / Level 2 / Level 3 |

---

### Tab 2 — Billing & Plan (Admin only)

| Field | Description |
|---|---|
| Current plan | Badge: Free / Pro / Enterprise, with feature summary |
| Seats | Used / available, renewal date |
| Upgrade | CTA to pricing page or in-app checkout |
| Invoices | Downloadable PDFs of past invoices |

**Plan tier summary:**

| Tier | Storage | Model | Daemons | Autonomy |
|---|---|---|---|---|
| Free | WorkDaemon hosted | WorkDaemon (50k tokens/mo) | 1 integration | Read-only / Level 1 |
| Pro | WorkDaemon hosted | BYOK (customer pays) | All integrations | Level 1 + 2 |
| Enterprise | BYOS or hosted | BYOK (customer pays) | All + custom | Level 1, 2, 3 |

---

### Tab 3 — AI & Model (Admin only)

| Field | Description |
|---|---|
| BYOK API keys | Add key per provider: Anthropic, OpenAI, Google (Gemini), Azure OpenAI, Mistral, Ollama (self-hosted), vLLM |
| Token usage dashboard | This month's consumption, broken down by employee and by integration |
| Budget alert threshold | Alert admin at X% of a self-set monthly token budget |
| Embedding model | Selector: text-embedding-3-small (default) / text-embedding-3-large / nomic-embed-text (multilingual) / Ollama local. Warning shown if changing (requires full re-index). |

---

### Tab 4 — Security (Admin only)

| Field | Description |
|---|---|
| SSO configuration | Enterprise only. Provider metadata URL and callback URL. |
| BYOS configuration | Paste vector database connection string and API key. Compatible with Qdrant, Weaviate, Pinecone, pgvector. |
| Enforce 2FA | Require two-factor authentication for all workspace members |
| Active sessions | List of all active login sessions. Revoke all or individual sessions. |

---

### Tab 5 — Notifications (Admin only)

| Field | Description |
|---|---|
| Broadcast permissions | Who can send company-wide Daemon broadcasts: Admins only / All members |
| Broadcast channels | Which channels broadcasts use: In-app / Email / Telegram |
| Quiet hours | Define time windows during which Daemons do not send alerts (respects each member's timezone) |
| Digest mode | Batch real-time alerts into hourly or daily summaries instead of immediate delivery |

---

### Tab 6 — Data (Admin only)

| Field | Description |
|---|---|
| Data retention policy | Delete on cancel vs. 90-day grace period after cancellation |
| Export company data | Download full Brain index + audit log as an archive file |
| Purge Brain data | Delete all indexed content. Requires typing "DELETE" to confirm. |

---

### Tab 7 — Danger Zone (Admin only)

| Action | Description |
|---|---|
| Transfer workspace ownership | Assign full ownership to another admin member. Requires their confirmation. |
| Delete workspace | Permanently delete the workspace after a 30-day grace period. Requires typing the workspace name to confirm. All data is permanently removed. |

---

## 9. Shared Components & Patterns

### 9.1 Notification Bell (Sidebar Header)
- Always visible top right of sidebar header
- Badge count = unread Inbox items
- Clicking opens a quick-view dropdown of the last 5 Inbox items
- "View all" link navigates to /inbox

### 9.2 Daemon Status Dot (User Avatar)
- Green dot: Daemon online and active
- Yellow dot: Daemon idle (no recent activity)
- Grey dot: user offline

### 9.3 "Connect to act" Inline Prompt
When a user asks their Daemon to do something that requires a tool connection they haven't yet made, the Daemon responds with an inline connect prompt in the chat: "To send this email, I need access to your Gmail. [Connect Gmail]". Clicking opens the OAuth flow without leaving chat. After auth, the Daemon continues the task automatically.

### 9.4 Approval Request Card (Inbox / My Daemon)
When a Level 2 Daemon proposes an action:
- Card renders in the My Daemon chat (if triggered from chat) or in Inbox
- Shows: what action, which tool, target (recipient, document, task)
- Three buttons: Approve / Reject / Edit
- On Approve: Daemon executes and reports result
- On Reject: Daemon asks what to do instead
- On Edit: opens an inline form to modify the action before approving

---

## 10. Brand & Design Tokens

AI systems building UI for WorkDaemon should apply these consistently.

| Token | Value | Usage |
|---|---|---|
| Electric Blue | #3b6ef7 | Primary actions, active sidebar items, badges, send button |
| Deep Blue | #1a3dc8 | Hover state for Electric Blue elements |
| Void | #07090e | App background (dark theme) |
| Midnight | #1a2240 | Sidebar background, card backgrounds |
| Ghost White | #eef1ff | Body text on dark backgrounds, light mode background |
| Orbitron | Font family | Display text: logo, page eyebrow labels, section headers |
| DM Sans | Font family | Body text, UI labels, Daemon messages |

**App theme:** Dark by default. The app uses a dark background (near Void). CSS variable system adapts for light/dark mode where applicable.

---

## 11. AI Context Notes

This section is for AI systems reading this document. It provides additional context to prevent common reasoning errors.

### 11.1 Critical Distinctions

**"My Daemon" vs "Daemons":**
- "My Daemon" = the personal conversational agent every user has. Accessed at /daemon. Always exists, one per user.
- "Daemons" (/daemons) = autonomous scheduled workers that users optionally create. A user might have zero autonomous Daemons. The sidebar item "Daemons" refers exclusively to these autonomous workers, not to My Daemon.

**Personal integrations vs. Company Brain integrations:**
- Personal integrations (/integrations) = OAuth connections giving the user's Daemon write capability. E.g. "send an email as me."
- Company Brain integrations (/admin/brain) = admin-level connections that feed data into the Brain for indexing. Read-only, passive.
- Both are called "integrations" in different contexts. Disambiguate by page/context.

**Skills scope:**
- Skills can be attached to both My Daemon (personal chat agent) and autonomous Daemons (scheduled workers)
- Skills are NOT exclusive to the Daemons (/daemons) page
- This is why Skills is a first-class sidebar item, not a tab inside /daemons

### 11.2 Team Daemon Sharing — Key Rules

- Anyone can create a Team Daemon (not admin-only)
- The creator is the default Owner
- Access levels: Viewer / User / Editor / Owner
- Admins can see all Team Daemons in the workspace but do not automatically have edit access
- At least one Owner must exist at all times
- Changes to access are immediate and reflected in the recipient's Team Daemons tab instantly

### 11.3 What WorkDaemon Is Not

- Not a chatbot sitting on top of existing tools
- Not a dashboard or BI tool
- Not an automation builder (like n8n) — though autonomous Daemons have surface similarity, they are grounded in the Company Brain, not arbitrary API flows
- Not a replacement for Notion, Jira, or Slack — those tools continue running. WorkDaemon is the connective tissue above them.

### 11.4 Go-To-Market Context

- Initial target: Google Workspace companies (lowest onboarding friction via Google OAuth)
- Geography: Lagos/Nigerian market as initial pilot
- Company size: 20–200 employees
- Decision maker: Founder, CTO, or Head of Operations

### 11.5 Revenue Model

- Per seat, monthly subscription
- Free: Brain only, 50k tokens/month, 1 integration, read-only
- Pro: Full Daemon, all integrations, Level 1 + 2, BYOK mandatory
- Enterprise: Level 3, BYOS + BYOK, SSO, custom integrations
- WorkDaemon does not resell compute — all paid tiers use customer's own API keys (BYOK)

---

*WorkDaemon · workdaemon.com · Confidential · June 2026*  
*Document maintained by: Nelson Anyanime Paul (CEO, Founder)*  
*For technical architecture, see: WorkDaemon_FINAL_BuildSpec.md*  
*For Company Brain architecture, see: WorkDaemon_CompanyBrain.docx*
