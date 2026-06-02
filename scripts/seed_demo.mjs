// Seed a rich, lived-in demo company for the YC demo. Creates the workspace,
// 7 staff (real logins), and deep context/history so it looks months-old.
// Runs on the env DeepSeek key (no workspace key → chat.js falls back to DeepSeek).
// Saves all ids to demo_cobalt_ids.json for clean deletion later.
import { readFileSync, writeFileSync } from "node:fs";
for (const l of readFileSync(new URL("../.env", import.meta.url),"utf8").split("\n")) { const m=l.match(/^([A-Z0-9_]+)=(.*)$/); if(m) process.env[m[1]]=m[2].replace(/^"|"$/g,""); }
process.env.SUPABASE_URL ||= process.env.NEXT_PUBLIC_SUPABASE_URL;
const { adminClient } = await import("../api/_lib/supabase.js");
const db = adminClient();

const PASSWORD = "CobaltDemo2026!";
const now = Date.now(), DAY = 864e5;
const ago = (d) => new Date(now - d*DAY).toISOString();
const rndAgo = (lo,hi) => ago(lo + Math.floor(Math.random()*(hi-lo)));
const pick = (a) => a[Math.floor(Math.random()*a.length)];

// ── Company ───────────────────────────────────────────────────────────────────
const context = {
  description: "Cobalt is AI-native spend management for mid-market finance teams — corporate cards, real-time spend controls, and automated expense + month-end close. Founded 2022, San Francisco.",
  stage: "Series A",
  revenue: "$3.2M ARR (up 140% YoY)",
  headcount: "34 (19 a year ago)",
  priorities: "Q3: cross $4M ARR, ship the Close Automation module to GA, land 3 lighthouse mid-market logos, hold gross margin > 78%.",
  projects: "Close Automation (private beta, 11 design partners) · Card 2.0 (virtual cards + granular controls) · SOC 2 Type II renewal · Mobile app v3.",
  metrics: "ARR $3.2M · NRR 119% · CAC payback 11mo · logo churn 1.4%/mo · 412 customers · open pipeline $2.1M · runway 22mo.",
  customers: "Mid-market (50–500 employees) finance teams replacing Expensify/Concur. ICP = Controllers & VPs of Finance. Lighthouse logos: Northwind Retail, Vela Health, Brightside Logistics.",
  competitors: "Ramp, Brex, Airbase, Expensify. We win on close automation + hands-on mid-market service.",
  notes: "Investors: Initialized Capital (lead) + 2 angels. Next board meeting Sep 18. Hiring: 2 AEs, 1 platform engineer, 1 product designer. All-hands every other Monday.",
  market_intel: { positioning: "The close-automation-first alternative to Ramp/Brex for mid-market finance.", researched_at: ago(40), web_grounded: true },
};

const { data: ws, error: wsErr } = await db.from("workspaces").insert({
  name: "Cobalt", size: "21–100", industry: "B2B SaaS · Fintech (spend management)",
  location: "San Francisco, USA", context, created_at: ago(640),
}).select().single();
if (wsErr) { console.error("workspace:", wsErr.message); process.exit(1); }
console.log("workspace:", ws.id);

// ── Staff ─────────────────────────────────────────────────────────────────────
const staff = [
  { key:"maya",   name:"Maya Okafor",   email:"maya@cobalt-hq.com",   title:"CEO & Co-founder",        role:"CEO",                wsRole:"admin",  perm:3, access:"executive", interactions:420, trust:1.55, joined:600 },
  { key:"daniel", name:"Daniel Levin",  email:"daniel@cobalt-hq.com", title:"CTO & Co-founder",        role:"CTO / Engineering",  wsRole:"admin",  perm:3, access:"executive", interactions:330, trust:1.40, joined:600 },
  { key:"priya",  name:"Priya Raman",   email:"priya@cobalt-hq.com",  title:"Head of Product",         role:"Head of Product",    wsRole:"member", perm:2, access:"director",  interactions:265, trust:1.35, joined:430 },
  { key:"marcus", name:"Marcus Bell",   email:"marcus@cobalt-hq.com", title:"Head of Sales",           role:"Head of Sales",      wsRole:"member", perm:2, access:"director",  interactions:310, trust:1.45, joined:380 },
  { key:"sofia",  name:"Sofia Reyes",   email:"sofia@cobalt-hq.com",  title:"Head of Marketing",       role:"Head of Marketing",  wsRole:"member", perm:2, access:"director",  interactions:240, trust:1.30, joined:300 },
  { key:"aisha",  name:"Aisha Khan",    email:"aisha@cobalt-hq.com",  title:"Head of People",          role:"Head of People (HR)",wsRole:"member", perm:2, access:"director",  interactions:180, trust:1.25, joined:260 },
  { key:"tom",    name:"Tom Nakamura",  email:"tom@cobalt-hq.com",    title:"Head of Finance & Ops",   role:"Head of Finance",    wsRole:"member", perm:2, access:"director",  interactions:295, trust:1.40, joined:340 },
];

