// Social-presence self-seeding — the brain finds the company's own public
// footprint WITHOUT anyone connecting anything. Pattern (2026 best practice:
// public-first discovery, OAuth only for private data/actions): official
// handles are discoverable from the company name + domain via web search and
// the website's own footer links; public profile pages are readable. OAuth /
// API keys only matter for PRIVATE data (analytics, DMs, posting) — that's the
// inline connect card's job, not a blocker for knowing the company.
import { braveSearch, fetchPageText } from './research.js';
import { recordSignal } from './learning.js';
import { assertSafeUrl } from './security.js';
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
