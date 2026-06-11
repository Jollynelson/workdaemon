import { requireAuth, adminClient } from '../_lib/supabase.js';
import { fail, enforceRateLimit, parseBody, detectLocation } from '../_lib/security.js';
import { generateCompanyGoals, generateStaffGoals } from '../_lib/goals.js';
import { assignRoleSkills } from '../_lib/skills.js';
import { waitUntil } from '@vercel/functions';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const user = await requireAuth(req, res);
  if (!user) return;

  if (!(await enforceRateLimit(res, { key: `setup:${user.id}`, max: 20, windowSec: 3600 }))) return;

  // Strict schema: company required; all fields length-bounded; slug charset-checked.
  const parsed = parseBody(res, req.body, {
    name:     { type: 'string', max: 120 },
    title:    { type: 'string', max: 120 },
    company:  { type: 'string', required: true, min: 1, max: 160 },
    size:     { type: 'string', max: 40 },
    role:     { type: 'string', max: 120 },
    industry: { type: 'string', max: 120 },
    location: { type: 'string', max: 120 },
    slug:     { type: 'string', max: 63, pattern: /^[a-z0-9-]+$/i },
  });
  if (!parsed) return;
  const { name, title, company, size, role, industry } = parsed;
  const slug = parsed.slug ? parsed.slug.toLowerCase() : null;
  // Prefer the value the user confirmed; fall back to edge-detected location.
  const location = (parsed.location && parsed.location.trim()) || detectLocation(req) || null;

  const db = adminClient();

  // Check if user already has a workspace
  const { data: existing } = await db
    .from('profiles')
    .select('workspace_id')
    .eq('id', user.id)
    .single();

  let workspace;

  if (existing?.workspace_id) {
    // Update existing workspace
    const { data: ws } = await db
      .from('workspaces')
      .update({ name: company, size, industry, location })
      .eq('id', existing.workspace_id)
      .select()
      .single();
    workspace = ws;
  } else {
    // Create new workspace
    const { data: ws, error: wsError } = await db
      .from('workspaces')
      .insert({ name: company, size, industry, location, owner_id: user.id, slug: slug || null })
      .select()
      .single();

    if (wsError) return fail(res, 500, 'Could not create workspace', wsError, 'setup');
    workspace = ws;

    // Add as admin member
    await db.from('workspace_members').insert({
      workspace_id: workspace.id,
      user_id: user.id,
      role: 'admin',
    });
  }

  // Upsert profile
  await db.from('profiles').upsert({
    id: user.id,
    name: name || null,
    title: title || null,
    role: role || null,
    industry: industry || null,
    workspace_id: workspace.id,
    onboarded: true,
  });

  const appUrl = process.env.APP_URL || 'https://workdaemon-prod.vercel.app';
  const inviteLink = `${appUrl}/join/${workspace.invite_code}`;

  // DAY-ONE AMBITION (owner directive): the moment a workspace exists, the brain
  // writes itself an aggressive company goal book; the moment a staff member
  // onboards, their daemon gets role goals + a brain-assigned skill toolkit.
  // All idempotent + fire-and-forget — onboarding never waits on the LLM.
  waitUntil((async () => {
    try { await generateCompanyGoals(adminClient(), { workspaceId: workspace.id }); }
    catch (e) { console.warn('[setup] company goals:', e.message); }
    try { await generateStaffGoals(adminClient(), { workspaceId: workspace.id, userId: user.id, role: role || title || null }); }
    catch (e) { console.warn('[setup] staff goals:', e.message); }
    try { await assignRoleSkills(adminClient(), { workspaceId: workspace.id, userId: user.id, role: role || title || null }); }
    catch (e) { console.warn('[setup] skill assignment:', e.message); }
    // SELF-SEEDING: the brain finds the company's public social footprint on its
    // own (website footer links + web search) — no connection required.
    try {
      const { discoverSocialPresence } = await import('../_lib/social.js');
      await discoverSocialPresence(adminClient(), { workspaceId: workspace.id });
    } catch (e) { console.warn('[setup] social discovery:', e.message); }
  })());

  return res.status(200).json({ workspace, inviteLink });
}
