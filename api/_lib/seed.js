// Integration seeding — when a tool connects, two things get "ready" from it and
// the UI shows both filling to 100%:
//   🧠 brain  — shared history ingested into the company knowledge store (sees it)
//   🤖 daemon — the staff's OWN daemon wired + caught up on their slice (acts on it)
// Rows live in `integration_seeds` (per workspace+user+provider); seeders patch the
// row as they progress so the Integrations page can poll a live status.
import { ingest as slackIngest, daemonCatchUp as slackDaemonCatchUp } from './connectors/slack.js';
import { getAccessToken } from './oauth.js';

// Each seeder gets (db, {workspaceId, userId}, patch). `patch(fields)` merges into
// the row. Run the brain track then the daemon track; each fails independently so
// one stalling never blocks the other.
const SEEDERS = {
  slack: async (db, { workspaceId, userId }, patch) => {
    // 🧠 BRAIN — shared channel/thread/file history (never personal DMs).
    await patch({ brain_status: 'seeding', brain_stage: 'reading shared channels' });
    try {
      const botToken = await getAccessToken(db, workspaceId, 'slack', 'bot');
      let docs = 0;
      const r = await slackIngest(db, workspaceId, botToken, {
        onProgress: ({ stage, done, total, doc_count }) => {
          if (doc_count != null) docs = doc_count;
          // Fire-and-forget patch; the row's monotonic so out-of-order writes are fine.
          patch({ brain_stage: stage, brain_done: done, brain_total: total, doc_count: docs });
        },
      });
      await patch({ brain_status: 'ready', brain_stage: 'indexed', doc_count: r?.upserted ?? docs });
    } catch (e) {
      await patch({ brain_status: 'error', error: `brain: ${e.message}`.slice(0, 300) });
    }

    // 🤖 DAEMON — act-readiness + catch up on the user's own recent DMs/channels.
    await patch({ daemon_status: 'seeding', daemon_stage: 'wiring Slack tools' });
    try {
      const d = await slackDaemonCatchUp(db, workspaceId, userId, {
        onProgress: ({ stage, done, total }) => patch({ daemon_stage: stage, daemon_done: done, daemon_total: total }),
      });
      if (d.status === 'ready') {
        await patch({ daemon_status: 'ready', daemon_done: d.threads || 0, daemon_total: d.threads || 0,
          daemon_stage: `caught up · ${d.commitments || 0} commitment(s)` });
      } else {
        // needs_reconnect | error — surface the reason on the daemon track.
        await patch({ daemon_status: d.status, daemon_stage: (d.reason || d.status).slice(0, 200) });
      }
    } catch (e) {
      await patch({ daemon_status: 'error', error: `daemon: ${e.message}`.slice(0, 300) });
    }
  },
};

// Reset (or create) the row to a fresh seeding state. Idempotent — re-connecting
// or reconnecting restarts the seed cleanly.
export async function startSeed(db, { workspaceId, userId, provider }) {
  const now = new Date().toISOString();
  await db.from('integration_seeds').upsert({
    workspace_id: workspaceId, user_id: userId, provider,
    brain_status: 'seeding', brain_stage: 'starting', brain_done: 0, brain_total: 0,
    daemon_status: 'pending', daemon_stage: null, daemon_done: 0, daemon_total: 0,
    doc_count: 0, error: null, started_at: now, updated_at: now,
  }, { onConflict: 'workspace_id,user_id,provider' });
}

// Run the actual seeding (call AFTER startSeed). Safe to invoke via waitUntil.
export async function seedIntegration(db, { workspaceId, userId, provider }) {
  const patch = (fields) =>
    db.from('integration_seeds')
      .update({ ...fields, updated_at: new Date().toISOString() })
      .eq('workspace_id', workspaceId).eq('user_id', userId).eq('provider', provider)
      .then(() => {}, () => {}); // never throw from a progress write
  const seeder = SEEDERS[provider];
  if (!seeder) {
    // Generic staged completion for providers without a real seeder yet — the row
    // still resolves so the UI doesn't spin forever.
    await patch({
      brain_status: 'ready', brain_stage: 'no historical sync for this source yet',
      daemon_status: 'ready', daemon_stage: 'tools ready',
    });
    return;
  }
  try { await seeder(db, { workspaceId, userId }, patch); }
  catch (e) { await patch({ brain_status: 'error', error: String(e?.message || e).slice(0, 300) }); }
}

export async function getSeed(db, { workspaceId, userId, provider }) {
  const { data } = await db.from('integration_seeds').select('*')
    .eq('workspace_id', workspaceId).eq('user_id', userId).eq('provider', provider).maybeSingle();
  return data || null;
}

export async function getSeeds(db, { workspaceId, userId }) {
  const { data } = await db.from('integration_seeds').select('*')
    .eq('workspace_id', workspaceId).eq('user_id', userId);
  return data || [];
}
