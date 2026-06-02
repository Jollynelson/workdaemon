#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// One-off migration: encrypt any legacy PLAINTEXT keys in workspace_api_keys
// (and workspaces.openrouter_key) at rest with the same AES-256-GCM scheme the
// API now uses on write.
//
// Idempotent: rows already in `enc:v1:` format are skipped. Safe to re-run.
//
// Usage (from repo root, with the prod .env loaded into the environment):
//   node --env-file=.env scripts/encrypt_api_keys.mjs            # dry run
//   node --env-file=.env scripts/encrypt_api_keys.mjs --apply    # write changes
//
// Requires: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, ENCRYPTION_KEY
// ─────────────────────────────────────────────────────────────────────────────

import { createClient } from '@supabase/supabase-js';
import { encryptSecret, decryptSecret } from '../api/_lib/security.js';

const APPLY = process.argv.includes('--apply');

function need(name) {
  const v = process.env[name];
  if (!v) { console.error(`Missing required env var: ${name}`); process.exit(1); }
  return v;
}

const db = createClient(need('SUPABASE_URL'), need('SUPABASE_SERVICE_ROLE_KEY'), {
  auth: { autoRefreshToken: false, persistSession: false },
});
need('ENCRYPTION_KEY');

const isEncrypted = (v) => typeof v === 'string' && v.startsWith('enc:v1:');

async function migrateApiKeys() {
  const { data, error } = await db.from('workspace_api_keys').select('id, api_key');
  if (error) { console.error('read workspace_api_keys:', error.message); return; }
  let toFix = 0;
  for (const row of data || []) {
    if (!row.api_key || isEncrypted(row.api_key)) continue;
    toFix++;
    // Sanity: confirm the value round-trips before/after.
    const enc = encryptSecret(row.api_key);
    if (decryptSecret(enc) !== row.api_key) { console.error(`round-trip failed for ${row.id}, skipping`); continue; }
    if (APPLY) {
      const { error: upErr } = await db.from('workspace_api_keys').update({ api_key: enc }).eq('id', row.id);
      if (upErr) console.error(`update ${row.id}:`, upErr.message);
    }
  }
  console.log(`workspace_api_keys: ${toFix} plaintext key(s) ${APPLY ? 'encrypted' : 'would be encrypted'}`);
}

async function migrateOpenrouter() {
  const { data, error } = await db.from('workspaces').select('id, openrouter_key');
  if (error) { console.log('workspaces.openrouter_key: column absent or unreadable, skipping'); return; }
  let toFix = 0;
  for (const row of data || []) {
    if (!row.openrouter_key || isEncrypted(row.openrouter_key)) continue;
    toFix++;
    const enc = encryptSecret(row.openrouter_key);
    if (APPLY) {
      const { error: upErr } = await db.from('workspaces').update({ openrouter_key: enc }).eq('id', row.id);
      if (upErr) console.error(`update workspace ${row.id}:`, upErr.message);
    }
  }
  console.log(`workspaces.openrouter_key: ${toFix} plaintext key(s) ${APPLY ? 'encrypted' : 'would be encrypted'}`);
}

console.log(APPLY ? '== APPLYING ==' : '== DRY RUN (pass --apply to write) ==');
await migrateApiKeys();
await migrateOpenrouter();
console.log('done.');