const ids = { workspace: ws.id, password: PASSWORD, users: {} };
for (const s of staff) {
  const { data: created, error } = await db.auth.admin.createUser({ email: s.email, password: PASSWORD, email_confirm: true });
  if (error) { console.error("user", s.email, error.message); continue; }
  s.id = created.user.id; ids.users[s.email] = s.id;
  await db.from("profiles").upsert({ id: s.id, name: s.name, title: s.title, role: s.role, industry: ws.industry, workspace_id: ws.id, onboarded: true, permission_level: s.perm, created_at: ago(s.joined) });
  await db.from("workspace_members").upsert({ workspace_id: ws.id, user_id: s.id, role: s.wsRole, joined_at: ago(s.joined) }, { onConflict: "workspace_id,user_id" });
  await db.from("app_agent_profiles").upsert({ user_id: s.id, workspace_id: ws.id, access_level: s.access, trust_score: s.trust, interaction_count: s.interactions, last_calibration: ago(3+Math.random()*8), created_at: ago(s.joined), updated_at: ago(1) }, { onConflict: "user_id" });
  console.log("staff:", s.name, "→", s.id);
}
const by = Object.fromEntries(staff.map(s => [s.key, s]));

// ── Role briefs + learned memories ─────────────────────────────────────────────
const briefs = {
  maya:  "Role playbook for CEO (web-researched) — **Mandate** set direction, raise capital, hire leaders, own the board. **Measured on** ARR growth, runway, key hires, fundraise readiness. Watches: cash, pipeline, leadership health. Cobalt-specific: pushing the Series B narrative (close automation as the wedge); board on Sep 18.",
  daniel:"Role playbook for CTO — **Mandate** ship reliable product fast, own architecture, reliability, security. **Measured on** velocity, uptime (99.9% SLA), SOC 2, eng hiring. Cobalt-specific: Card 2.0 ledger rewrite + SOC 2 Type II renewal are the two big rocks.",
  priya: "Role playbook for Head of Product — **Mandate** own roadmap and outcomes. **Measured on** activation, feature adoption, NRR contribution. Cobalt-specific: Close Automation GA is the make-or-break Q3 launch; 11 design partners in beta.",
  marcus:"Role playbook for Head of Sales — **Mandate** build and convert pipeline, hit ARR targets. **Measured on** new ARR, win rate, pipeline coverage (target 3x), ramp of new AEs. Cobalt-specific: needs 3 lighthouse mid-market logos this quarter; coverage is light at 2.3x.",
  sofia: "Role playbook for Head of Marketing — **Mandate** demand gen, brand, content, launches. **Measured on** SQLs, pipeline sourced, CAC, launch impact. Cobalt-specific: owns the Close Automation GA launch narrative + the 'close-first' category story vs Ramp/Brex.",
  aisha: "Role playbook for Head of People — **Mandate** hire, retain, culture, comp. **Measured on** time-to-hire, regrettable attrition, eNPS. Cobalt-specific: scaling from 34→~50 by year end; closing 2 AEs + 1 platform eng + 1 designer; comp-band refresh underway.",
  tom:   "Role playbook for Head of Finance & Ops — **Mandate** financial planning, close, metrics, runway. **Measured on** forecast accuracy, gross margin, close time, burn multiple. Cobalt-specific: month-end close is still 9 days (target 5); owns the board metrics pack.",
};
const learned = {
  maya:  [["preference","Maya prefers tight, decision-first answers with the number up front; no preamble."],["priority","Top priority this quarter: Series B narrative + the Sep 18 board deck."]],
  daniel:[["preference","Daniel wants tradeoffs and risks called out explicitly; he dislikes hand-wavy estimates."],["pattern","Reviews PRs in the morning; reserve deep-work blocks 1–4pm."]],
  priya: [["preference","Priya likes adoption data alongside any roadmap claim."],["priority","Close Automation GA target: end of Q3."]],
  marcus:[["preference","Marcus wants pipeline framed by stage + coverage ratio."],["relationship","Champion at Northwind Retail is the Controller, Dana Ofori."]],
  sofia: [["preference","Sofia prefers a hook + 3 angles for any content ask."],["priority","Owns the 'close-first' category narrative."]],
  aisha: [["preference","Aisha keeps people topics confidential; never names individuals in shared findings."],["priority","Hiring plan: 2 AEs, 1 platform eng, 1 designer."]],
  tom:   [["preference","Tom wants exact figures with the source + as-of date."],["pattern","Runs the forecast every Friday; board pack due 3 days before each board meeting."]],
};
for (const s of staff) {
  await db.from("daemon_memory").insert({ user_id:s.id, workspace_id:ws.id, key:"role-brief", value: briefs[s.key], memory_type:"role_brief", updated_at: ago(s.joined-5) });
  for (const [type,val] of (learned[s.key]||[])) await db.from("daemon_memory").insert({ user_id:s.id, workspace_id:ws.id, key: type+"-"+Math.random().toString(36).slice(2,7), value: val, memory_type: type, updated_at: rndAgo(2,40) });
}
console.log("memories seeded");

