import OpenAI from 'openai';
import { decryptSecret, assertSafeUrl } from './security.js';
import { recordUsage } from './metering.js';

// ─────────────────────────────────────────────────────────────────────────────
// Shared research engine: web search (Brave) + LLM synthesis.
// Used by api/user/research-role.js (per-user role brief) and
// api/workspace/research-company.js (workspace competitor/market intel).
// ─────────────────────────────────────────────────────────────────────────────

// Map a free-text role/title to the canonical function tags the brain scanner
// uses for affected_roles, so findings can be routed to the right person.
// Shared by api/chat.js (daemon surfacing) and research_actions.js (inbox push).
export function roleToTags(role) {
  const s = (role || '').toLowerCase();
  const tags = new Set();
  if (/\b(ceo|founder|chief executive|owner|managing director|\bmd\b)\b/.test(s)) tags.add('ceo');
  if (/market|brand|content|social|growth|comms|communicat/.test(s))            tags.add('marketing');
  if (/sales|account exec|business development|\bbd\b|revenue/.test(s))         tags.add('sales');
  if (/product|\bpm\b|design|ux/.test(s))                                       tags.add('product');
  if (/engineer|developer|\btech\b|cto|software|data/.test(s))                  tags.add('engineering');
  if (/\bops\b|operations|coo|logistics|supply/.test(s))                        tags.add('operations');
  if (/financ|account|cfo|bookkeep/.test(s))                                    tags.add('finance');
  if (/\bhr\b|people|talent|recruit|human resource/.test(s))                    tags.add('hr');
  if (/legal|counsel|compliance/.test(s))                                       tags.add('legal');
  if (/customer success|support|\bcs\b|account manage/.test(s))                 tags.add('customer-success');
  return [...tags];
}

// ── Web research via Brave Search ─────────────────────────────────────────────
export async function braveSearch(query, { count = 8, freshness = null } = {}) {
  const key = process.env.BRAVE_SEARCH_API_KEY;
  if (!key) return { grounded: false, snippets: [], sources: [] };

  const params = new URLSearchParams({ q: query, count: String(count) });
  if (freshness) params.set('freshness', freshness); // e.g. 'pw' past week, 'pm' past month

  try {
    const r = await fetch(`https://api.search.brave.com/res/v1/web/search?${params}`, {
      headers: { Accept: 'application/json', 'X-Subscription-Token': key },
      // Hard timeout: a hung Brave request must never stall the daemon turn (it
      // ran inline before the LLM call, so no cap meant the whole chat hung → 504).
      signal: AbortSignal.timeout(6000),
    });
    if (!r.ok) {
      console.warn('[research] brave status=%d query=%s', r.status, query.slice(0, 60));
      return { grounded: false, snippets: [], sources: [] };
    }
    const d = await r.json();
    const results = d?.web?.results || [];
    const snippets = results.slice(0, count).map(x => ({
      title: x.title,
      description: x.description,
      url: x.url,
      age: x.age || x.page_age || null,
    }));
    return { grounded: snippets.length > 0, snippets, sources: snippets.map(s => s.url).filter(Boolean) };
  } catch (e) {
    console.warn('[research] brave error:', e.message);
    return { grounded: false, snippets: [], sources: [] };
  }
}

// Run several queries and merge, de-duplicating by URL.
export async function braveSearchMany(queries, opts = {}) {
  const runs = await Promise.all(queries.map(q => braveSearch(q, opts)));
  const seen = new Set();
  const snippets = [];
  for (const run of runs) {
    for (const s of run.snippets) {
      if (s.url && seen.has(s.url)) continue;
      if (s.url) seen.add(s.url);
      snippets.push(s);
    }
  }
  return {
    grounded: snippets.length > 0,
    snippets,
    sources: [...seen],
  };
}

