// Apply a .sql migration file to the prod DB over DATABASE_URL_UNPOOLED.
// Usage: node scripts/run_migration.mjs <path-to.sql>
import fs from 'node:fs';
import pg from 'pg';

// Load .env the same way the seed scripts do (no dotenv dependency).
for (const l of fs.readFileSync(new URL('../.env', import.meta.url), 'utf8').split('\n')) {
  const m = l.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m) process.env[m[1]] = m[2].replace(/^"|"$/g, '');
}

const file = process.argv[2];
if (!file) { console.error('usage: node scripts/run_migration.mjs <file.sql>'); process.exit(1); }
const sql = fs.readFileSync(file, 'utf8');
const url = process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL;
if (!url) { console.error('No DATABASE_URL_UNPOOLED in env'); process.exit(1); }

const client = new pg.Client({ connectionString: url, ssl: { rejectUnauthorized: false } });
await client.connect();
try {
  await client.query('begin');
  await client.query(sql);
  await client.query('commit');
  console.log('✓ migration applied:', file);
} catch (e) {
  await client.query('rollback').catch(() => {});
  console.error('✗ migration failed:', e.message);
  process.exit(1);
} finally {
  await client.end();
}