// ── Brain findings (company-wide, role-targeted) ────────────────────────────────
const findings = [
  { mode:"opportunity", sev:"warning", roles:["sales","marketing","ceo"], pattern:"Ramp raised list pricing ~12% on mid-market tiers (this week)", rec:"Sales: revive the 6 stalled Ramp-eval deals with a price + close-automation comparison. Marketing: ship a 'switch from Ramp' landing page.", draft:"Ramp just raised prices on mid-market. If you're re-evaluating, Cobalt gives you spend controls AND automated month-end close — and we'll match your current rate for 12 months. Worth a 20-min look? 👇" },
  { mode:"threat", sev:"critical", roles:["finance","ceo"], pattern:"New FASB lease-expense disclosure guidance lands Q4 — affects our close module customers", rec:"Finance + Product: assess Close Automation gaps vs the new disclosure; brief the 11 design partners before GA so it's a selling point, not a surprise." },
  { mode:"knowledge", sev:"warning", roles:["ceo","finance","product"], pattern:'5 staff asked about "the Sep 18 board deck" in the last 10 days', rec:"Document one source of truth for the board metrics + narrative; Tom to own the pack, Maya the story." },
  { mode:"performance", sev:"warning", roles:["sales","ceo"], pattern:"Pipeline coverage slipped to 2.3x vs the 3x target with 5 weeks left in Q3", rec:"Sales: pull 2 deals forward from Q4 or add top-of-funnel; Marketing to spin up an ABM push on the 40 ICP accounts." },
  { mode:"opportunity", sev:"info", roles:["marketing","product"], pattern:"'Month-end close automation' search interest up 38% QoQ (fintech buyers)", rec:"Marketing: build the close-automation SEO cluster now; Product to feed 3 customer proof points.", draft:"Month-end close shouldn't take 9 days. See how mid-market finance teams cut close time in half with Cobalt's close automation — live walkthrough this Thursday. Save a seat → " },
  { mode:"threat", sev:"warning", roles:["engineering","ceo"], pattern:"SOC 2 Type II renewal window opens in 3 weeks; evidence collection not started", rec:"Engineering: kick off evidence collection now; a lapse blocks 3 enterprise-leaning deals in Marcus's pipeline." },
  { mode:"knowledge", sev:"info", roles:["hr","ceo"], pattern:"Time-to-hire for the platform-engineer role is at 61 days (team avg 34)", rec:"People: widen sourcing + consider a referral bonus; the open role is gating Card 2.0 velocity." },
  { mode:"opportunity", sev:"info", roles:["sales","ceo"], pattern:"Northwind Retail (lighthouse) expanded seats 40% — strong expansion signal", rec:"Sales: turn Northwind into a case study + reference for the 3 lighthouse logos you're chasing." },
];
const tagFor = { sales:"sales", marketing:"marketing", ceo:"ceo", finance:"finance", product:"product", engineering:"engineering", hr:"hr" };
for (const f of findings) {
  const { data: row } = await db.from("hunt_findings").insert({
    workspace_id: ws.id, hunt_mode: f.mode, pattern: f.pattern, occurrences: 1+Math.floor(Math.random()*4),
    affected_roles: f.roles.map(r=>tagFor[r]||r), severity: f.sev, recommendation: f.rec, draft: f.draft||null,
    resolved:false, created_at: rndAgo(1,18), updated_at: rndAgo(0,2),
  }).select("id").single();
  // mirror critical/warning role-targeted findings into the affected members' inboxes
  if (row && f.roles.length) {
    const targets = staff.filter(s => f.roles.some(r => (tagFor[r]) === ({CEO:"ceo","CTO / Engineering":"engineering","Head of Product":"product","Head of Sales":"sales","Head of Marketing":"marketing","Head of People (HR)":"hr","Head of Finance":"finance"})[s.role]));
    for (const t of targets) await db.from("inbox_items").insert({ workspace_id: ws.id, user_id: t.id, type: f.draft?"alert":"alert", source:"daemon", title: (f.sev==="critical"?"⚠ ":"")+f.pattern, body: f.rec + (f.draft?`\n\nDraft ready:\n${f.draft}`:""), metadata:{ severity:f.sev, affected_roles:f.roles, has_draft:!!f.draft, draft:f.draft||null }, read: Math.random()<0.4, created_at: rndAgo(0,14) });
  }
}
console.log("findings + inbox seeded");