// ── Real page reading (snippets → full text) ──────────────────────────────────
// Brave/Tavily search give a title + ~200-char description. That's why "go
// online and read X" produced thin answers — the model never saw the page. This
// fetches the page itself, SSRF-guarded (assertSafeUrl resolves DNS + blocks
// private ranges) and strips it to plain text so the daemon can ground on the
// actual content. Bounded by a hard timeout and a byte cap.
function htmlToText(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<\/(p|div|li|h[1-6]|tr|section|article|br)>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => { try { return String.fromCodePoint(parseInt(h, 16)); } catch { return ' '; } })
    .replace(/&#(\d+);/g, (_, n) => { try { return String.fromCodePoint(parseInt(n, 10)); } catch { return ' '; } })
    .replace(/[ \t\f\v]+/g, ' ')
    .replace(/\n\s*\n\s*\n+/g, '\n\n')
    .trim();
}

// Pull URLs (and bare domains like "betatenant.com") out of a user message so
// the daemon can read them directly — no trigger words needed. Emails excluded
// (the char before the domain is '@', which the boundary class rejects).
const URL_RE = /\bhttps?:\/\/[^\s<>()"']+/gi;
const DOMAIN_RE = /(?:^|[\s,;:("'<])((?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+(?:com|net|org|io|ai|app|dev|co|so|xyz|me|info|biz|us|uk|ca|au|de|fr|ng|in|eu|tech|site|online|store|shop))(?=[\s,;:)"'>!?]|\.?\s|\.?$)/gi;
export function extractUrls(text, max = 3) {
  const s = String(text || '');
  const found = [];
  for (const m of s.matchAll(URL_RE)) found.push(m[0].replace(/[.,;:!?)]+$/, ''));
  for (const m of s.matchAll(DOMAIN_RE)) {
    const d = m[1].toLowerCase();
    if (!found.some(u => u.includes(d))) found.push(`https://${d}`);
  }
  return [...new Set(found)].slice(0, max);
}

export async function fetchPageText(url, { maxChars = 4000, timeoutMs = 6000 } = {}) {
  let safe;
  try { safe = await assertSafeUrl(url); } catch { return null; } // SSRF / bad URL
  try {
    const r = await fetch(safe, {
      headers: { 'User-Agent': 'WorkDaemonBot/1.0 (+https://workdaemon.com)', Accept: 'text/html,text/plain' },
      redirect: 'follow',
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!r.ok) return null;
    const ct = r.headers.get('content-type') || '';
    if (!/text\/html|text\/plain|application\/xhtml/.test(ct)) return null;
    // Cap the body we pull into memory (~400KB) before stripping tags.
    const raw = (await r.text()).slice(0, 400_000);
    const text = (ct.includes('html') ? htmlToText(raw) : raw).slice(0, maxChars);
    return text.length > 80 ? text : null; // ignore near-empty / JS-only shells
  } catch { return null; } // timeout / network / parse → skip this page
}

// ── Tavily: search API that returns extracted page content, not just snippets ──
// Preferred when TAVILY_API_KEY is set — one call gives ranked results with a
// `content` field already extracted, so no separate page-fetch round trips.
export async function tavilySearch(query, { count = 6, freshness = null } = {}) {
  const key = process.env.TAVILY_API_KEY;
  if (!key) return null; // signal "not configured" so callers can fall back
  try {
    const r = await fetch('https://api.tavily.com/search', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        api_key: key,
        query,
        max_results: count,
        search_depth: 'basic',
        include_answer: false,
        topic: freshness ? 'news' : 'general',
        ...(freshness === 'pw' ? { days: 7 } : freshness === 'pm' ? { days: 30 } : {}),
      }),
      signal: AbortSignal.timeout(8000),
    });
    if (!r.ok) { console.warn('[research] tavily status=%d', r.status); return { grounded: false, snippets: [], sources: [] }; }
    const d = await r.json();
    const snippets = (d?.results || []).slice(0, count).map(x => ({
      title: x.title,
      description: x.content ? String(x.content).slice(0, 300) : '',
      content: x.content ? String(x.content).slice(0, 4000) : '', // full extract
      url: x.url,
      age: null,
    }));
    return { grounded: snippets.length > 0, snippets, sources: snippets.map(s => s.url).filter(Boolean) };
  } catch (e) { console.warn('[research] tavily error:', e.message); return { grounded: false, snippets: [], sources: [] }; }
}

// ── webResearch: the orchestrator the daemon actually calls ───────────────────
// Tier 1: Tavily (real content in one call) when configured.
// Tier 2: Brave for ranking, then fetch + extract the top pages for real text.
// Either way snippets carry a `content` field (full page text) when available,
// so the daemon grounds on pages, not 200-char blurbs. Fully timeout-bounded.
export async function webResearch(queries, { count = 6, freshness = null, readPages = 3 } = {}) {
  const qs = [...new Set((queries || []).filter(Boolean))];
  if (!qs.length) return { grounded: false, snippets: [], sources: [] };

  // Tier 1 — Tavily (null = not configured → fall through to Brave).
  if (process.env.TAVILY_API_KEY) {
    const runs = await Promise.all(qs.map(q => tavilySearch(q, { count, freshness })));
    const seen = new Set(); const snippets = [];
    for (const run of runs || []) for (const s of (run?.snippets || [])) {
      if (s.url && seen.has(s.url)) continue;
      if (s.url) seen.add(s.url);
      snippets.push(s);
    }
    if (snippets.length) return { grounded: true, snippets, sources: [...seen] };
  }

  // Tier 2 — Brave ranking + real page reads on the top results.
  const base = await braveSearchMany(qs, { count, freshness });
  if (!base.snippets.length) return base;
  const toRead = base.snippets.filter(s => s.url).slice(0, readPages);
  const pages = await Promise.all(toRead.map(s => fetchPageText(s.url).catch(() => null)));
  pages.forEach((text, i) => { if (text) toRead[i].content = text; });
  return { ...base, grounded: true };
}

// ── Resolve an LLM (workspace key first, then env fallback) ───────────────────
export async function resolveLLM(workspaceId, db) {
  const cfg = await resolveLLMInner(workspaceId, db);
  if (cfg && workspaceId) cfg._meter = { workspaceId };  // lets callLLM attribute token usage
  return cfg;
}

async function resolveLLMInner(workspaceId, db) {
  if (workspaceId) {
    const { data: keys } = await db
      .from('workspace_api_keys')
      .select('provider, api_key, endpoint, model, use_case')
      .eq('workspace_id', workspaceId)
      .order('created_at');
    const row = keys?.find(k => k.use_case === 'reasoning')
             ?? keys?.find(k => k.use_case === 'default')
             ?? keys?.[0];
    if (row?.api_key && ['anthropic', 'openai', 'openrouter', 'deepseek', 'hermes'].includes(row.provider)) {
      return { ...row, api_key: decryptSecret(row.api_key) };
    }

    const { data: ws } = await db
      .from('workspaces')
      .select('openrouter_key, openrouter_model')
      .eq('id', workspaceId)
      .single();
    if (ws?.openrouter_key) {
      return { provider: 'openrouter', api_key: decryptSecret(ws.openrouter_key), model: ws.openrouter_model };
    }
  }
  // Env fallbacks. HERMES FIRST: daemons run on the shared Hermes gateway by
  // default (mirrors api/chat.js auto-onboard), so the autonomous daemon engine
  // and brain synthesis use the same Hermes agent the conversational daemon does.
  // DeepSeek/cloud remain as resilience (see callLLM 'hermes' fallback) and for
  // companies where the gateway env isn't set.
  if (process.env.HERMES_SHARED_GATEWAY_URL && process.env.HERMES_SHARED_API_KEY) {
    return {
      provider: 'hermes',
      endpoint: process.env.HERMES_SHARED_GATEWAY_URL,
      api_key:  process.env.HERMES_SHARED_API_KEY,
      model:    process.env.HERMES_SHARED_MODEL || 'hermes-agent',
    };
  }
  if (process.env.DEEPSEEK_API_KEY) {
    return {
      provider: 'deepseek',
      api_key:  process.env.DEEPSEEK_API_KEY,
      endpoint: process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com',
      model:    'deepseek-chat',
    };
  }
  if (process.env.ANTHROPIC_API_KEY) {
    return { provider: 'anthropic', api_key: process.env.ANTHROPIC_API_KEY, model: 'claude-sonnet-4-6' };
  }
  if (process.env.OPENAI_API_KEY) {
    return { provider: 'openai', api_key: process.env.OPENAI_API_KEY, model: 'gpt-4o' };
  }
  return null;
}

export async function callLLM(cfg, sys, user, opts = {}) {
  const text = await callLLMInner(cfg, sys, user, opts);
  try {
    recordUsage({
      workspaceId: cfg?._meter?.workspaceId, provider: cfg?.provider, model: cfg?.model,
      promptText: `${sys}\n${user}`, completionText: text,
    });
  } catch { /* metering must never break synthesis */ }
  return text;
}

async function callLLMInner({ provider, api_key, model, endpoint }, sys, user, { maxTokens = 1200 } = {}) {
  switch (provider) {
    case 'deepseek': {
      const client = new OpenAI({ baseURL: (endpoint || 'https://api.deepseek.com').replace(/\/$/, ''), apiKey: api_key });
      const r = await client.chat.completions.create({
        model: model || 'deepseek-chat',
        max_tokens: maxTokens,
        messages: [{ role: 'system', content: sys }, { role: 'user', content: user }],
      });
      return r.choices[0]?.message?.content ?? '';
    }
    case 'openrouter': {
      const client = new OpenAI({
        baseURL: 'https://openrouter.ai/api/v1',
        apiKey: api_key,
        defaultHeaders: { 'HTTP-Referer': 'https://workdaemon.com', 'X-Title': 'WorkDaemon' },
      });
      const r = await client.chat.completions.create({
        model: model || 'anthropic/claude-sonnet-4-5',
        max_tokens: maxTokens,
        messages: [{ role: 'system', content: sys }, { role: 'user', content: user }],
      });
      return r.choices[0]?.message?.content ?? '';
    }
    case 'openai': {
      const client = new OpenAI({ apiKey: api_key });
      const r = await client.chat.completions.create({
        model: model || 'gpt-4o',
        max_tokens: maxTokens,
        messages: [{ role: 'system', content: sys }, { role: 'user', content: user }],
      });
      return r.choices[0]?.message?.content ?? '';
    }
    case 'anthropic': {
      const r = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'x-api-key': api_key, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
        body: JSON.stringify({
          model: model || 'claude-sonnet-4-6',
          max_tokens: maxTokens,
          system: sys,
          messages: [{ role: 'user', content: user }],
        }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error?.message || 'Anthropic error');
      return d.content?.find(b => b.type === 'text')?.text ?? '';
    }
    // Per-company / shared Hermes agent gateway (OpenAI-compatible). Resilience:
    // a self-hosted gateway hiccup or cold-start must NEVER break brain synthesis,
    // so on failure we fall back to a cloud synthesiser when one is available.
    case 'hermes': {
      const msgs = [{ role: 'system', content: sys }, { role: 'user', content: user }];
      try {
        const client = new OpenAI({ baseURL: (endpoint || '').replace(/\/$/, ''), apiKey: api_key || 'hermes' });
        const r = await client.chat.completions.create({ model: model || 'hermes', max_tokens: maxTokens, messages: msgs });
        return r.choices[0]?.message?.content ?? '';
      } catch (e) {
        if (process.env.DEEPSEEK_API_KEY) {
          const client = new OpenAI({ baseURL: (process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com').replace(/\/$/, ''), apiKey: process.env.DEEPSEEK_API_KEY });
          const r = await client.chat.completions.create({ model: 'deepseek-chat', max_tokens: maxTokens, messages: msgs });
          return r.choices[0]?.message?.content ?? '';
        }
        throw e;
      }
    }
    default:
      throw new Error(`Unsupported synthesis provider: ${provider}`);
  }
}

// Extract the first JSON object from a model response (handles ```json fences).
export function extractJson(text) {
  if (!text) return null;
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fence ? fence[1] : text;
  try { return JSON.parse(candidate.trim()); } catch {}
  let depth = 0, start = -1;
  for (let i = 0; i < candidate.length; i++) {
    if (candidate[i] === '{') { if (depth === 0) start = i; depth++; }
    else if (candidate[i] === '}') { depth--; if (depth === 0 && start !== -1) {
      try { return JSON.parse(candidate.slice(start, i + 1)); } catch { start = -1; }
    } }
  }
  return null;
}
