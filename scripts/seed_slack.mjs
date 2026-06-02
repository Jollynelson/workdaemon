import { readFileSync } from "node:fs";
for (const l of readFileSync(new URL("../.env", import.meta.url),"utf8").split("\n")) { const m=l.match(/^([A-Z0-9_]+)=(.*)$/); if(m) process.env[m[1]]=m[2].replace(/^"|"$/g,""); }
process.env.SUPABASE_URL ||= process.env.NEXT_PUBLIC_SUPABASE_URL;
const { adminClient } = await import("../api/_lib/supabase.js");
const { encryptSecret } = await import("../api/_lib/security.js");
const db = adminClient();
const ids = JSON.parse(readFileSync(new URL("../demo_cobalt_ids.json", import.meta.url),"utf8"));
const WS = ids.workspace, U = ids.users;
const now=Date.now(),DAY=864e5,H=36e5; const ago=(d)=>new Date(now-d*DAY).toISOString(); const hAgo=(h)=>new Date(now-h*H).toISOString();

// 1. mark Slack connected
await db.from("workspace_integrations").upsert({
  workspace_id: WS, provider:"slack", status:"connected",
  access_token: encryptSecret("xoxb-demo-cobalt-placeholder"),
  scopes:["channels:read","channels:history","chat:write","app_mentions:read","users:read.email"],
  external_account:"Cobalt HQ", metadata:{ team:{ id:"T_COBALT", name:"Cobalt HQ" }, bot_user_id:"U_WORKDAEMON" },
  connected_by: U["maya@cobalt-hq.com"], updated_at: ago(38),
}, { onConflict:"workspace_id,provider" });

// 2. slack user map (staff)
const su = { maya:"U_MAYA", daniel:"U_DANIEL", priya:"U_PRIYA", marcus:"U_MARCUS", sofia:"U_SOFIA", aisha:"U_AISHA", tom:"U_TOM" };
const emailByKey = { maya:"maya@cobalt-hq.com",daniel:"daniel@cobalt-hq.com",priya:"priya@cobalt-hq.com",marcus:"marcus@cobalt-hq.com",sofia:"sofia@cobalt-hq.com",aisha:"aisha@cobalt-hq.com",tom:"tom@cobalt-hq.com" };
const nameByKey = { maya:"Maya Okafor",daniel:"Daniel Levin",priya:"Priya Raman",marcus:"Marcus Bell",sofia:"Sofia Reyes",aisha:"Aisha Khan",tom:"Tom Nakamura" };
for (const k of Object.keys(su)) await db.from("slack_user_map").upsert({ workspace_id:WS, slack_user_id:su[k], user_id:U[emailByKey[k]], email:emailByKey[k], real_name:nameByKey[k], updated_at:ago(30) }, { onConflict:"workspace_id,slack_user_id" });

// 3. channel messages (newest last in each array). The #engineering debate is the hero.
const M = [
  // #engineering — the Card 2.0 ledger cutover debate
  ["engineering","U_JAMES","I want to ship the Card 2.0 ledger cutover this Friday. We've been sitting on it for two weeks.",72],
  ["engineering","U_ADA","Hard no on Friday. We start SOC 2 Type II evidence collection in 3 weeks — cutting over the ledger now means we're collecting evidence on a system that's still settling.",70],
  ["engineering","U_JAMES","The longer we wait the more reconciliation drift we carry. Every week is +2 days of cleanup later.",69],
  ["engineering","U_ADA","And if we trip a control during the audit window we lose the whole quarter. I'd rather eat 2 days than 3 months.",68],
  ["engineering","U_DANIEL","Both right. Proposal: ship behind a flag Friday to internal only, full cutover after SOC 2 kickoff is stable. Let's not block GA on this.",66],
  ["engineering","U_JAMES","I can live with a flagged internal rollout Friday.",65],
  ["engineering","U_ADA","Works. I'll own the control mapping so the audit window is clean.",64],
  // #sales
  ["sales","U_MARCUS","Northwind Retail just expanded 40% on seats. 🎉 Turning them into our lighthouse reference.",30],
  ["sales","U_MARCUS","Heads up team — Ramp raised mid-market pricing ~12%. I'm reviving the 6 stalled evals with a switch comparison.",10],
  ["sales","U_PRIYA","Want the close-automation demo deck for those? It's the differentiator vs Ramp.",9.5],
  ["sales","U_MARCUS","Yes please. Coverage is at 2.3x and I need these to land.",9],
  // #product
  ["product","U_PRIYA","Close Automation GA blocker is the multi-entity view — 2 design partners (Vela, Brightside) are stalled on it. Prioritizing it this sprint.",26],
  ["product","U_DANIEL","Eng can take it if we descope the canvas export for v1.",25],
  ["product","U_PRIYA","Deal. Multi-entity first, canvas export fast-follow.",24],
  // #leadership
  ["leadership","U_MAYA","Sep 18 board deck: I own the Series B narrative, Tom owns the metrics pack. Story is close-automation as the wedge.",20],
  ["leadership","U_TOM","Metrics pack on track. ARR reconciles to $3.2M, NRR 119%, runway 22mo. Burn-multiple slide still open.",19],
  ["leadership","U_MAYA","Biggest risk is pipeline coverage at 2.3x. Marcus is on it.",18],
  // #marketing
  ["marketing","U_SOFIA","Launch angles for Close Automation: (1) 'Close in 5 days not 9' (2) category 'close is the new battleground' (3) Northwind proof.",16],
  ["marketing","U_SOFIA","Search interest in 'close automation' is +38% QoQ — building the SEO cluster now.",8],
  // #people
  ["people","U_AISHA","Platform-eng role is at 61 days time-to-hire vs 34 avg. Proposing a referral bonus — it's gating Card 2.0.",22],
  // #general
  ["general","U_DANIEL","Standup in 5. Card 2.0 flag rollout + close-automation multi-entity are today's focus.",12],
  ["general","U_MAYA","Reminder: all-hands Monday. Bring one win and one blocker.",6],
];
for (const [ch,user,text,hoursAgo] of M) {
  await db.from("slack_messages").insert({ workspace_id:WS, channel_id:"C_"+ch.toUpperCase(), channel_name:ch, slack_user:user, text, ts:String((now/1000 - hoursAgo*3600).toFixed(6)), created_at: hAgo(hoursAgo) });
}

// 4. brain finding from the Slack debate → routed to CTO + CEO (so the daemon surfaces it)
await db.from("hunt_findings").insert({
  workspace_id:WS, hunt_mode:"knowledge", pattern:"Debate in #engineering on the Card 2.0 ledger cutover timing — ship now (James) vs wait for SOC 2 (Ada)",
  occurrences:7, affected_roles:["engineering","ceo"], severity:"warning",
  recommendation:"Daniel proposed a flagged internal rollout Friday + full cutover after SOC 2 kickoff. Confirm the decision and unblock GA.",
  resolved:false, created_at: hAgo(63), updated_at: hAgo(2),
});

console.log("Slack seeded: integration connected, "+M.length+" messages across 6 channels, user map, 1 debate finding.");
process.exit(0);
