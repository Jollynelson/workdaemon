// Channel registry — maps a channel key to its outbound send() plug. Each plug
// shares one interface { id, label, capabilities, configured, send } so the
// agent engine is channel-agnostic. Mirrors connectors/index.js.
import * as email from './email.js';
import * as x from './x.js';
import * as linkedin from './linkedin.js';

export const CHANNELS = { email, x, linkedin };

export function getChannel(key) {
  return CHANNELS[key] || null;
}

// Normalize an address for suppression lookups (lowercase, trim).
export function normAddress(addr) {
  return String(addr || '').trim().toLowerCase();
}

// Is this recipient suppressed (opt-out / bounce / complaint)?
export async function isSuppressed(db, workspaceId, channel, address) {
  const addr = normAddress(address);
  if (!addr) return false;
  const { data } = await db
    .from('suppression_list')
    .select('id')
    .eq('workspace_id', workspaceId)
    .eq('channel', channel)
    .eq('address', addr)
    .maybeSingle();
  return Boolean(data);
}

// CAN-SPAM / GDPR footer appended to every email body by the engine.
export function complianceFooter({ unsubscribeUrl, senderName, address }) {
  const lines = [
    '',
    '—',
    `${senderName || 'WorkDaemon'}`,
    address || '',
    unsubscribeUrl ? `Unsubscribe: ${unsubscribeUrl}` : 'Reply STOP to unsubscribe.',
  ].filter(Boolean);
  return lines.join('\n');
}
