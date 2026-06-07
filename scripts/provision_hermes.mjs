#!/usr/bin/env node
// Provision a per-company, brain-connected Hermes gateway on Modal, and wire the
// company's daemon to it. Scale-to-zero (cloud fallback + prewarm cover cold start).
//
//   node scripts/provision_hermes.mjs "<company name or workspace_id>"
//
// Idempotent: re-running re-deploys + re-upserts the rows. Cobalt is skipped
// (it already has a dedicated gateway). Honors the FINAL spec: each agent is
// connected to its OWN company brain (per-company signed BRAIN_MCP_TOKEN).
import { readFileSync } from 'fs';
import { execSync } from 'child_process';
import crypto from 'crypto';
import pg from 'pg';

const env = Object.fromEntries(readFileSync('.env', 'utf8').split('\n')
  .filter(l => l && !l.startsWith('#') && l.includes('='))
  .map(l => { const i = l.indexOf('='); return [l.slice(0, i), l.slice(i + 1).replace(/^["']|["']$/g, '')]; }));
for (const k of ['SERVICE_TOKEN_SECRET', 'OAUTH_STATE_SECRET', 'ENCRYPTION_KEY', 'DEEPSEEK_API_KEY', 'DEEPSEEK_BASE_URL']) {
  if (env[k]) process.env[k] = env[k];
}
const { signServiceToken, encryptSecret } = await import('../api/_lib/security.js');

const API_BASE = 'https://app.workdaemon.com';
const MODAL_WS = 'nelsonanyanime';
const arg = process.argv[2];
if (!arg) { console.error('usage: provision_hermes.mjs "<company name | workspace_id>"'); process.exit(1); }

const db = new pg.Client({ connectionString: env.DATABASE_URL_UNPOOLED || env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
await db.connect();

const isUuid = /^[0-9a-f-]{36}$/i.test(arg);
const { rows } = await db.query(
  `select id, name from workspaces where ${isUuid ? 'id = $1' : 'name ilike $1'} limit 1`,
  [isUuid ? arg : `%${arg}%`]);
if (!rows.length) { console.error('no workspace matched:', arg); process.exit(1); }
const ws = rows[0];
const slug = ws.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
if (slug === 'cobalt') { console.error('Cobalt already has a dedicated gateway — skipping.'); process.exit(0); }

console.log(`Provisioning Hermes for "${ws.name}" (${ws.id}) → app workdaemon-hermes-${slug}`);

const apiServerKey = crypto.randomBytes(32).toString('base64url');
const adminToken = crypto.randomBytes(16).toString('hex');
const brainToken = signServiceToken({ scope: 'brain_mcp', workspace_id: ws.id });

// 1. Modal secret (brain token = THIS company's brain; no github token here)
execSync(`modal secret create hermes-${slug} ` +
  `API_SERVER_KEY=${apiServerKey} HERMES_ADMIN_TOKEN=${adminToken} ` +
  `DEEPSEEK_API_KEY=${process.env.DEEPSEEK_API_KEY} ` +
  `BRAIN_MCP_TOKEN=${brainToken} WORKDAEMON_API_BASE=${API_BASE} --force`,
  { stdio: 'inherit', cwd: process.cwd() });

// 2. Deploy the gateway (scale-to-zero)
execSync(`modal deploy hermes/modal_app.py`,
  { stdio: 'inherit', cwd: process.cwd(), env: { ...process.env, HERMES_COMPANY: slug } });

const gatewayUrl = `https://${MODAL_WS}--workdaemon-hermes-${slug}-gateway.modal.run`;
const adminUrl = `https://${MODAL_WS}--workdaemon-hermes-${slug}-admin.modal.run`;

// 3. Wire the daemon: workspace_api_keys (chat routing) + workspace_integrations (admin)
await db.query(`delete from workspace_api_keys where workspace_id = $1 and provider = 'hermes'`, [ws.id]);
await db.query(
  `insert into workspace_api_keys (workspace_id, provider, endpoint, api_key, model, use_case)
   values ($1,'hermes',$2,$3,'hermes-agent','reasoning')`,
  [ws.id, gatewayUrl, encryptSecret(apiServerKey)]);
await db.query(
  `insert into workspace_integrations (workspace_id, provider, status, access_token, metadata)
   values ($1,'hermes','connected',$2,$3)
   on conflict (workspace_id, provider) do update set status='connected', access_token=excluded.access_token, metadata=excluded.metadata, updated_at=now()`,
  [ws.id, encryptSecret(adminToken),
   JSON.stringify({ admin_url: adminUrl, gateway_url: gatewayUrl, model_provider: 'custom', model: 'deepseek-chat' })]);

await db.end();
console.log(`\n✓ Provisioned. Gateway: ${gatewayUrl}`);
console.log(`  Daemon for "${ws.name}" now runs on its own brain-connected Hermes gateway (scale-to-zero; cloud fallback covers cold start).`);
