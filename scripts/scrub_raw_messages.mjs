#!/usr/bin/env node
// Scrub historical raw-JSON daemon messages across ALL companies (CLI).
// Shares its implementation with the admin action in api/brain.js
// (api/_lib/scrub.js) — one source of truth.
//
//   node scripts/scrub_raw_messages.mjs --dry   # preview only (no writes)
//   node scripts/scrub_raw_messages.mjs         # recover/delete
//
// Recovers the real blocks from messages that pre-date the JSON-render fix (md was
// a leaked {"blocks":...} envelope, or the whole content failed to parse), deleting
// only the unrecoverable. Idempotent; only touches leaked envelopes, never prose.
import { readFileSync } from 'fs';
import { createClient } from '@supabase/supabase-js';
import { scrubDaemonMessages } from '../api/_lib/scrub.js';

const DRY = process.argv.includes('--dry');
const env = Object.fromEntries(readFileSync('.env', 'utf8').split('\n')
  .filter(l => l && !l.startsWith('#') && l.includes('='))
  .map(l => { const i = l.indexOf('='); return [l.slice(0, i), l.slice(i + 1).replace(/^["']|["']$/g, '')]; }));

const db = createClient(env.NEXT_PUBLIC_SUPABASE_URL || env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);
const r = await scrubDaemonMessages(db, { workspaceId: null, dryRun: DRY });
console.log(`Scanned ${r.scanned} daemon messages — ${r.fixed} ${DRY ? 'recoverable' : 'recovered'}, ${r.deleted} ${DRY ? 'unrecoverable' : 'deleted'}.`);
