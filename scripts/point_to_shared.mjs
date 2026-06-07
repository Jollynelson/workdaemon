#!/usr/bin/env node
// Point every company's daemon at the SHARED Hermes gateway (brain via context
// injection in api/chat.js; per-staff memory via session-key; cloud fallback).
// Cobalt is left on its dedicated brain-MCP gateway. DB-only — no Modal deploy,
// so this same logic can run at signup for new companies (auto-onboard).
import { readFileSync } from 'fs';
import pg from 'pg';

const env = Object.fromEntries(readFileSync('.env', 'utf8').split('\n')
  .filter(l => l && !l.startsWith('#') && l.includes('='))
  .map(l => { const i = l.indexOf('='); return [l.slice(0, i), l.slice(i + 1).replace(/^["']|["']$/g, '')]; }));
process.env.ENCRYPTION_KEY = env.ENCRYPTION_KEY;
const { encryptSecret } = await import('../api/_lib/security.js');

const SHARED_URL = 'https://nelsonanyanime--workdaemon-hermes-shared-gateway.modal.run';
const SHARED_KEY = env.HERMES_SHARED_API_SERVER_KEY;
if (!SHARED_KEY) { console.error('HERMES_SHARED_API_SERVER_KEY missing from .env'); process.exit(1); }

const db = new pg.Client({ connectionString: env.DATABASE_URL_UNPOOLED || env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
await db.connect();

const onlyArg = process.argv[2];           // optional: a single workspace name/id
const where = onlyArg ? (/^[0-9a-f-]{36}$/i.test(onlyArg) ? 'id=$1' : 'name ilike $1') : "name not ilike '%cobalt%'";
const { rows } = await db.query(`select id, name from workspaces where ${where} order by name`,
  onlyArg ? [/^[0-9a-f-]{36}$/i.test(onlyArg) ? onlyArg : `%${onlyArg}%`] : []);

const encKey = encryptSecret(SHARED_KEY);
for (const ws of rows) {
  if (/cobalt/i.test(ws.name)) { console.log(`skip ${ws.name} (dedicated gateway)`); continue; }
  // Clear any reasoning/hermes key so the shared row is the one chat.js selects.
  await db.query(`delete from workspace_api_keys where workspace_id=$1 and (provider='hermes' or use_case='reasoning')`, [ws.id]);
  await db.query(
    `insert into workspace_api_keys (workspace_id, provider, endpoint, api_key, model, use_case)
     values ($1,'hermes',$2,$3,'hermes-agent','reasoning')`,
    [ws.id, SHARED_URL, encKey]);
  console.log(`✓ ${ws.name} → shared Hermes gateway`);
}
await db.end();
console.log(`\nDone. ${rows.length} workspace(s) processed. Daemons now run on the shared brain-connected Hermes gateway.`);
