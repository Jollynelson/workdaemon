import { requireAuth, adminClient } from '../_lib/supabase.js';
import { isValidEmail, enforceRateLimit, fail } from '../_lib/security.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const user = await requireAuth(req, res);
  if (!user) return;

  const { emails } = req.body ?? {};
  if (!Array.isArray(emails) || emails.length === 0) {
    return res.status(400).json({ error: 'Emails array required' });
  }
  if (emails.length > 50) {
    return res.status(400).json({ error: 'You can invite at most 50 people at once' });
  }

  // Normalize, validate, de-duplicate. Reject the whole batch if any entry is
  // not a valid email (prevents junk / injection into the invites table).
  const normalized = [...new Set(emails.map(e => String(e).trim().toLowerCase()))];
  const invalid = normalized.filter(e => !isValidEmail(e));
  if (invalid.length) {
    return res.status(400).json({ error: `Invalid email address: ${invalid[0]}` });
  }

  if (!(await enforceRateLimit(res, { key: `invite:${user.id}`, max: 20, windowSec: 3600 }))) return;

  const db = adminClient();

  // Get user's workspace
  const { data: profile } = await db
    .from('profiles')
    .select('workspace_id')
    .eq('id', user.id)
    .single();

  if (!profile?.workspace_id) {
    return res.status(400).json({ error: 'Complete workspace setup first' });
  }

  // Store invites
  const inviteRows = normalized.map(email => ({
    workspace_id: profile.workspace_id,
    email,
    invited_by: user.id,
  }));

  const { error } = await db
    .from('workspace_invites')
    .upsert(inviteRows, { onConflict: 'workspace_id, email' });

  if (error) return fail(res, 500, 'Could not send invites', error, 'invite');

  return res.status(200).json({ invited: normalized.length });
}
