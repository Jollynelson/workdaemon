// Apply numbered .sql migrations from migrations/ to the DB over
// DATABASE_URL_UNPOOLED — WITH a ledger (schema_migrations) so applied state
// lives in the database, not in anyone's memory.
//
//   node scripts/run_migration.mjs up                  # apply ALL pending, in order
//   node scripts/run_migration.mjs migrations/034_x.sql # apply one file (ledger refuses re-apply; --force to skip ahead)
//   node scripts/run_migration.mjs --baseline          # mark every existing file as applied WITHOUT running it
//                                                      # (one-time bootstrap for a DB that already has them all)
//   node scripts/run_migration.mjs status              # show applied vs pending
//
// ⚠️ The .env DATABASE_URL_UNPOOLED IS the production database.
import fs from 'node:fs';
import path from 'node:path';
import pg from 'pg';

// Load .env the same way the seed scripts do (no dotenv dependency).
for (const l of fs.readFileSync(new URL('../.env', import.meta.url), 'utf8').split('\n')) {
  const m = l.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m) process.env[m[1]] = m[2].replace(/^"|"$/g, '');
}

const MIGRATIONS_DIR = new URL('../migrations/', import.meta.url).pathname;
const args = process.argv.slice(2);
const FORCE = args.includes('--force');
const cmd = args.find(a => !a.startsWith('--'));

const url = process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL;
if (!url) { console.error('No DATABASE_URL_UNPOOLED in env'); process.exit(1); }

function allMigrationFiles() {
  return fs.readdirSync(MIGRATIONS_DIR)
    .filter(f => /^\d{3}_.+\.sql$/.test(f))
    .sort(); // NNN_ prefix → lexicographic == chronological
}

const client = new pg.Client({ connectionString: url, ssl: { rejectUnauthorized: false } });
await client.connect();

async function ensureLedger() {
  await client.query(`create table if not exists schema_migrations (
    filename text primary key,
    applied_at timestamptz not null default now(),
    baseline boolean not null default false
  )`);
}

async function appliedSet() {
  const { rows } = await client.query('select filename from schema_migrations');
  return new Set(rows.map(r => r.filename));
}

async function applyOne(filename) {
  const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, filename), 'utf8');
  await client.query('begin');
  try {
    await client.query(sql);
    await client.query('insert into schema_migrations (filename) values ($1)', [filename]);
    await client.query('commit');
    console.log('✓ applied:', filename);
  } catch (e) {
    await client.query('rollback').catch(() => {});
    throw new Error(`${filename}: ${e.message}`, { cause: e });
  }
}

try {
  await ensureLedger();
  const applied = await appliedSet();
  const files = allMigrationFiles();

  if (args.includes('--baseline')) {
    let n = 0;
    for (const f of files) {
      if (applied.has(f)) continue;
      await client.query('insert into schema_migrations (filename, baseline) values ($1, true)', [f]);
      n++;
    }
    console.log(`✓ baseline: marked ${n} migration(s) as applied (without running them)`);
  } else if (cmd === 'status' || !cmd) {
    const pending = files.filter(f => !applied.has(f));
    console.log(`applied: ${files.length - pending.length}/${files.length}`);
    for (const f of pending) console.log('  pending:', f);
    if (!cmd) console.log('\nusage: run_migration.mjs up | status | --baseline | <migrations/NNN_x.sql>');
  } else if (cmd === 'up') {
    const pending = files.filter(f => !applied.has(f));
    if (!pending.length) console.log('✓ nothing pending');
    for (const f of pending) await applyOne(f);
  } else {
    // Single file path.
    const filename = path.basename(cmd);
    if (!files.includes(filename)) { console.error(`✗ not found in migrations/: ${filename}`); process.exit(1); }
    if (applied.has(filename)) { console.error(`✗ already applied: ${filename} (ledger refuses re-apply)`); process.exit(1); }
    // Out-of-order guard: there must be no UNapplied migration numbered before this one.
    const earlier = files.filter(f => f < filename && !applied.has(f));
    if (earlier.length && !FORCE) {
      console.error(`✗ out of order — unapplied earlier migration(s): ${earlier.join(', ')}\n  (run "up", or pass --force to skip ahead deliberately)`);
      process.exit(1);
    }
    await applyOne(filename);
  }
} catch (e) {
  console.error('✗ migration failed:', e.message);
  process.exitCode = 1;
} finally {
  await client.end();
}
