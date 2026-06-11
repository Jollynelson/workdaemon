// Daemon outbox — the daemon reaches out FIRST.
// Scheduled reminders ("message me by 3pm about X"), report-backs, and important
// brain findings queue in daemon_outbox and are delivered INTO THE CHAT as real
// daemon messages: immediately while the user is online (the chat polls), or the
// next time they open their daemon. A pending row survives until swept, so
// nothing a user is meant to see can be missed.
// Pure lib (no serverless function) — called from chat.js and research_actions.js.

// Deliver every due pending row for this user as daemon chat messages.
// Claim-then-deliver per row keeps it idempotent under concurrent sweeps
// (history load + poll racing): only the claimer inserts the message.
export async function sweepOutbox(db, userId) {
  const nowISO = new Date().toISOString();
  const { data: due } = await db.from('daemon_outbox')
    .select('id, workspace_id, kind, title, message, blocks')
    .eq('user_id', userId).eq('status', 'pending').lte('deliver_at', nowISO)
    .order('deliver_at').limit(10);
  if (!due?.length) return [];

  const delivered = [];
  for (const row of due) {
    const { data: claimed } = await db.from('daemon_outbox')
      .update({ status: 'delivered', delivered_at: nowISO })
      .eq('id', row.id).eq('status', 'pending')
      .select('id');
    if (!claimed?.length) continue; // another sweep won the race

    const blocks = Array.isArray(row.blocks) && row.blocks.length ? row.blocks
      : row.kind === 'finding'
        ? [{ type: 'alert', level: 'warning', title: row.title || 'From the Company Brain', content: row.message, tag: 'Brain · Finding' }]
        : [{ type: 'text', md: `⏰ ${row.title ? `**${String(row.title)}** — ` : ''}${row.message}` }];

    const { data: ins } = await db.from('daemon_messages').insert({
      user_id: userId,
      workspace_id: row.workspace_id,
      role: 'daemon',
      content: JSON.stringify({ blocks, suggestions: [] }),
    }).select('id, role, content, created_at').single();
    if (ins) delivered.push(ins);
  }
  if (delivered.length) console.log('[outbox] delivered %d message(s) to user=%s', delivered.length, userId);
  return delivered;
}

// Queue a brain finding for chat delivery to specific users (warning/critical
// only — the inbox already carries everything; chat outreach is for what must
// not be missed).
export async function queueFindingDelivery(db, { workspaceId, userIds, headline, recommendation, findingId }) {
  if (!userIds?.length || !headline) return 0;
  const rows = userIds.map(uid => ({
    workspace_id: workspaceId,
    user_id: uid,
    kind: 'finding',
    title: String(headline).slice(0, 200),
    message: [headline, recommendation].filter(Boolean).join(' — ').slice(0, 2000),
    source: findingId ? `hunt_finding:${findingId}` : 'hunt_finding',
    deliver_at: new Date().toISOString(),
  }));
  const { error } = await db.from('daemon_outbox').insert(rows);
  if (error) { console.error('[outbox] queueFindingDelivery:', error.message); return 0; }
  return rows.length;
}