// ── Interaction history (volume → looks heavily used) ───────────────────────────
const qpool = {
  CEO:["what's our runway and burn this month?","summarize where we are vs the Q3 ARR target","what should be the headline of the Sep 18 board deck?","which deals are most likely to close this quarter?","draft a crisp update to investors on the close-automation launch","what are the biggest risks to the quarter right now?","how are we tracking on the 3 lighthouse logos?"],
  "CTO / Engineering":["status on the Card 2.0 ledger rewrite","what's blocking the SOC 2 renewal?","summarize this week's incidents and uptime","are we on track for the mobile v3 cutover?","what's the eng hiring status?","review the architecture risks for close automation"],
  "Head of Product":["what's adoption on the close-automation beta?","which design partners are most engaged?","draft the GA launch checklist","what feature requests are repeating across accounts?","where are we losing activation in onboarding?"],
  "Head of Sales":["show me pipeline by stage and coverage","which Ramp-eval deals can we revive?","what's Marcus's forecast for the quarter?","draft a follow-up to the Northwind expansion","who are this week's at-risk deals?","what's our win rate vs Brex?"],
  "Head of Marketing":["how did the last webinar perform?","draft a 'switch from Ramp' campaign brief","what's our SQL trend this month?","give me 3 angles for the close-automation launch","what content is driving the most pipeline?"],
  "Head of People (HR)":["where are we on the hiring plan?","why is time-to-hire so long for the platform eng role?","draft an offer letter framework for the AE roles","summarize the latest eNPS pulse","what's our regrettable attrition this year?"],
  "Head of Finance":["what's gross margin trending at?","how long is month-end close taking?","reconcile the ARR number for the board pack","what's our CAC payback by channel?","flag any spend anomalies this month","build the burn-multiple slide"],
};
let interactionCount = 0;
for (const s of staff) {
  const qs = qpool[s.role] || qpool["CEO"];
  const n = 9 + Math.floor(Math.random()*8);
  for (let i=0;i<n;i++){
    const q = pick(qs);
    const tags = q.toLowerCase().replace(/[^a-z0-9 ]/g," ").split(/\s+/).filter(w=>w.length>3 && !["what","whats","this","that","draft","summarize","which","show","give","week","right","over","with","status","where"].includes(w)).slice(0,6);
    await db.from("brain_interactions").insert({ user_id:s.id, workspace_id:ws.id, user_role:s.role, access_level:s.access, user_message:q, topic_tags:tags, session_hour: 8+Math.floor(Math.random()*10), message_length:q.length, suggestion_acted_on: Math.random()<0.5, created_at: rndAgo(1,95) });
    interactionCount++;
  }
}
console.log("interactions seeded:", interactionCount);

