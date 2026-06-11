import { requireAuth, adminClient } from '../_lib/supabase.js';
import { fail, enforceRateLimit, parseBody, detectLocation } from '../_lib/security.js';
import { generateCompanyGoals, generateStaffGoals } from '../_lib/goals.js';
import { assignRoleSkills } from '../_lib/skills.js';
import { waitUntil } from '@vercel/functions';

// Server-side geocode of a free-text location → structured {city,region,country,
// countrycode} via Photon (komoot — free, keyless). Fixed host (no SSRF), short
// timeout, best-effort: returns null on any failure so it never blocks setup.
async function geocodePhoton(q) {
  if (!q || q.trim().length < 2) return null;
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 3000);
  try {
    const r = await fetch(`https://photon.komoot.io/api/?q=${encodeURIComponent(q)}&limit=1&lang=en`, { signal: ctrl.signal });
    if (!r.ok) return null;
    const d = await r.json();
    const p = d.features?.[0]?.properties;
    if (!p || !p.country) return null;
    const isPlace = /(city|town|village|hamlet|municipality|locality|suburb)/i.test(p.osm_value || p.type || '');
    const meta = {
      city: (p.city || (isPlace ? p.name : '') || '').slice(0, 80),
      region: (p.state || '').slice(0, 80),
      country: (p.country || '').slice(0, 80),
      countrycode: (p.countrycode || '').toUpperCase().slice(0, 2),
    };
    return (meta.country || meta.region || meta.city) ? meta : null;
  } catch { return null; }
  finally { clearTimeout(t); }
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const user = await requireAuth(req, res);
  if (!user) return;

  if (!(await enforceRateLimit(res, { key: `setup:${user.id}`, max: 20, windowSec: 3600 }))) return;

  // Strict schema: company required; all fields length-bounded; slug charset-checked.
  const parsed = parseBody(res, req.body, {
    name:          { type: 'string', max: 120 },
    title:         { type: 'string', max: 120 },
    company:       { type: 'string', required: true, min: 1, max: 160 },
    size:          { type: 'string', max: 40 },
    role:          { type: 'string', max: 120 },
    industry:      { type: 'string', max: 120 },
    location:      { type: 'string', max: 120 },
    location_meta: { type: 'object' },   // structured {city,region,country,countrycode} from the typeahead
    slug:          { type: 'string', max: 63, pattern: /^[a-z0-9-]+$/i },
  });
  if (!parsed) return;
  const { name, title, company, size, role, industry } = parsed;
  const slug = parsed.slug ? parsed.slug.toLowerCase() : null;
  // Prefer the value the user confirmed; fall back to edge-detected location.
  const location = (parsed.location && parsed.location.trim()) || detectLocation(req) || null;

  // Structured location (city / region / country / ISO code) for later geo-targeting.
  // Sanitised + length-capped; null unless at least a country or region is present.
  const locMeta = (() => {
    const m = parsed.location_meta;
    if (!m || typeof m !== 'object') return null;
    const s = (v, n) => (typeof v === 'string' ? v.trim().slice(0, n) : '');
    const out = {
      city: s(m.city, 80), region: s(m.region, 80),
      country: s(m.country, 80), countrycode: s(m.countrycode, 2).toUpperCase(),
    };
    return (out.country || out.region || out.city) ? out : null;
  })();

  const db = adminClient();

  // Check if user already has a workspace
  const { data: existing } = await db
    .from('profiles')
    .select('workspace_id')
    .eq('id', user.id)
    .single();

  let workspace;

  if (existing?.workspace_id) {
    // Update existing workspace — merge structured location into context (don't clobber timezone etc.)
    let ctxPatch;
    if (locMeta) {
      const { data: cur } = await db.from('workspaces').select('context').eq('id', existing.workspace_id).single();
      const ctx = (cur?.context && typeof cur.context === 'object') ? cur.context : {};
      ctx.location = locMeta;
      ctxPatch = { context: ctx };
    }
    const { data: ws } = await db
      .from('workspaces')
      .update({ name: company, size, industry, location, ...(ctxPatch || {}) })
      .eq('id', existing.workspace_id)
      .select()
      .single();
    workspace = ws;
  } else {
    // Create new workspace
    const { data: ws, error: wsError } = await db
      .from('workspaces')
      .insert({ name: company, size, industry, location, owner_id: user.id, slug: slug || null, ...(locMeta ? { context: { location: locMeta } } : {}) })
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
    // If the user didn't pick a structured location from the dropdown, geocode
    // their final free-text value on save so we still capture country/region.
    if (!locMeta && location) {
      try {
        const meta = await geocodePhoton(location);
        if (meta) {
          const gdb = adminClient();
          const { data: cur } = await gdb.from('workspaces').select('context').eq('id', workspace.id).single();
          const ctx = (cur?.context && typeof cur.context === 'object') ? cur.context : {};
          ctx.location = meta;
          await gdb.from('workspaces').update({ context: ctx }).eq('id', workspace.id);
        }
      } catch (e) { console.warn('[setup] geocode:', e.message); }
    }
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
