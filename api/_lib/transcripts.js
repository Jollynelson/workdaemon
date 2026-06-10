// Chat-transcript shaping for Brain ingestion (owner directive: the Brain
// ingests full conversations). Shared by the live per-turn ingest in chat.js
// and scripts/backfill_chat_transcripts.mjs so the format stays identical:
// one workspace_document per user per day, source 'chat', restricted to the
// owner (ingestion universal, visibility scoped).

const SESSION_PING = /^\[SESSION_(START|RESUME)\]$/;

// daemon_messages rows ({ role, content }) → readable transcript lines.
// Daemon envelopes contribute their text/alert/action content; session-ping
// sentinels from older builds are dropped.
export function transcriptLines(rows, ownerName = 'User') {
  const lines = [];
  for (const m of (rows || [])) {
    if (m.role === 'user') {
      const text = String(m.content || '').trim();
      if (!text || SESSION_PING.test(text)) continue;
      lines.push(`${ownerName}: ${text}`);
      continue;
    }
    try {
      const env = JSON.parse(m.content);
      const texts = (env.blocks || []).map(b =>
        b?.type === 'text' ? b.md :
        b?.type === 'alert' ? `[alert] ${b.title}: ${b.content || ''}` :
        b?.type === 'action_done' ? b.summary : ''
      ).filter(Boolean);
      if (texts.length) lines.push(`Daemon: ${texts.join(' ')}`);
    } catch { if (m.content) lines.push(`Daemon: ${m.content}`); }
  }
  return lines;
}

// Lines → the daily transcript doc upsertDocuments() expects.
export function transcriptDoc({ userId, dayISO, ownerName, lines }) {
  return {
    external_id:   `chat-${userId}-${dayISO}`,
    doc_type:      'conversation',
    title:         `Daemon chat — ${ownerName || 'staff'} — ${dayISO}`,
    content:       lines.join('\n').slice(-8000), // tail = most recent
    visibility:    'restricted',
    allowed_users: [userId],
    author:        ownerName || null,
  };
}
