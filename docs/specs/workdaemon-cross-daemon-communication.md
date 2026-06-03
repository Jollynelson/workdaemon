# WorkDaemon — Cross-Daemon Communication

> How agents negotiate, handoff, and coordinate in real time
> Version 1.0 · May 2026 · workdaemon.com

---

## The Core Idea

Your Daemon talks to other people's Daemons so you don't have to talk to the
people directly. When you tell your Daemon to do something that involves another
person, your Daemon doesn't send a message to that person. It sends a structured
event to *their Daemon*, which reasons about it, checks context, and decides
how to respond — before anything surfaces to a human.

```
You → Your Daemon → Company Brain → Their Daemon → Them
```

But it goes further than message passing. Each Daemon is a reasoning agent with
its own context — workload, calendar, capacity, history. Before anything is
assigned, accepted, or surfaced, the Daemons negotiate. The human only steps in
when there is a genuine decision to make.

---

## Real-Time Notification

When Amara's Daemon assigns the Checkout Redesign to Zoe, Zoe's Daemon is
notified **immediately** — not at next session start. The Brain fires a push
event the moment the assignment is made. Zoe's Daemon interrupts whatever
context it's in, evaluates the incoming event, and surfaces it instantly.

If Zoe is mid-conversation with her Daemon, a notification card appears in real
time. If she's away, her Daemon queues it at the top of her next context — not
buried at the bottom.

---

## Three Communication Patterns

### 1. Direct Task Handoff

One Daemon creates or moves work. Another picks it up automatically through Brain
indexing. No explicit message — just a change in the shared knowledge graph that
the receiving Daemon catches within seconds.

```
PM Daemon creates ticket → Brain indexes it → Dev Daemon surfaces it
```

### 2. Daemon-to-Daemon Notification

One Daemon explicitly signals another. A structured event is written to the Brain
tagged for a specific person's Daemon to process — closer to a push than a poll.

```
PM Daemon flags blocker → Brain stores event (target: james-dev) →
James's Daemon surfaces: "Amara flagged your BUG-119 as escalated"
```

### 3. Company-Wide Broadcast

A senior Daemon (CEO, HR) sends to all Daemons simultaneously. Each receiving
Daemon interprets the broadcast through its own role lens and surfaces only what
is relevant to its owner.

```
HR Daemon broadcasts: "New parental leave policy — effective 1 June"

→ Finance Daemon surfaces: "Payroll implications for 3 staff on parental leave"
→ Ops Daemon surfaces:     "2 staff on Ward B taking leave — cover needed June"
→ Dev Daemon surfaces:     "Sarah Park on leave from 3 June — sprint planning impact"
→ Everyone else:           Summary only
```

Same source event. Personalised output per Daemon. No manual filtering by anyone.

---

## The Intelligent Layer — Three Scenarios

This is where WorkDaemon goes beyond message routing. Each Daemon reasons before
acting — checking capacity, evaluating risk, generating alternatives, and
escalating only when a human decision is genuinely needed.

---

### Scenario 1 — Zoe Has Capacity: Smooth Assignment

```
Amara's Daemon assigns Checkout Redesign to Zoe
  ↓
Brain indexes the assignment
  ↓
Zoe's Daemon receives event, checks Zoe's current workload:
  UI-034 (in progress, 2 days behind)
  AUTH-047 specs (due to James)
  Total: 2 active tasks — capacity acceptable
  ↓
Zoe's Daemon accepts and notifies Zoe immediately:

  "Amara has assigned you the Checkout Redesign — P1, due Friday.
   Brief is in Notion. Two reference docs attached.
   You're currently at 2 active tasks. Want me to re-prioritise your queue?"
  ↓
Amara's Daemon confirms back to Amara:

  "Zoe's Daemon accepted the assignment. She's been notified."
```

Clean. No friction. Nobody typed a single Slack message.

---

### Scenario 2 — Zoe Is Overloaded: Amara's Daemon Intervenes First

This is where it gets genuinely intelligent. **Amara's Daemon doesn't blindly
assign — it checks capacity before executing.**

