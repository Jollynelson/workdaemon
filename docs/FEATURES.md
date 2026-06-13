# WorkDaemon — Feature Catalog

> **What WorkDaemon is:** a **self-hosted company brain** plus a fleet of **per-staff AI daemons**. The brain *sees everything, remembers everything forever, learns from it, and acts* — while each staffer gets their own daemon that works as them. It's the company's institutional memory and intelligence, owned by the company.

**This is a living document.** It is the canonical catalog of what the brain, the daemons, and the platform can do — written with examples and scenarios for marketing and product reference. **When a new feature ships, add it here.**

**Status legend:** ✅ Live · 🟡 Built, gated/partial · 🔭 Roadmap

---

## 1. The Company Brain

The brain is one shared intelligence per company. "Shared" means a shared *engine* — never shared *data*; every company's knowledge is isolated.

### 1.1 Sees everything — ingestion
The brain ingests from every connected source into one company memory.

- ✅ **Slack — deep + real-time.** Full channel/thread/file history (years, via a resumable backfill worker) plus live webhook sync per message.
  - *Example:* Connect Slack and the brain reads every shared channel back through the company's history, then stays current as new messages arrive.
- ✅ **GitHub — issues, pull requests, and discussion.** Not just titles — the comments and reviews, where the real reasoning lives.
  - *Scenario:* "Why did we drop the Postgres migration?" → the brain answers from the PR discussion where the team debated it.
- 🟡 **Gmail — mail threads.** Decisions, commitments, customer/vendor threads. *(Ready; activates once the Google connection grants mail read access.)*
- ✅ **Documents & corpus.** Anything ingested becomes searchable, grounded company knowledge.
- ✅ **Survives disconnection & departures.** Disconnect a tool and the brain keeps everything it learned — it only loses *live* access, never the memory. When a staffer leaves, what they knew and committed to **stays in the brain.**
  - *Scenario:* A salesperson resigns. Their deals, threads, and commitments remain in the brain, so the company doesn't lose the relationship history.

### 1.2 Remembers everything — memory
- ✅ **Permanent company memory** across documents, conversations, and learned commitments — the brain forgets nothing by design.
- ✅ **Pattern history.** Every observation the brain makes is recorded over time, so it can see trends ("this has been slipping for three weeks"), not just snapshots.

### 1.3 Learns — the self-improving model
- 🟡 **Its own per-company model.** The brain fine-tunes a private model (Qwen3-32B class) on the company's *own* data, served on the company's own GPU — self-hosted intelligence that improves itself, not a generic API. *(Trains, gates, and serves today; routing live user traffic to it is gated on quality — see the gate below.)*
- ✅ **Self-improving loop.** Every cycle it retrains on new data, and a **quality gate** only promotes a new model if it (a) clears an absolute quality floor, (b) beats the previous version, and (c) beats the shared brain — so it can only ever move forward.
  - *Scenario:* After a company accumulates real conversations, the brain trains a model that speaks in the company's voice and knows its workflows — and ships it only once it's measurably better than the generic brain.
- ✅ **Onboarding fast-path.** A data-rich company that connects its tools can have a model trained within ~an hour instead of waiting for the weekly cycle.
- ✅ **Continuous self-teaching.** Beyond the company's own data, the brain proactively researches each role's *current* best practices, new tools, and better ways to work — and distills them into the skill library on its own (recording knowledge is a safe, self-executing action). Round-robin across roles, interval-gated so it's never spammy.
  - *Scenario:* The brain reads what top RevOps leaders are doing this quarter and adds a "signal-based outreach" skill to the Sales Lead's daemon — so the daemon keeps getting sharper at its craft without anyone teaching it.
