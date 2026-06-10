import { requireAuth, adminClient } from '../_lib/supabase.js';
import { enforceRateLimit, detectLocation, parseBody } from '../_lib/security.js';

// POST /api/auth/me — update the caller's own profile (Profile page, IA §7).
// Lives on this endpoint to stay under Vercel's 12-function cap.
async function handleUpdate(req, res) {
  const user = await requireAuth(req, res);
  if (!user) return;
  if (!(await enforceRateLimit(res, { key: `me-update:${user.id}`, max: 40, windowSec: 60 }))) return;

  const body = parseBody(res, req.body, {
    name:          { type: 'string', max: 120 },
    title:         { type: 'string', max: 120 },
    role:          { type: 'string', max: 120 },
    daemon_name:   { type: 'string', max: 120 },
    context_brief: { type: 'string', max: 2000 },
    notif_prefs:   { type: 'object' },
  });
  if (!body) return;

  // Only persist provided keys (a partial save shouldn't null the others).
  const patch = { updated_at: new Date().toISOString() };
  for (const k of ['name', 'title', 'role', 'daemon_name', 'context_brief', 'notif_prefs']) {
    if (body[k] !== undefined) patch[k] = body[k];
  }

  const db = adminClient();
  const { error } = await db.from('profiles').update(patch).eq('id', user.id);
  if (error) return res.status(500).json({ error: 'Could not save profile' });
  return res.status(200).json({ ok: true });
}

export default async function handler(req, res) {
  if (req.method === 'POST') return handleUpdate(req, res);
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const user = await requireAuth(req, res);
  if (!user) return;

  if (!(await enforceRateLimit(res, { key: `me:${user.id}`, max: 120, windowSec: 60 }))) return;

  const db = adminClient();

  const { data: profile } = await db
    .from('profiles')
    .select('*, workspaces(id, name, size, industry, location, invite_code, openrouter_model)')
    .eq('id', user.id)
    .single();

  // If profile has no workspace via FK, check workspace_members (covers invited users)
  let workspaces = profile?.workspaces ?? null;
  let workspaceId = profile?.workspace_id ?? null;

  if (!workspaces) {
    const { data: member } = await db
      .from('workspace_members')
      .select('workspace_id, workspaces(id, name, size, industry, location, invite_code, openrouter_model)')
      .eq('user_id', user.id)
      .limit(1)
      .single();

    if (member?.workspaces) {
      workspaces = member.workspaces;
      workspaceId = member.workspace_id;

      // Self-heal: write workspace_id back to profile so future lookups are fast
      await db.from('profiles').update({ workspace_id: member.workspace_id }).eq('id', user.id);
    }
  }

  const enriched = profile
    ? { ...profile, workspace_id: workspaceId, workspaces }
    : null;

  // Auto-detected location from edge geo headers — the client uses this to
  // pre-fill the onboarding "primary market" field when none is set yet.
  return res.status(200).json({ user, profile: enriched, detectedLocation: detectLocation(req) });
}