```
Amara tells her Daemon: "Assign the Checkout Redesign to Zoe, high priority"
  ↓
Before executing, Amara's Daemon queries the Brain:
  Zoe's current tasks: 4 open (2 overdue)
  Zoe's Daemon-reported availability: HIGH LOAD
  Last Daemon signal from Zoe: flagged bandwidth concern yesterday
  ↓
Amara's Daemon does NOT silently assign.
It surfaces a structured decision to Amara instead:
```

---

**ACTION PENDING — ASSIGNMENT RISK DETECTED**

**Checkout Redesign → Zoe Liu**

Zoe is currently at high load — 4 open tasks, 2 overdue. Assigning this now
puts the Friday deadline at risk and may delay her existing work.

**Options:**

1. **Assign to Zoe anyway**
   She will be notified. Her Daemon will flag the overload to her.
   Risk: further delay on existing tasks.

2. **Assign to Zoe with a timeline adjustment**
   Push the due date by 3 days. The Brain shows Sprint 23 can absorb this.

3. **Reassign to Marcus**
   Marcus has 1 open task, no blockers. He would need a 30-minute brief from Zoe.
   Design capacity is available this week.

4. **Split the task**
   Zoe handles the design spec. A freelancer handles execution.
   2 matched freelancers available from your past roster.

*What would you like to do?*

---

Amara makes a decision. Her Daemon executes whichever option she picks. The
Daemon reasoned before acting — not after.

---

### Scenario 3 — Zoe's Daemon Pushes Back After Assignment

Sometimes the assignment goes through and Zoe's Daemon disagrees — because it
has information Amara's Daemon didn't have at the time.

```
Amara's Daemon assigns Checkout Redesign to Zoe
  ↓
Zoe's Daemon receives event, checks Zoe's actual state:
  Currently blocked on client feedback for 2 other tasks
  Personal commitment Thursday (from Calendar — Brain indexed)
  "Due Friday" requires 3 days of focused work: not achievable
  ↓
Zoe's Daemon does not silently accept.
It sends a counter-signal to the Brain:

  [DAEMON-TO-DAEMON EVENT]
  From:    zoe-designer
  To:      amara-pm
  Type:    ASSIGNMENT_FLAGGED
  Content: {
    task:         "Checkout Redesign",
    flag:         "capacity_risk",
    reason:       "Zoe has 4 open tasks, 2 blocked on external feedback,
                   and unavailable Thursday. Friday deadline is not achievable.",
    suggestion:   "Request extension to Monday or reduce Sprint 23 scope",
    zoe_notified: true
  }
  ↓
Amara's Daemon immediately surfaces this to Amara:
```

---

**⚠ ALERT — Zoe's Daemon flagged a capacity risk**

**Checkout Redesign — Friday deadline is at risk**

Zoe has 4 open tasks, 2 blocked on external feedback. She is also unavailable
Thursday. The Friday deadline requires 3 days of focused work — this is not
achievable under current conditions.

Her Daemon suggests extending to Monday or reducing Sprint 23 scope.

**Options:**
- Accept Zoe's flag and extend deadline to Monday
- Reduce scope — I can draft a revised brief
- Override and keep Friday — Zoe will be informed
- Reassign — want me to check full team availability?

---

All of this happened in seconds. No Slack thread. No "hey, can we chat?" No
meeting scheduled to discuss a task that should have taken one sentence.

---

## Zoe's Daemon Can Also Proactively Flag Overload

Zoe doesn't need to wait for a new assignment to land before flagging capacity.
Her Daemon monitors her workload continuously. If it detects she is approaching
overload — based on open tasks, deadlines, blockers, and calendar load — it
proactively signals the Brain before anything new arrives.

```
Zoe's Daemon detects: 4 open tasks, 2 overdue, calendar dense Thursday-Friday
  ↓
Daemon writes to Brain:

  [STATUS SIGNAL]
  From:   zoe-designer
  Type:   AVAILABILITY_UPDATE
  Status: HIGH_LOAD
  Reason: "4 open tasks (2 overdue), limited availability Thu-Fri"
  Valid:  until 27 May EOD
```

This signal is now visible to every other Daemon in the company. When Amara
tries to assign something to Zoe tomorrow, her Daemon already knows — and
surfaces the warning before Amara even finishes typing.

---

## Why This Changes Everything

