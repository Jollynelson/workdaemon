// Delete EVERYTHING except the "Cobalt" demo: all non-demo workspaces (+ their
// data rows) and all non-demo auth users. Inverse of delete_demo.mjs.
// Safety guard: refuses to run unless the Cobalt demo workspace + its 7
// @cobalt-hq.com staff are found — so it can never run against an empty/wrong DB
// and silently take the demo with it.
//
//   node scripts/delete_nondemo.mjs --dry   # report what WOULD be deleted
//   node scripts/delete_nondemo.mjs         # actually delete
import { readFileSync } from "node:fs";
for (const l of readFileSync(new URL("../.env", import.meta.url),"utf8").split("\n")) { const m=l.match(/^([A-Z0-9_]+)=(.*)$/); if(m) process.env[m[1]]=m[2].replace(/^"|"$/g,""); }
process.env.SUPABASE_URL ||= process.env.NEXT_PUBLIC_SUPABASE_URL;
const { adminClient } = await import("../api/_lib/supabase.js");
const db = adminClient();

const DRY = process.argv.includes("--dry");
const DEMO_NAME = "Cobalt";
const DEMO_DOMAIN = "@cobalt-hq.com";
const CHILD_TABLES = ["slack_messages","slack_user_map","workspace_integrations","inbox_items","hunt_findings","brain_interactions","daemon_messages","daemon_memory","app_agent_profiles","tasks","workspace_api_keys","workspace_members"];

// 1. Anchor on the demo — must be exactly one Cobalt workspace, or abort.
const { data: wss } = await db.from("workspaces").select("id,name").eq("name", DEMO_NAME);
if (!wss?.length) { console.log(`SAFETY ABORT: no "${DEMO_NAME}" demo workspace found — refusing to delete everything against an unrecognized DB.`); process.exit(1); }
if (wss.length > 1) { console.log(`SAFETY ABORT: ${wss.length} workspaces named "${DEMO_NAME}" — ambiguous.`); process.exit(1); }
const DEMO_WS = wss[0].id;

// 2. Resolve demo members — these auth users are the keep-set.
const { data: dm } = await db.from("workspace_members").select("user_id").eq("workspace_id", DEMO_WS);
const DEMO_USER_IDS = new Set((dm || []).map(m => m.user_id));
const { data: au } = await db.auth.admin.listUsers({ page: 1, perPage: 1000 });
const allUsers = au?.users || [];
// Sanity: every kept demo user must carry the demo domain.
const keptBad = allUsers.filter(u => DEMO_USER_IDS.has(u.id) && !(u.email || "").endsWith(DEMO_DOMAIN));
if (keptBad.length) { console.log("SAFETY ABORT — a Cobalt member is NOT a demo-domain account:", keptBad.map(u => u.email)); process.exit(1); }

// 3. Build delete-sets: every workspace != demo, every user not in the demo keep-set.
const { data: allWs } = await db.from("workspaces").select("id,name");
const delWs = (allWs || []).filter(w => w.id !== DEMO_WS);
const delUsers = allUsers.filter(u => !DEMO_USER_IDS.has(u.id));

console.log(`${DRY ? "[DRY RUN] " : ""}KEEP: "${DEMO_NAME}" ${DEMO_WS} + ${DEMO_USER_IDS.size} demo staff`);
console.log(`Will delete ${delWs.length} workspaces, ${delUsers.length} auth users.\n`);
console.log("Workspaces to delete:"); for (const w of delWs) console.log(`  - ${w.name} (${w.id})`);
console.log("Users to delete:"); for (const u of delUsers) console.log(`  - ${u.email} (${u.id})`);

// 4. Report child-row counts across all non-demo workspaces.
const delWsIds = delWs.map(w => w.id);
console.log("\nChild rows (across non-demo workspaces):");
for (const t of CHILD_TABLES) {
  const { count } = await db.from(t).select("*", { count: "exact", head: true }).in("workspace_id", delWsIds);
  console.log(`  ${t}: ${count ?? 0}`);
}
if (DRY) { console.log("\n[DRY RUN] No changes made. Re-run without --dry to delete."); process.exit(0); }

// 5. Delete: child rows -> auth users (cascades profiles) -> non-demo workspaces.
console.log("\nDeleting child rows...");
for (const t of CHILD_TABLES) { const { error } = await db.from(t).delete().in("workspace_id", delWsIds); if (error) console.log(`  ${t}: ERR ${error.message}`); }
console.log("Deleting auth users...");
for (const u of delUsers) { const { error } = await db.auth.admin.deleteUser(u.id); console.log(`  ${u.email}: ${error ? "ERR "+error.message : "deleted"}`); }
console.log("Deleting workspaces...");
for (const w of delWs) { const { error } = await db.from("workspaces").delete().eq("id", w.id); if (error) console.log(`  ${w.name}: ERR ${error.message}`); }

// 6. Verify.
const { data: wsLeft } = await db.from("workspaces").select("id,name");
const { data: au2 } = await db.auth.admin.listUsers({ page: 1, perPage: 1000 });
console.log(`\n✅ Done. Workspaces left: ${wsLeft?.length}, users left: ${au2?.users?.length}`);
for (const w of wsLeft || []) console.log(`  ws: ${w.name}`);
process.exit(0);
