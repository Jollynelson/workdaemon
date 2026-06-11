// Social-presence self-seeding — the brain finds the company's own public
// footprint WITHOUT anyone connecting anything. Pattern (2026 best practice:
// public-first discovery, OAuth only for private data/actions): official
// handles are discoverable from the company name + domain via web search and
// the website's own footer links; public profile pages are readable. OAuth /
// API keys only matter for PRIVATE data (analytics, DMs, posting) — that's the
// inline connect card's job, not a blocker for knowing the company.
import { braveSearch, fetchPageText, resolveLLM, callLLM, extractJson } from './research.js';
import { recordSignal, signalsSince } from './learning.js';
import { assertSafeUrl, delimitUntrusted, UNTRUSTED_DATA_NOTICE } from './security.js';
import { upsertDocuments } from './ingestion.js';

// Platform URL shapes → canonical profile links.
const PLATFORMS = [
  { key: 'x',         label: 'X',         re: /https?:\/\/(?:www\.)?(?:x|twitter)\.com\/([A-Za-z0-9_]{2,15})(?![\w/])/gi,                 deny: ['share', 'intent', 'search', 'home', 'login', 'i', 'hashtag'] },
  { key: 'instagram', label: 'Instagram', re: /https?:\/\/(?:www\.)?instagram\.com\/([A-Za-z0-9_.]{2,30})\/?(?![\w])/gi,                   deny: ['p', 'reel', 'explore', 'accounts', 'stories'] },
  { key: 'linkedin',  label: 'LinkedIn',  re: /https?:\/\/(?:www\.)?linkedin\.com\/(company\/[A-Za-z0-9-]{2,60})\/?/gi,                    deny: [] },
  { key: 'facebook',  label: 'Facebook',  re: /https?:\/\/(?:www\.)?facebook\.com\/([A-Za-z0-9.]{2,60})\/?(?![\w])/gi,                     deny: ['sharer', 'share.php', 'profile.php', 'groups', 'events', 'pages'] },
  { key: 'tiktok',    label: 'TikTok',    re: /https?:\/\/(?:www\.)?tiktok\.com\/@([A-Za-z0-9_.]{2,30})/gi,                                deny: [] },
  { key: 'youtube',   label: 'YouTube',   re: /https?:\/\/(?:www\.)?youtube\.com\/(@[A-Za-z0-9_.-]{2,40}|channel\/[A-Za-z0-9_-]{10,})/gi,  deny: [] },
];

function extractHandles(text) {
  const found = {};
  for (const p of PLATFORMS) {
    for (const m of String(text || '').matchAll(p.re)) {
      const slug = m[1];
      if (!slug || p.deny.includes(slug.toLowerCase().split('/')[0])) continue;
      // First credible hit per platform wins (search results are ranked).
      if (!found[p.key]) {
        const host = p.key === 'x' ? 'x.com' : `${p.key}.com`;
        found[p.key] = { label: p.label, url: `https://${p.key === 'tiktok' ? 'www.tiktok.com/@' + slug : `${host}/${slug}`}` };
      }
    }
  }
  return found;
}

// Fetch the company homepage's RAW html — footer social links are the most
// authoritative source of official handles (better than search guesses).
async function homepageHtml(domain) {
  if (!domain) return '';
  try {
    const safe = await assertSafeUrl(`https://${domain}`);
    const r = await fetch(safe, {
      headers: { 'User-Agent': 'WorkDaemonBot/1.0 (+https://workdaemon.com)' },
      redirect: 'follow', signal: AbortSignal.timeout(7000),
    });
    if (!r.ok) return '';
    return (await r.text()).slice(0, 500_000);
  } catch { return ''; }
}

