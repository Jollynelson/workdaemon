// Deep-history backfill worker — loads YEARS of Slack history despite the 60s
// serverless ceiling, by being RESUMABLE: each ~45s slice paginates from each
// channel's saved Slack cursor and persists progress after every page, then the
// worker SELF-CHAINS to the next slice (and a cron sweep resumes any broken
// chain). Deep pages are written as `channel-<id>-b<n>` docs, which the recent/
// real-time ingest leaves untouched — so the two systems never fight.
import { signServiceToken } from './security.js';
import { discoverSlackChannels, fetchHistoryPage, slackTokenPool, chunkLines } from './connectors/slack.js';
import { upsertDocuments } from './ingestion.js';

const HISTORY_DEPTH = Number(process.env.SLACK_HISTORY_DEPTH || 2000); // recent window the live ingest already covers
const CHUNK_CHARS = 5500;
const PAGES_PER_VISIT = 6; // pages per channel before rotating (anti-starvation)

// Discover channels and create per-channel backfill rows. Idempotent — never
// disturbs a channel that's already in-progress or done.
export async function startSlackBackfill(db, workspaceId) {
  const channels = await discoverSlackChannels(db, workspaceId);
  let created = 0;
  for (const ch of channels) {
    const { data: existing } = await db.from('backfill_channels')
      .select('id').eq('workspace_id', workspaceId).eq('provider', 'slack').eq('channel_id', ch.channelId).maybeSingle();
    if (existing) continue;
    await db.from('backfill_channels').insert({
      workspace_id: workspaceId, provider: 'slack', channel_id: ch.channelId, channel_name: ch.channelName,
      visibility: ch.visibility, allowed_users: ch.allowed_users || [],
      cursor: null, skip_remaining: HISTORY_DEPTH, next_chunk: 0, messages: 0, status: 'pending',
    });
    created++;
  }
  return { channels: channels.length, created };
}

// Run one time-budgeted slice. Resumes each channel from its saved cursor, skips
// the recent window the live ingest already holds, indexes the rest as `-b<n>`
// chunks, and persists after every page. Returns { remaining }.
export async function runBackfillSlice(db, workspaceId, { budgetMs = 45000 } = {}) {
  const startedAt = Date.now();
  const elapsed = () => Date.now() - startedAt;
  const pool = await slackTokenPool(db, workspaceId);
  if (!pool.length) return { remaining: 0, note: 'no-tokens' };

  const tokenFor = new Map();
  const pickToken = async (channelId) => {
    if (tokenFor.has(channelId)) return tokenFor.get(channelId);
    for (const t of pool) {
      try { await fetchHistoryPage(t, channelId, '', 1); tokenFor.set(channelId, t); return t; } catch { /* next */ }
    }
    tokenFor.set(channelId, null); return null;
  };

  let indexed = 0;
  while (elapsed() < budgetMs) {
    const { data: chans } = await db.from('backfill_channels')
      .select('*').eq('workspace_id', workspaceId).eq('provider', 'slack')
      .in('status', ['pending', 'running']).order('updated_at', { ascending: true }).limit(1);
    const ch = (chans || [])[0];
    if (!ch) break;

    const token = await pickToken(ch.channel_id);
    if (!token) {
      await db.from('backfill_channels').update({ status: 'error', error: 'no readable token', updated_at: new Date().toISOString() }).eq('id', ch.id);
      continue;
    }

    let cursor = ch.cursor || '', skip = ch.skip_remaining, nextChunk = ch.next_chunk, msgs = ch.messages;
    for (let page = 0; page < PAGES_PER_VISIT && elapsed() < budgetMs; page++) {
      let res;
      try { res = await fetchHistoryPage(token, ch.channel_id, cursor); }
      catch (e) {
        await db.from('backfill_channels').update({ status: 'error', error: String(e.message).slice(0, 200), updated_at: new Date().toISOString() }).eq('id', ch.id);
        break;
      }
      const { messages, nextCursor } = res;

      // Skip the recent window already covered by the live ingest (history pages
      // come newest→oldest, so the first pages ARE the recent ones).
      let toIndex = messages;
      if (skip > 0) { const drop = Math.min(skip, messages.length); skip -= drop; toIndex = messages.slice(drop); }

      if (toIndex.length) {
        const lines = toIndex.slice().reverse().map(m => `${m.user || 'user'}: ${m.text}`); // chronological within the page
        const chunks = chunkLines(lines, CHUNK_CHARS);
        await upsertDocuments(db, workspaceId, 'slack', chunks.map((content, i) => ({
          external_id: `channel-${ch.channel_id}-b${nextChunk + i}`,
          doc_type: 'channel', title: `#${ch.channel_name} (Slack)`, content,
          visibility: ch.visibility, allowed_users: ch.allowed_users || [],
          metadata: { channel: ch.channel_name, backfill: true, chunk: nextChunk + i },
        })));
        nextChunk += chunks.length; msgs += toIndex.length; indexed += toIndex.length;
      }

      cursor = nextCursor;
      await db.from('backfill_channels').update({
        cursor, skip_remaining: skip, next_chunk: nextChunk, messages: msgs,
        status: nextCursor ? 'running' : 'done', updated_at: new Date().toISOString(),
      }).eq('id', ch.id);
      if (!nextCursor) break; // channel fully walked back to its start
    }
  }

  const { count } = await db.from('backfill_channels')
    .select('id', { count: 'exact', head: true })
    .eq('workspace_id', workspaceId).eq('provider', 'slack').in('status', ['pending', 'running']);
  return { remaining: count || 0, indexed };
}

// Fire-and-forget the next worker run on the SAME host (chains 45s slices).
export function kickBackfillWorker(baseUrl, workspaceId) {
  try {
    const tok = signServiceToken({ scope: 'backfill', workspace_id: workspaceId }, { expiresInSec: 600 });
    return fetch(`${baseUrl}/api/brain?action=run_backfill`, {
      method: 'POST', headers: { Authorization: `Bearer ${tok}`, 'Content-Type': 'application/json' }, body: '{}',
    }).then(() => {}, () => {});
  } catch { return Promise.resolve(); }
}

// Cron backstop: kick a worker for every workspace with unfinished backfill.
export async function backfillSweep(db, baseUrl) {
  const { data: rows } = await db.from('backfill_channels')
    .select('workspace_id').eq('provider', 'slack').in('status', ['pending', 'running']);
  const wss = [...new Set((rows || []).map(r => r.workspace_id))];
  for (const ws of wss) await kickBackfillWorker(baseUrl, ws);
  return { kicked: wss.length };
}