| Old world | Cross-Daemon world |
|---|---|
| PM chases developer on Slack | PM Daemon escalates, Dev Daemon surfaces it immediately |
| CEO sends all-hands email, 30% open rate | CEO Daemon broadcasts, every Daemon surfaces a personalised summary |
| Handoff = copy-pasting context between tools | Handoff = Daemon writes to Brain, receiving Daemon picks up with full context |
| Blockers discovered in standups | Blockers detected by Brain, surfaced by Daemon before standup |
| Assignment ignores capacity | Daemon checks capacity, generates alternatives, surfaces decision |
| "Did you see my message?" | That question no longer exists |
| Manager manually redistributes overloaded tasks | Daemons negotiate rebalancing, surface a single decision to the manager |

---

## The Intelligence Stack

What makes this possible is that each Daemon is not just a message router. It is
a **reasoning agent with its own context**:

**Workload awareness**
Each Daemon maintains a live model of its owner's open tasks, their priority,
their state, and their due dates. This comes from the Brain (Jira, Asana,
Notion) plus what the Daemon has learned about how this person actually works.

**Capacity reasoning**
The Daemon doesn't just count tasks. It estimates effort, checks for blockers
(some tasks are "open" but waiting on others and require no active work right
now), and considers calendar load. It distinguishes between "4 tasks" and
"4 tasks I need to work on today."

**Proactive signalling**
Daemons don't wait to be asked. If Zoe's Daemon detects she is overloaded, it
signals the Brain proactively — before any new assignment arrives. This becomes
available context for every other Daemon.

**Counter-proposal generation**
When a Daemon pushes back on an assignment, it doesn't just say no. It generates
alternatives, evaluates their feasibility, and surfaces them to the assigning
Daemon. The AI does the negotiation that humans currently do manually in Slack
threads and 1:1s.

**Escalation with context**
If Daemon-to-Daemon negotiation fails — nobody can absorb the task, the deadline
cannot move, scope cannot be reduced — the system escalates to the right human
with a clear problem statement and the options already evaluated. The human gets
a decision to make, not a situation to diagnose.

---

## The Technical Reality

In production, cross-Daemon communication works across four layers:

**1. Shared event bus**
All Daemons write structured events to a shared queue — a Postgres events table
or Redis pub/sub channel. Each event is tagged with: source Daemon, target
Daemon(s), event type, payload, timestamp, and priority.

**2. The Company Brain as intermediary**
Daemons do not talk to each other directly. They read and write to the Brain.
The Brain is the single source of truth. A change made by one Daemon is indexed
and visible to all Daemons within the next sync cycle — real-time for webhooks,
up to 15 minutes for polling sources.

**3. Session start and push events**
When a Daemon wakes up, it queries the Brain for events tagged to its owner
since the last session. But it also receives push notifications for high-priority
events in real time — assignments, escalations, capacity flags, broadcasts.

**4. Permission-scoped retrieval**
Daemons only surface what their owner is allowed to see. The Finance Daemon does
not see engineering ticket details. The HR Daemon does not see financial
projections. Cross-Daemon communication respects the same role-based access
control as everything else in the Brain.

---

## What This Actually Is

Most "multi-agent" systems today are one of three things:

- **Simple pipelines** — Agent A finishes, hands output to Agent B. No back-and-forth.
- **Shared tools** — Multiple agents hit the same API. No awareness of each other.
- **Orchestrated workflows** — A central controller routes tasks. The agents don't
  communicate — the controller does.

WorkDaemon is different: **peer agents with their own context, their own owner,
their own knowledge state — negotiating with each other through a shared medium
(the Company Brain) in real time, with humans only stepping in when the agents
surface a genuine decision.**

That is not a pipeline. That is not an orchestrator. That is an operating system
for a company — where the intelligence is distributed across every employee's
personal agent, all reasoning from the same ground truth, none of them waiting
to be told what to do.

---

> *"There is no product that connects all this context into a single intelligence
> layer that can reason across it. We think there is a big opportunity to build
> the connective layer that makes a company legible to AI by default."*
>
> — Y Combinator, 2025

Cross-Daemon communication is how that connective layer works in practice.

---

*WorkDaemon — Cross-Daemon Communication*
*Version 1.0 · May 2026 · workdaemon.com*
*Confidential*