// ── A recent chat transcript per staff (so "welcome back" has history) ──────────
const sessions = {
  maya:  ["what's our runway and burn this month?", "Runway is **22 months** at the current **$148k/mo** net burn. Burn ticked up 6% from the two AE hires — still inside plan. Cash is **$3.26M**. If close-automation GA lands on time, the Series B story gets materially stronger by the Sep board meeting.", ["Draft the runway slide for the board","Compare burn vs plan","What would extend runway to 30 months?"]],
  daniel:["what's blocking the SOC 2 renewal?", "Two things: evidence collection hasn't kicked off (window opens in **3 weeks**), and we're short one platform engineer to own the controls work. A lapse would block **3 enterprise-leaning deals** in Marcus's pipeline. Recommend starting evidence this week and pulling Priya's designer 10% for the access-review UI.", ["Open a SOC 2 evidence checklist","Who can own controls this sprint?","Draft a note to Marcus on timing"]],
  priya: ["what's adoption on the close-automation beta?", "**8 of 11** design partners are actively closing in-product; weekly active **73%**. Two partners (Vela Health, Brightside) haven't onboarded — both cite a missing multi-entity view. That feature is the top blocker to GA and shows up in **4** other accounts. Recommend prioritizing multi-entity before the GA date.", ["Draft the GA launch checklist","Show the 2 stalled partners' blockers","What's the activation drop-off?"]],
  marcus:["show me pipeline by stage and coverage", "Coverage is **2.3x** vs the **3x** target with 5 weeks left — light. Pipeline: **$2.1M** open · **$640k** in commit · 3 deals slipping. The Ramp price hike just opened a door on **6 stalled evals**. Recommend reviving those now + an ABM push on the 40 ICP accounts with Sofia.", ["Draft revival emails to the 6 Ramp evals","Which 3 deals are slipping and why?","Forecast the quarter"]],
  sofia: ["give me 3 angles for the close-automation launch", "**1) Time:** 'Close in 5 days, not 9' — speed as the hero. **2) Category:** 'Spend controls were table stakes. Close is the new battleground' — position vs Ramp/Brex. **3) Proof:** lead with Northwind's results (40% seat expansion, close cut in half). Search interest in 'close automation' is **+38% QoQ** — the timing is right.", ["Draft the launch landing page","Build the SEO cluster plan","Write the Northwind case study brief"]],
  aisha: ["where are we on the hiring plan?", "Open: **2 AEs, 1 platform eng, 1 designer**. The platform-eng role is the problem — time-to-hire **61 days** vs the **34** average, and it's gating Card 2.0. The two AE roles have strong pipelines (offers out to 1). Recommend a referral bonus + widening sourcing on the eng role this week.", ["Draft the referral-bonus announcement","Offer framework for the AEs","Summarize the eNPS pulse"]],
  tom:   ["how long is month-end close taking?", "Last close was **9 days** — target is **5**. The bottlenecks are manual expense categorization and intercompany reconciliation. Close Automation fixes the first; the second needs the multi-entity view Product is building. Gross margin held at **78.4%**. Board pack is due **3 days** before Sep 18.", ["Build the close-time trend slide","Where exactly are the 4 lost days?","Draft the board metrics pack"]],
};
for (const s of staff) {
  const [q,a,sug] = sessions[s.key];
  const t = rndAgo(1,4);
  await db.from("daemon_messages").insert({ user_id:s.id, workspace_id:ws.id, role:"user", content:q, created_at:t });
  await db.from("daemon_messages").insert({ user_id:s.id, workspace_id:ws.id, role:"daemon", content: JSON.stringify({ blocks:[{type:"text", md:a}], suggestions: sug }), created_at: new Date(new Date(t).getTime()+9000).toISOString() });
}
console.log("transcripts seeded");

