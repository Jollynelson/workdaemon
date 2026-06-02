// Delete the "Cobalt" demo company + all 7 staff + every row of their data.
// Self-contained: finds the workspace BY NAME (no dependency on any local file),
// with a hard safety guard so it can ONLY ever touch the demo. Fast bulk deletes.
//
//   node scripts/delete_demo.mjs --dry   # report what WOULD be deleted (no changes)
//   node scripts/delete_demo.mjs         # actually delete
import { readFileSync } from "node:fs";
for (const l of readFileSync(new URL("../.env", import.meta.url),"utf8").split("\n")) { const m=l.match(/^([A-Z0-9_]+)=(.*)$/); if(m) process.env[m[1]]=m[2].replace(/^"|"$/g,""); }
process.env.SUPABASE_URL ||= process.env.NEXT_PUBLIC_SUPABASE_URL;
const { adminClient } = await import("../api/_lib/supabase.js");
const db = adminClient();

const DRY = process.argv.includes("--dry");
const DEMO_NAME = "Cobalt";
const DEMO_DOMAIN = "@cobalt-hq.com";
const CHILD_TABLES = ["slack_messages","slack_user_map","workspace_integrations","inbox_items","hunt_findings","brain_interactions","daemon_messages","daemon_memory","app_agent_profiles","tasks","workspace_api_keys","workspace_members"];

// 1. Find the demo workspace by name — must be exactly one.
const { data: wss } = await db.from("workspaces").select("id,name").eq("name", DEMO_NAME);
if (!wss?.length) { console.log(`No "${DEMO_NAME}" workspace found — already deleted. Nothing to do.`); process.exit(0); }
if (wss.length > 1) { console.log(`ABORT: ${wss.length} workspaces named "${DEMO_NAME}" — too ambiguous to delete safely.`); process.exit(1); }
const WS = wss[0].id;

// 2. Resolve members + SAFETY: every member email must be the demo domain.
const { data: members } = await db.from("workspace_members").select("user_id").eq("workspace_id", WS);
const userIds = (members || []).map(m => m.user_id);
const { data: au } = await db.auth.admin.listUsers({ page: 1, perPage: 1000 });
const demoUsers = (au?.users || []).filter(u => userIds.includes(u.id));
const bad = demoUsers.filter(u => !(u.email || "").endsWith(DEMO_DOMAIN));
if (bad.length) { console.log("SAFETY ABORT — a member is not a demo account:", bad.map(u => u.email)); process.exit(1); }

console.log(`${DRY ? "[DRY RUN] " : ""}Target: "${DEMO_NAME}" ${WS} · ${demoUsers.length} demo staff (${DEMO_DOMAIN})`);

// 3. Report row counts.
for (const t of CHILD_TABLES) {
  const { count } = await db.from(t).select("*", { count: "exact", head: true }).eq("workspace_id", WS);
  console.log(`  ${t}: ${count ?? 0}`);
}
if (DRY) { console.log("\n[DRY RUN] No changes made. Re-run without --dry to delete."); process.exit(0); }

// 4. Delete child rows, then auth users (cascades profiles), then the workspace.
for (const t of CHILD_TABLES) { const { error } = await db.from(t).delete().eq("workspace_id", WS); if (error) console.log(`  ${t}: ERR ${error.message}`); }
for (const u of demoUsers) { const { error } = await db.auth.admin.deleteUser(u.id); console.log(`  user ${u.email}: ${error ? "ERR "+error.message : "deleted"}`); }
await db.from("workspaces").delete().eq("id", WS);

const { data: left } = await db.from("workspaces").select("id").eq("id", WS);
console.log(`\n✅ Done. workspace rows left: ${left?.length || 0} (0 = fully removed, nothing else touched)`);
process.exit(0);