- ✅ **Learns only what matters.** Two gates keep the model sharp:
  - **Source-trust:** the brain confirms a source is genuinely company-wide before learning from it (e.g. a real company Slack — multiple members/channels — vs a personal one; a corporate email domain vs personal mail). Untrusted sources are still *remembered* for search, just not *learned* from.
  - **Relevance:** even within a trusted source, off-topic content (#random banter, spam, personal chatter) is ingested for memory but never becomes training data.

### 1.4 Reasons & acts — autonomy
- ✅ **Observe → act loop.** On a schedule the brain reads each workspace's signals, **auto-remembers** them, and **proposes** what needs a human — approve-first.
- ✅ **Tiered autonomy.** Safe, internal, reversible moves (recording observations, building pattern history) execute on their own. Consequential or outward moves (anything touching a person, customer, or that sends/reassigns) are drafted to an approval queue. Autonomy widens by *earned track record*, controllable per action type.
- ✅ **Staff performance signals.** Per-person status — on track / quiet / overloaded / at-risk / away — from their open, overdue, and completed work plus availability.
  - *Scenario:* Alice has five items two days overdue and nothing completed. The brain flags her as at-risk and drafts a note to the admin: "Alice may be falling behind — consider a check-in or reprioritizing her overdue items." The admin decides.
- ✅ **Slipping-deadline detector.** Spots work past due and not moving, and surfaces a digest of the worst.
- ✅ **Deal-going-cold & thread-going-quiet detectors.** Flags tracked deals/opportunities or important threads that were active but have gone silent — without nagging a dormant source.
  - *Scenario:* The Acme renewal had weekly activity, then nothing for two weeks while other deals kept moving. The brain flags it: "Acme renewal has gone quiet."
- ✅ **Auto-posted daily digest (first self-executing action).** Each cycle the brain posts an internal summary of what it noticed — "2 teammates need attention, 3 deadlines slipping, 1 deal cold" — *without* asking, because it's safe and informational. This is the first step up the autonomy dial; consequential actions stay approve-first.

### 1.5 Proactive intelligence
- ✅ **External scanner.** A daily pass scans the outside world for what's relevant to each role and drafts findings to the inbox.
  - *Scenario:* A competitor announces a price change; the brain surfaces it to the Head of Sales with context.
- ✅ **Hunt engine.** Business-led search with a relevance gate — opportunity/lead/news hunting grounded in what the company actually does.
- ✅ **Verification gate.** Before acting on or asserting facts, the brain cross-checks sources and flags conflicts.

### 1.6 Skills & goals
- ✅ **Skill library.** A curated set of best-practice skills the brain applies, with a self-improvement learn-loop and the ability to import or discover new skills.
- ✅ **Goals engine.** Self-upgrading company and per-staff goals that the brain helps set, track, and review.

### 1.7 Research
- ✅ **Signup-time research.** On onboarding, the brain researches the role, the company, its competitors, and its market (web-grounded) to seed useful context from day one.

### 1.8 Open surface
- ✅ **Brain-as-a-tool (MCP).** A read-only brain surface other agents can query.

---

## 2. The Daemons (per-staff AI agents)

Every staff member gets their own daemon — an AI that works *as them*, grounded in the brain.

- ✅ **Acts as the staffer.** The daemon represents that person, using their connected tools and their context.
- ✅ **Instant, streaming chat** with persistent history and a consistent character — feels like messaging a sharp colleague, not a chatbot.
- ✅ **Slack act-rail.** A daemon can act for the staffer on Slack, including their DMs, and quietly logs commitments it sees ("can you get me the deck by Friday?") into that person's private memory.
  - *Scenario:* In a DM, a teammate asks Sam for the Q3 numbers by Thursday. Sam's daemon notices and reminds Sam — and remembers the commitment.
- ✅ **Cross-daemon collaboration.** Daemons reason about each other's capacity before handing off work (assign / flag / broadcast).
  - *Scenario:* Before assigning a task to Zoe, the assigner's daemon checks Zoe's load — "Zoe is overloaded (4 open, 2 overdue); reassign to Marcus (1 open)?"
- ✅ **Worker daemons.** A daemon can spin up worker daemons to actually *do* multi-step tasks, then supervise them to completion. Workers reason about the task and self-verify their output against the brain before delivering.
  - *Scenario:* "Draft the customer follow-ups for everyone who churned last month" → the supervisor spawns workers that pull the data, draft grounded messages, check them against the brain, and report back.
- ✅ **Tool use via per-staff connections.** Each person connects their own tool accounts (the Zapier model); the daemon uses those, scoped to them.
- ✅ **Web browsing & research.** Daemons read real pages (guarded) and use live web search to ground answers.
- 🟡 **Goal-driven role agents.** Autonomous agents that pursue a goal (e.g. a Growth Agent) with approve-first autonomy and pluggable channels (email live; social as roadmap).
- ✅ **Autonomous knowledge daemons.** n8n-style daemons that run knowledge workflows on a schedule.

---

## 3. The Platform

- ✅ **Multi-tenant workspaces** — each company fully isolated.
- ✅ **Onboarding** — signup research, role skill toolkits, "equip my daemon" (assigns skills + goals), and the training fast-path.
- ✅ **Integrations** — per-user OAuth connect, with **live two-track seeding status** when a tool connects:
  - 🧠 **Brain ingest** (shared history → company knowledge) and 🤖 **Daemon catch-up** (the staffer's own slice), each filling to 100% with real progress.
  - Reconnect banners, real app icons.
- ✅ **Inbox** — the approve-first queue where the brain's and agents' proposals land for one-tap approval.
- ✅ **Calendar** — unified across Google / Microsoft / Notion.
- ✅ **Tasks** — assignments, due dates, status (the substrate for capacity + deadline signals).
- ✅ **Native Google sign-in** (consent shows workdaemon.com).
- ✅ **Security** — OWASP-hardened: authz (no cross-tenant access), encrypted secrets (AES-GCM), SSRF guard, rate limits, prompt-injection delimiting, strict CSP.
- 🟡 **Skills page / Profile / Team / Audit Log** — present; Team and Audit are being built out.
- ✅ **Architecture** — JS serverless API + Supabase + a warm shared LLM gateway, with the self-hosted model layer on GPU. Company data isolated throughout.

---

## 4. End-to-end scenarios

1. **A new company onboards.** They sign up, the brain researches their company/market, connects Slack, and ingests years of history. Each staffer's daemon is equipped with role skills and goals. From minute one the team can ask their daemons questions grounded in company knowledge.
2. **The brain grows its own intelligence.** As conversations accumulate, the brain trains a private model on the company's own data and ships it only once it beats the generic brain — the company's intelligence compounds and stays in-house.
3. **It catches problems before they're raised.** Overnight the brain notices a teammate is overloaded and two deadlines are slipping, and drafts approve-first alerts with concrete suggestions. The lead approves a reprioritization in one tap.
4. **It remembers through change.** A key employee resigns and their Slack is disconnected — but the brain retains their deals, threads, and commitments, so nothing is lost.
5. **A daemon does real work.** A staffer asks their daemon to handle churn follow-ups; it spawns workers that draft grounded, verified messages and report back for approval.

---

## 5. Roadmap (coming next)

**Recently shipped** (kept here as a record — see the live sections above for detail):
- ✅ **Continuous self-teaching** — research each role's best practices into the skill library (§1.3).
- ✅ **Deal-cold & thread-quiet detectors** — flag tracked work that's gone silent (§1.4).
- ✅ **Auto-posted daily digest** — the first self-executing action (§1.4).

**Coming next:**
- 🔭 **Goals-at-risk signals:** tie staff/deadline signals to the goals engine — flag goals trending to miss.
- 🔭 **Wider auto-execution:** more proven-safe actions self-execute as each earns trust (consequential stays approve-first).
- 🔭 **Live model routing:** route real daemon chats to the company's own model once it beats the shared brain per company.
- 🔭 **Deeper ingestion:** richer connectors (more sources fully ingested) so the brain sees even more.
- 🔭 **Prediction & positioning:** the pattern-layer the first two pillars unlock — forecasting and recommendations from everything the brain remembers.

---

## Maintaining this file

This catalog is the source of truth for "what can WorkDaemon do." 

**Golden rule: only ADD, polish, adjust, or improve — never delete.** This doc only grows. When you ship a feature:
1. Add it under the right section (Brain / Daemons / Platform) with a one-line description **and a concrete example or scenario**.
2. Tag its status (✅ / 🟡 / 🔭) and update the tag as it matures — don't remove the entry.
3. When a roadmap item ships, **mark it ✅ and keep it** (move it to "Recently shipped" in §5 and add its live entry above) — never delete the roadmap line.
4. If it's user-visible and notable, add or update a scenario in §4.
Keep the language plain and concrete — this doc doubles as marketing copy.