// ── Tasks across statuses ───────────────────────────────────────────────────────
const tasks = [
  ["Ship Close Automation multi-entity view","Top GA blocker; 2 design partners waiting","in_progress","P0","priya","daniel",6],
  ["Kick off SOC 2 Type II evidence collection","Window opens in 3 weeks; gates 3 deals","todo","P0","daniel","maya",10],
  ["Revive 6 stalled Ramp-eval deals","Use the Ramp price hike + close-automation angle","in_progress","P1","marcus","maya",4],
  ["Publish 'switch from Ramp' landing page","Pair with sales revival push","todo","P1","sofia","marcus",7],
  ["Build Sep 18 board metrics pack","ARR, NRR, burn, pipeline, hiring","in_progress","P0","tom","maya",-3],
  ["Close 2 AE offers","Pipeline strong; 1 offer out","in_progress","P1","aisha","maya",9],
  ["Northwind Retail case study","40% seat expansion; reference for lighthouse logos","todo","P2","sofia","priya",14],
  ["Cut month-end close from 9→7 days","Quick wins before multi-entity lands","in_progress","P1","tom","tom",12],
  ["Q3 ARR push to $4M","Coverage at 2.3x; pull Q4 deals forward","todo","P0","marcus","maya",5],
  ["Referral bonus for platform-eng role","Time-to-hire 61d; gating Card 2.0","done","P2","aisha","aisha",-8],
  ["Mobile app v3 cutover plan","Staged rollout, feature flags","todo","P2","daniel","priya",20],
  ["Webinar: 'Close in 5 days, not 9'","Launch-tied; Northwind proof points","todo","P1","sofia","sofia",9],
];
for (const [title,description,status,priority,assignee,creator,dueIn] of tasks) {
  await db.from("tasks").insert({ workspace_id: ws.id, title, description, status, priority, assignee_id: by[assignee]?.id||null, created_by: by[creator]?.id||null, due_date: new Date(now + dueIn*DAY).toISOString().slice(0,10), created_at: rndAgo(3,40), updated_at: rndAgo(0,3) });
}
console.log("tasks seeded:", tasks.length);

// ── A couple of cross-staff inbox mentions/updates for liveliness ───────────────
await db.from("inbox_items").insert([
  { workspace_id:ws.id, user_id:by.marcus.id, type:"update", source:"daemon", title:"✓ Auto-posted: 'Switch from Ramp' teaser", body:"The brain published the Ramp-price-hike teaser to your queued channel. 14 clicks in the first hour.", metadata:{ auto_published:true, severity:"info" }, read:false, created_at: rndAgo(0,3) },
  { workspace_id:ws.id, user_id:by.maya.id, type:"alert", source:"daemon", title:"Pipeline coverage below target (2.3x vs 3x)", body:"5 weeks left in Q3. Marcus is reviving 6 Ramp evals; recommend an ABM push on 40 ICP accounts.", metadata:{ severity:"warning", affected_roles:["ceo","sales"] }, read:false, created_at: rndAgo(0,5) },
  { workspace_id:ws.id, user_id:by.tom.id, type:"alert", source:"daemon", title:"Board pack due in 3 days", body:"Sep 18 board meeting. ARR reconciled at $3.2M; burn-multiple slide still open.", metadata:{ severity:"warning" }, read:true, created_at: rndAgo(1,4) },
]);
console.log("extra inbox seeded");

writeFileSync(new URL("../demo_cobalt_ids.json", import.meta.url), JSON.stringify(ids, null, 2));
console.log("\n✅ DONE. ids saved to demo_cobalt_ids.json");
console.log("workspace:", ws.id, "| password:", PASSWORD);
console.log("logins:\n" + staff.map(s=>`  ${s.title.padEnd(22)} ${s.email}`).join("\n"));
process.exit(0);