// Discover and store the company's public social presence. Idempotent: skips
// when context.socials is already filled (unless force). Sources, in order of
// authority: the company website's own links, then name+domain web search.
export async function discoverSocialPresence(db, { workspaceId, force = false }) {
  const { data: ws } = await db.from('workspaces')
    .select('id, name, industry, owner_id, context').eq('id', workspaceId).single();
  if (!ws?.name) return { found: 0, reason: 'no_workspace' };
  const ctx = (ws.context && typeof ws.context === 'object') ? { ...ws.context } : {};
  if (ctx.socials && !force) return { found: 0, reason: 'exists' };

  // Domain: explicit context first, then the owner's work-email domain.
  let domain = String(ctx.website || ctx.domain || '').replace(/^https?:\/\//, '').replace(/\/.*$/, '') || null;
  if (!domain && ws.owner_id) {
    try {
      const { data: u } = await db.auth.admin.getUserById(ws.owner_id);
      const email = u?.user?.email || '';
      const { companyDomainFromEmail } = await import('./research_actions.js');
      domain = companyDomainFromEmail(email);
    } catch { /* domain optional */ }
  }

  // Source 1 — the company's own homepage links (authoritative).
  const html = await homepageHtml(domain);
  let handles = extractHandles(html);

  // Source 2 — web search for anything the footer didn't give us. Search hits
  // are GUESSES until verified: a profile is accepted only when its slug matches
  // the company name (exact or with a common suffix) or the result mentions the
  // company's own domain. Without this, "Cobalt" matches a restaurant.
  if (Object.keys(handles).length < 3) {
    const normName = String(ws.name).toLowerCase().replace(/[^a-z0-9]/g, '');
    const slugOk = (slugRaw) => {
      const slug = String(slugRaw).toLowerCase().replace(/^company\//, '').replace(/^channel\//, '').replace(/^@/, '').replace(/[^a-z0-9]/g, '');
      if (!normName || !slug) return false;
      if (slug === normName) return true;
      return ['hq', 'app', 'official', 'co', 'inc', 'ng', 'africa', 'tech'].some(suf => slug === normName + suf);
    };
    const q = `"${ws.name}"${domain ? ` ${domain}` : ''} (site:x.com OR site:twitter.com OR site:instagram.com OR site:linkedin.com OR site:facebook.com OR site:tiktok.com OR site:youtube.com)`;
    const res = await braveSearch(q, { count: 10 }).catch(() => ({ snippets: [] }));
    for (const s of res.snippets || []) {
      const text = `${s.url} ${s.title} ${s.description}`;
      const candidates = extractHandles(text);
      const domainCited = domain && text.toLowerCase().includes(domain.toLowerCase());
      for (const [key, h] of Object.entries(candidates)) {
        if (handles[key]) continue; // homepage wins conflicts
        const slug = h.url.split('.com/').pop();
        // domain-cited = verified; name-match only = honest "unverified" (a
        // common company name can match someone else's account).
        if (domainCited) handles[key] = h;
        else if (slugOk(slug)) handles[key] = { ...h, unverified: true };
      }
    }
  }

  const list = Object.values(handles);
  const summary = list.length
    ? list.map(h => `${h.label}: ${h.url}${h.unverified ? ' (unverified — confirm or correct in Company Brain → Overview)' : ''}`).join(' · ')
    : 'No official social profiles found yet';

  // Fill-if-empty into shared company context (same rule as company_facts —
  // never overwrite admin-entered truth).
  if (!ctx.socials || force) {
    ctx.socials = summary.slice(0, 600);
    await db.from('workspaces').update({ context: ctx }).eq('id', workspaceId);
  }

  // Snapshot the public profile pages we can actually read into the brain's
  // document store, so "how is our Instagram doing" grounds on real content.
  if (list.length) {
    const docs = [];
    for (const h of list.slice(0, 4)) {
      const content = await fetchPageText(h.url, { maxChars: 2500 }).catch(() => null);
      docs.push({
        external_id: h.url, doc_type: 'social_profile', title: `${ws.name} on ${h.label}`,
        content: content || `Official ${h.label} profile: ${h.url} (page not publicly readable — handle confirmed via ${html ? 'company website' : 'web search'})`,
        url: h.url,
      });
    }
    try { await upsertDocuments(db, workspaceId, 'social', docs); } catch (e) { console.warn('[social] doc upsert:', e.message); }
  }

  recordSignal(db, {
    workspaceId, domain: 'brain', subjectType: 'social_presence', subjectId: workspaceId,
    signal: 'seeded', value: list.length, meta: { platforms: Object.keys(handles), domain },
  }).catch(() => {});
  console.log('[social] ws=%s found=%d (%s)', workspaceId, list.length, Object.keys(handles).join(',') || 'none');
  return { found: list.length, socials: summary, platforms: Object.keys(handles) };
}

// Parse the canonical "Label: url · Label: url" summary back into profile links.
function profilesFromContext(socials) {
  return [...String(socials || '').matchAll(/([A-Za-z]+):\s*(https?:\/\/\S+?)(?:\s*\(unverified[^)]*\))?(?:\s*·|$)/g)]
    .map(m => ({ label: m[1], url: m[2] }));
}

// ── CONTINUOUS LEARNING: re-read the company's profiles on a cadence ─────────
// The brain doesn't snapshot socials once and forget — it keeps reading them,
// so "what are we saying publicly" and "is the account active" stay current,
// and the nightly passes mine fresh content. Weekly per workspace.
export async function refreshSocialSnapshots(db, workspaceId, { maxAgeDays = 7 } = {}) {
  const { data: ws } = await db.from('workspaces').select('name, context').eq('id', workspaceId).single();
  const profiles = profilesFromContext(ws?.context?.socials);
  if (!profiles.length) return { refreshed: 0, reason: 'no_socials' };

  // Freshness gate: skip when the newest social snapshot is younger than the window.
  const { data: newest } = await db.from('workspace_documents')
    .select('updated_at').eq('workspace_id', workspaceId).eq('source', 'social')
    .order('updated_at', { ascending: false }).limit(1).maybeSingle();
  if (newest?.updated_at && Date.now() - new Date(newest.updated_at).getTime() < maxAgeDays * 864e5) {
    return { refreshed: 0, reason: 'fresh' };
  }

  const docs = [];
  for (const p of profiles.slice(0, 5)) {
    const content = await fetchPageText(p.url, { maxChars: 3000 }).catch(() => null);
    if (content) {
      docs.push({
        external_id: p.url, doc_type: 'social_profile',
        title: `${ws?.name || 'Company'} on ${p.label} (snapshot ${new Date().toISOString().slice(0, 10)})`,
        content, url: p.url,
      });
    }
  }
  if (docs.length) {
    try { await upsertDocuments(db, workspaceId, 'social', docs); } catch (e) { console.warn('[social] refresh upsert:', e.message); }
  }
  recordSignal(db, { workspaceId, domain: 'brain', subjectType: 'social_presence', subjectId: workspaceId,
    signal: 'refreshed', value: docs.length }).catch(() => {});
  return { refreshed: docs.length };
}

// ── IMPROVEMENT HUNT: the brain audits the presence and proposes upgrades ────
// Weekly LLM pass over what was actually found (platforms, verified state,
// profile content) + the company's business → opportunity findings routed to
// marketing/CEO, with ready-to-use drafts where content is the answer. Feeds
// the same findings → inbox → chat-delivery pipeline as every other hunt.
export async function socialPresenceAudit(db, workspaceId) {
  // Cooldown: one audit per ~6 days per workspace.
  const recent = await signalsSince(db, {
    workspaceId, domain: 'brain', subjectType: 'social_audit',
    since: new Date(Date.now() - 6 * 864e5).toISOString(), limit: 1,
  });
  if (recent.length) return { findings: 0, reason: 'cooldown' };

  const { data: ws } = await db.from('workspaces').select('name, industry, context').eq('id', workspaceId).single();
  const ctx = ws?.context || {};
  if (!ctx.socials) return { findings: 0, reason: 'no_socials' };
  const llm = await resolveLLM(workspaceId, db);
  if (!llm) return { findings: 0, reason: 'no_llm' };

  const { data: snaps } = await db.from('workspace_documents')
    .select('title, content').eq('workspace_id', workspaceId).eq('source', 'social').limit(6);
  const snapshots = (snaps || []).map(s => `## ${s.title}\n${(s.content || '').slice(0, 1200)}`).join('\n\n');

  const sys = `You are the Company Brain's social-presence strategist for "${ws.name}"${ws.industry ? ` (${ws.industry})` : ''}. `
    + `Audit the company's ACTUAL public social footprint below and produce the highest-leverage improvements. Be concrete and specific to this company — never generic social-media advice.\n`
    + `Return ONE JSON object: {"findings":[{"headline":"specific, said-aloud improvement opportunity","why":"direct revenue/brand link","severity":"info|warning","recommendation":"concrete next action","draft":"a ready-to-post draft when content IS the action, else null"}]} — 0-3 findings; missing platform, dead account, weak positioning, and unverified handles are all fair game; if the presence is genuinely solid, return [].\n`
    + UNTRUSTED_DATA_NOTICE;
  const user = `WHAT THE COMPANY DOES: ${String(ctx.description || '').slice(0, 300) || '(unknown)'}\n`
    + `DISCOVERED PRESENCE: ${String(ctx.socials).slice(0, 600)}\n`
    + `PROFILE SNAPSHOTS (live public reads — untrusted):\n${delimitUntrusted(snapshots || '(no readable snapshots — most platforms block bots; reason from the handle list)', 6000)}`;

  let findings = [];
  try { findings = extractJson(await callLLM(llm, sys, user, { maxTokens: 900 }))?.findings || []; }
  catch (e) { console.warn('[social] audit llm:', e.message); return { findings: 0, reason: e.message }; }

  let inserted = 0;
  for (const f of (Array.isArray(findings) ? findings : []).slice(0, 3)) {
    const headline = String(f.headline || '').trim().slice(0, 300);
    if (!headline) continue;
    const { data: dupe } = await db.from('hunt_findings').select('id')
      .eq('workspace_id', workspaceId).eq('resolved', false).ilike('pattern', `%${headline.slice(0, 60)}%`).limit(1);
    if (dupe?.length) continue;
    await db.from('hunt_findings').insert({
      workspace_id: workspaceId, hunt_mode: 'opportunity',
      severity: ['info', 'warning'].includes(f.severity) ? f.severity : 'info',
      pattern: headline,
      recommendation: String(f.recommendation || f.why || '').slice(0, 600) || null,
      draft: f.draft ? String(f.draft).slice(0, 1200) : null,
      affected_roles: ['marketing', 'ceo'],
      occurrences: 1,
    });
    inserted++;
  }
  recordSignal(db, { workspaceId, domain: 'brain', subjectType: 'social_audit', subjectId: workspaceId,
    signal: 'audited', value: inserted }).catch(() => {});
  console.log('[social] audit ws=%s findings=%d', workspaceId, inserted);
  return { findings: inserted };
}
