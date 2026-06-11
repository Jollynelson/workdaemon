import { requireAuth, adminClient } from './_lib/supabase.js';
import { decryptSecret, enforceRateLimit, delimitUntrusted, parseBody, signServiceToken } from './_lib/security.js';
import { webResearch, fetchPageText, extractUrls } from './_lib/research.js';
import { callProvider, callProviderStream, LLM_CALL_TIMEOUT_MS } from './_lib/providers.js';
import { createEnvelopeStream } from './_lib/stream_envelope.js';
import { buildDaemonSystemPrompt } from './_lib/prompt.js';
import { extractTopicTags } from './_lib/topics.js';
import { classifyTurn, pickTierModels, responseIsThin, wantsDeep } from './_lib/brain_router.js';
import { graphSummary } from './brain.js';
import { retrieveDocuments, upsertDocuments } from './_lib/ingestion.js';
import { transcriptLines, transcriptDoc } from './_lib/transcripts.js';
import { parseJsonResponse } from './_lib/envelope.js';
import { recordSignal, buildDaemonLearningContext } from './_lib/learning.js';
import { relevantSkills, renderSkillsBlock, bumpSkillUsage } from './_lib/skills.js';
import { activeGoals, goalsPromptBlock } from './_lib/goals.js';
import { waitUntil } from '@vercel/functions';

// ── Live web search (retrieval augmentation for the daemon chat) ──────────────
// Trigger words that mean the user wants fresh / external info.
const SEARCH_TRIGGER = /\b(search|google|look\s?up|browse|online|web|latest|news|recent(?:ly)?|current(?:ly)?|today|tonight|this\s+(?:week|month|year)|right\s+now|happening|trending|headlines?|updates?|breaking|price|market)\b/i;
const FRESH_TRIGGER  = /\b(latest|news|recent(?:ly)?|today|tonight|this\s+(?:week|month)|right\s+now|happening|trending|headlines?|currently|updates?|breaking)\b/i;

function wantsWebSearch(text) {
  if (!text) return false;
  if (text === '[SESSION_START]' || text === '[SESSION_RESUME]') return false;
  if (/^CONFIRMED —/.test(text)) return false;
  return SEARCH_TRIGGER.test(text);
}

async function runWebSearch(userText, { wsName, wsIndustry, companyDesc }) {
  const freshness = FRESH_TRIGGER.test(userText) ? 'pw' : null; // past week
  const queries = [];
  const cleaned = userText
    .replace(/\b(search(\s+online|\s+the\s+web)?|google|look\s?up|browse)\b/gi, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (cleaned) queries.push(cleaned.slice(0, 200));
  // If the question names the company, add a scoped query for richer grounding.
  if (wsName) {
    const esc = wsName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    if (new RegExp(esc, 'i').test(userText)) {
      queries.push([wsName, wsIndustry, companyDesc].filter(Boolean).join(' ').slice(0, 200));
    }
  }
  // Bare "search online" (trigger words only, no topic) used to produce an EMPTY
  // query → "no results" without ever calling the search API. The clear intent
  // is "research my company" — fall back to a company query.
  if (!queries.length && wsName) {
    queries.push([wsName, wsIndustry, companyDesc, 'company'].filter(Boolean).join(' ').slice(0, 200));
  }
  if (!queries.length) return { grounded: false, snippets: [] };
  // webResearch reads the actual pages (Tavily, or Brave + page-extract) so the
  // daemon grounds on real content, not 200-char blurbs. Fully timeout-bounded.
  return webResearch([...new Set(queries)], { count: 6, freshness, readPages: 3 });
}

// Format fetched results as delimited UNTRUSTED context (web text can carry
// prompt-injection, so it must never sit in instruction position).
function buildWebContext(web, { attempted }) {
  if (web?.snippets?.length) {
    const lines = web.snippets.slice(0, 6).map((s, i) => {
      // Prefer the extracted page body when we have it; fall back to the snippet.
      const body = (s.content && s.content.length > (s.description || '').length) ? s.content : (s.description || '');
      return `${i + 1}. ${s.title || '(untitled)'}${s.age ? ` [${s.age}]` : ''}\n   ${body}\n   ${s.url || ''}`;
    }).join('\n');
    return `\nLIVE WEB RESULTS — you ran a live web search just now for this query and read the pages; these are fresh external facts:\n${delimitUntrusted(lines, 9000)}\nGround your answer in these results and cite sources inline as (domain.com). You DID perform a live web search — never claim you "cannot search online".\n`;
  }
  if (attempted) {
    return `\nWEB SEARCH: ran a live search for this query but it returned no usable results. Answer from your general knowledge and briefly note the search was thin — do NOT claim you are permanently unable to search the web.\n`;
  }
  return '';
}

// The user pasted URLs / a domain → we fetched those pages NOW. Successes are
// injected as untrusted page text; failures are stated explicitly so the model
// reports the outcome instead of promising "let me check" (it can't act later).
function buildPageReadContext(reads, failedUrls) {
  let out = '';
  if (reads.length) {
    const lines = reads.map((r, i) => `${i + 1}. ${r.url}\n   ${r.content}`).join('\n');
    out += `\nLIVE PAGE READS — you fetched these URLs from the user's message just now; this is their real current content:\n${delimitUntrusted(lines, 9000)}\nGround your answer in this content and cite the domain inline.\n`;
  }
  if (failedUrls.length) {
    out += `\nPAGE FETCH FAILED: you attempted to fetch ${failedUrls.join(', ')} just now and got no usable content (site unreachable, empty, or not public). Say this plainly — do NOT pretend it loaded and do NOT promise to "check it later"; you cannot act between turns. Ask the user for the right URL or the facts directly.\n`;
  }
  return out;
}

// ── Agentic Company-Brain lookup (server-side, workspace-scoped) ──────────────
// Runs a brain query the agent asked for, against THIS workspace's brain. Called
// from the proxy loop — multi-tenant by construction (workspaceId comes from the
// authenticated session, never the prompt), works for every provider, and gives
// even the shared-gateway fleet active brain pull without a per-company gateway.
async function runBrainQuery(db, workspaceId, userId, q) {
  const tool = String(q?.tool || '');
  if (tool === 'context') {
    const { data: ws } = await db.from('workspaces').select('name, context').eq('id', workspaceId).single();
    return { tool, workspace: ws?.name || null, context: ws?.context || {} };
  }
  if (tool === 'hunt') {
    const { data } = await db.from('hunt_findings')
      .select('hunt_mode, severity, pattern, recommendation')
      .eq('workspace_id', workspaceId).eq('resolved', false)
      .order('severity', { ascending: false }).order('created_at', { ascending: false }).limit(15);
    return { tool, findings: data || [] };
  }
  if (tool === 'search') {
    const r = await retrieveDocuments(db, workspaceId, String(q?.q || '').slice(0, 200), userId, 6).catch(() => ({ visible: [] }));
    return { tool, q: q?.q, results: (r.visible || []).map(d => ({ title: d.title, source: d.source, snippet: (d.content || '').slice(0, 600) })) };
  }
  // Agent-initiated web retrieval: the MODEL decides when it needs fresh
  // external info — any topic, no trigger words. Results are also returned to
  // the caller's webIngest (via the `ingest` array) so they compound into the
  // brain's document store.
  if (tool === 'web') {
    const query = String(q?.q || '').slice(0, 200);
    if (!query) return { tool, error: 'q required' };
    const r = await webResearch([query], { count: 5, readPages: 2 }).catch(() => ({ snippets: [] }));
    const results = (r.snippets || []).slice(0, 5).map(s => ({
      title: s.title, url: s.url, content: (s.content || s.description || '').slice(0, 1500),
    }));
    const ingest = results.filter(s => s.url && s.content).map(s => ({ external_id: s.url, doc_type: 'webpage', title: s.title || s.url, content: s.content, url: s.url }));
    return { tool, q: query, results, ingest };
  }
  if (tool === 'read_url') {
    const url = String(q?.url || q?.q || '').slice(0, 500);
    if (!url) return { tool, error: 'url required' };
    const content = await fetchPageText(url, { maxChars: 3500 }).catch(() => null);
    if (!content) return { tool, url, error: 'unreachable, empty, or not public — tell the user plainly' };
    return { tool, url, content, ingest: [{ external_id: url, doc_type: 'webpage', title: url, content, url }] };
  }
  return { tool, error: 'unknown tool' };
}

// Fire-and-forget: warm this user's company Hermes gateway so the first real
// message doesn't pay the scale-to-zero cold start. Best-effort; the cloud
// fallback still covers any miss. Triggered on chat open (history GET).
async function prewarmHermes(db, userId) {
  try {
    const { data: profile } = await db.from('profiles').select('workspace_id').eq('id', userId).single();
    if (!profile?.workspace_id) return;
    const { data: keys } = await db.from('workspace_api_keys')
      .select('endpoint').eq('workspace_id', profile.workspace_id).eq('provider', 'hermes').limit(1);
    // Keyless workspaces run on the SHARED Hermes gateway (the platform
    // default daemon) — prewarm that one for them.
    const ep = keys?.[0]?.endpoint || process.env.HERMES_SHARED_GATEWAY_URL;
    if (!ep) return;
    fetch(ep.replace(/\/$/, ''), { method: 'GET', signal: AbortSignal.timeout(3000) }).catch(() => {});
  } catch { /* prewarm is best-effort */ }
}

// ── GET: chat history ─────────────────────────────────────────────────────────
async function handleHistory(req, res) {
  const user = await requireAuth(req, res);
  if (!user) return;
  const db = adminClient();
  prewarmHermes(db, user.id); // fire-and-forget: warm the gateway while history loads
  const { data: rows, error } = await db
    .from('daemon_messages')
    .select('id, role, content, created_at')
    .eq('user_id', user.id)
    .order('created_at', { ascending: false })
    .limit(60);
  if (error) return res.status(500).json({ error: 'Failed to load history' });
  return res.status(200).json({ messages: (rows || []).reverse() });
}

// ── POST: rate a daemon answer (self-improvement feedback signal) ─────────────
// The daemon learns its owner's preferences from these signals: distillDaemonInsights
// turns repeated 👎/edits into durable style corrections injected on the next turn.
async function handleFeedback(req, res, user) {
  const db = adminClient();
  if (!(await enforceRateLimit(res, { key: `chat-fb:${user.id}`, max: 120, windowSec: 60 }))) return;
  const body = parseBody(res, req.body, {
    action:    { type: 'string', max: 16 },
    messageId: { type: 'string', max: 64, required: true },
    signal:    { type: 'string', max: 16, required: true },
    note:      { type: 'string', max: 500 },
  });
  if (!body) return;
  if (!['up', 'down', 'edited', 'redo'].includes(body.signal)) {
    return res.status(400).json({ error: 'signal must be up|down|edited|redo' });
  }
  // Resolve the target message. Live answers have no client-side id yet, so the
  // UI sends 'latest' → the user's most recent daemon answer. Otherwise authz the id.
  let msg;
  if (body.messageId === 'latest') {
    ({ data: msg } = await db.from('daemon_messages')
      .select('id').eq('user_id', user.id).eq('role', 'daemon')
      .order('created_at', { ascending: false }).limit(1).maybeSingle());
  } else {
    ({ data: msg } = await db.from('daemon_messages')
      .select('id').eq('id', body.messageId).eq('user_id', user.id).maybeSingle());
  }
  if (!msg) return res.status(404).json({ error: 'Message not found' });
  const { data: profile } = await db.from('profiles').select('workspace_id, role, title').eq('id', user.id).single();
  await recordSignal(db, {
    workspaceId: profile?.workspace_id || null, domain: 'daemon', subjectType: 'daemon_message',
    subjectId: msg.id, signal: body.signal,
    meta: { user_id: user.id, role: profile?.role || profile?.title || null, note: body.note || null },
  });
  return res.status(200).json({ ok: true });
}

// ── POST: main chat handler ───────────────────────────────────────────────────
export default async function handler(req, res) {
  if (req.method === 'GET') return handleHistory(req, res);
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const user = await requireAuth(req, res);
  if (!user) return;

  // Feedback signals share this endpoint (stays under Vercel's 12-fn cap).
  if (req.body?.action === 'feedback') return handleFeedback(req, res, user);

  // Rate limit first (cheap reject), then strictly validate the body shape.
  if (!(await enforceRateLimit(res, { key: `chat:${user.id}`, max: 60, windowSec: 60 }))) return;

  // Cap is a generous upper bound (the client may post a long visible history;
  // the handler only uses the last message + server-side DB history) — high
  // enough never to break real sessions, low enough to reject abusive payloads.
  const body = parseBody(res, req.body, {
    messages: { type: 'array', required: true, min: 1, max: 1000, items: { type: 'object' } },
    stream:   { type: 'boolean' },
  });
  if (!body) return;
  const messages = body.messages;

  // ── Streaming (opt-in, fully additive) ──────────────────────────────────────
  // When the client sends stream:true, the response is NDJSON events:
  //   {type:"status",label}  what the daemon is doing right now
  //   {type:"reset"}         discard streamed content (a better attempt follows)
  //   {type:"delta",md}      live fragment of the current text block
  //   {type:"block",block}   a completed structured block
  //   {type:"final",payload} the AUTHORITATIVE envelope — parsed by the exact
  //                          same parseJsonResponse as the non-streaming path,
  //                          so final quality is identical; only liveness changes.
  // Without stream:true, behavior is byte-for-byte the previous JSON response.
  const wantsStream = body.stream === true;
  let streamStarted = false;
  const emit = (ev) => {
    if (!wantsStream) return;
    if (!streamStarted) {
      streamStarted = true;
      res.writeHead(200, {
        'Content-Type': 'application/x-ndjson; charset=utf-8',
        'Cache-Control': 'no-cache, no-transform',
        'X-Accel-Buffering': 'no',
      });
    }
    res.write(JSON.stringify(ev) + '\n');
  };

  const db = adminClient();

  // Resolve user + workspace context
  const { data: profile } = await db
    .from('profiles')
    .select('workspace_id, name, title, role, permission_level, daemon_name, context_brief, workspaces(name, industry, size, context)')
    .eq('id', user.id)
    .single();

  // Use workspace_id from profile FK; if null fall back to workspace_members
  // (same self-heal as /api/auth/me — guards against the FK not being written yet).
  let workspaceId = profile?.workspace_id ?? null;
  if (!workspaceId) {
    const { data: member } = await db
      .from('workspace_members')
      .select('workspace_id')
      .eq('user_id', user.id)
      .limit(1)
      .single();
    if (member?.workspace_id) {
      workspaceId = member.workspace_id;
      // Back-fill so next request is fast.
      db.from('profiles').update({ workspace_id: workspaceId }).eq('id', user.id).then(() => {});
    }
  }

  // The latest message comes straight from the request body — normalize it BEFORE
  // the context fan-out so retrieval (docs, skills, web) can use it concurrently.
  const newMsg = messages[messages.length - 1];
  const newMsgNormalized = newMsg
    ? {
        role: newMsg.role === 'user' ? 'user' : 'assistant',
        // Cap content length to bound payload/cost; the message stays in USER
        // position (never the system prompt), so it can't override instructions.
        content: String(newMsg.content || newMsg.text || '').slice(0, 8000),
      }
    : null;
  const isUserTurn = newMsgNormalized?.role === 'user';
  const wsObj = Array.isArray(profile?.workspaces) ? profile.workspaces[0] : profile?.workspaces;

  // ── ONE concurrent context fan-out ──────────────────────────────────────────
  // Everything the prompt needs is independent once the profile row is loaded, so
  // it ALL runs in a single Promise.all: per-user context, company intelligence,
  // learning, skills, goals, org graph, document retrieval, cross-daemon events,
  // provider-key resolution AND live web work. The old shape ran ~8 sequential
  // phases (each a 100ms–3s round-trip); pre-LLM latency now equals the single
  // slowest item instead of the sum.
  const webIngest = []; // { external_id, title, content, url } → workspace_documents

  // Cross-daemon events: assignments, capacity flags, acceptances, broadcasts and
  // availability signals from OTHER staff's daemons that this user hasn't resolved
  // yet — surfaced at the top of the daemon's next reply
  // (workdaemon-cross-daemon-communication.md — "queues it at the top of their
  // next context").
  const fetchDaemonEvents = async () => {
    if (!workspaceId) return '';
    const { data: events } = await db
      .from('daemon_events')
      .select('type, payload, from_user_id, created_at')
      .eq('workspace_id', workspaceId)
      .eq('status', 'pending')
      .or(`to_user_id.eq.${user.id},to_user_id.is.null`)
      .neq('from_user_id', user.id)
      .order('created_at', { ascending: false })
      .limit(8);
    if (!events?.length) return '';
    const senderIds = [...new Set(events.map(e => e.from_user_id).filter(Boolean))];
    const { data: senders } = senderIds.length
      ? await db.from('profiles').select('id, name, title').in('id', senderIds)
      : { data: [] };
    const nameOf = Object.fromEntries((senders || []).map(s => [s.id, s.name || s.title || 'A teammate']));
    const lines = events.map(e => {
      const p = e.payload || {};
      const who = p.source === 'brain' ? 'The Company Brain' : (nameOf[e.from_user_id] || 'A teammate');
      if (e.type === 'assignment') return `• ${who} assigned you "${p.title}" (${p.priority || 'P2'}).${p.brief ? ' Brief: ' + p.brief : ''}`;
      if (e.type === 'flag')       return `• ${who}'s daemon flagged a capacity risk on "${p.title}": ${p.reason}${p.suggestion ? ' — suggests: ' + p.suggestion : ''}`;
      if (e.type === 'accepted')   return `• ${who}'s daemon accepted "${p.title}".`;
      if (e.type === 'broadcast')  return `• Company broadcast from ${who}: ${p.message}`;
      if (e.type === 'availability') return `• ${who} is now ${p.availability}${p.reason ? ' (' + p.reason + ')' : ''}.`;
      return `• ${who}: ${e.type}`;
    });
    return `\nCROSS-DAEMON EVENTS (other staff's daemons signalled YOUR daemon — surface the important ones near the top of your reply with the recommended next step; for an assignment, offer to accept or flag a capacity risk; for a capacity flag, offer options like extend/reassign/reduce scope):\n${delimitUntrusted(lines.join('\n'), 3000)}\n`;
  };

  // Workspace AI key (BYOK) — resolved concurrently with the rest of the fan-out.
  const fetchKeyRow = async () => {
    if (!workspaceId) return null;
    const { data: keys } = await db
      .from('workspace_api_keys')
      .select('provider, api_key, endpoint, model, use_case')
      .eq('workspace_id', workspaceId)
      .order('created_at');
    const row = keys?.find(k => k.use_case === 'reasoning')
             ?? keys?.find(k => k.use_case === 'default')
             ?? keys?.[0]
             ?? null;
    if (row) return row;
    const { data: ws } = await db
      .from('workspaces')
      .select('openrouter_key, openrouter_model')
      .eq('id', workspaceId)
      .single();
    return ws?.openrouter_key ? { provider: 'openrouter', api_key: ws.openrouter_key, model: ws.openrouter_model } : null;
  };

  // Live web work for this turn (page reads for pasted URLs + trigger-worded
  // search). It's the slowest pre-LLM item, so it overlaps every DB read here.
  // Beyond these fast paths the MODEL pulls the web itself via brain_queries —
  // intent, not keywords, is the real trigger. Everything retrieved is queued
  // for ingestion so knowledge compounds instead of evaporating per-turn.
  const runWebWork = async () => {
    if (!isUserTurn) return '';
    let out = '';
    const urls = extractUrls(newMsgNormalized.content, 3);
    const [pageReads, search] = await Promise.all([
      urls.length
        ? Promise.all(urls.map(u => fetchPageText(u, { maxChars: 3500 }).catch(() => null)))
        : Promise.resolve([]),
      wantsWebSearch(newMsgNormalized.content)
        ? runWebSearch(newMsgNormalized.content, {
            wsName: wsObj?.name, wsIndustry: wsObj?.industry, companyDesc: wsObj?.context?.description,
          }).catch(e => { console.warn('[chat] web search failed:', e.message); return null; })
        : Promise.resolve(null),
    ]);
    if (urls.length) {
      const reads = urls.map((u, i) => ({ url: u, content: pageReads[i] }));
      const ok = reads.filter(r => r.content);
      const failed = reads.filter(r => !r.content).map(r => r.url);
      out += buildPageReadContext(ok, failed);
      for (const r of ok) webIngest.push({ external_id: r.url, doc_type: 'webpage', title: r.url, content: r.content, url: r.url });
      console.log('[chat] page reads ok=%d failed=%d', ok.length, failed.length);
    }
    if (search) {
      out += buildWebContext(search, { attempted: true });
      for (const s of (search.snippets || [])) {
        if (s.url && s.content) webIngest.push({ external_id: s.url, doc_type: 'webpage', title: s.title || s.url, content: s.content, url: s.url });
      }
      console.log('[chat] web search grounded=%s snippets=%d', !!search.grounded, search.snippets?.length || 0);
    }
    return out;
  };

  const [
    agentProfileRes, memoriesRes, huntFindingsRes, integRes, dbHistoryRes,
    patternsRes, slackRes, daemonEventsContext, graphCtxRes, docsRes,
    learningContext, pickedSkills, goalBook, keyRowFromDb, webContext,
  ] = await Promise.all([
    db.from('app_agent_profiles')
      .select('access_level, trust_score, interaction_count, permitted_tools')
      .eq('user_id', user.id).single(),
    db.from('daemon_memory')
      .select('key, value, memory_type')
      .eq('user_id', user.id).order('updated_at', { ascending: false }).limit(40),
    workspaceId
      ? db.from('hunt_findings')
          .select('hunt_mode, pattern, severity, recommendation, occurrences, affected_roles, draft')
          .eq('workspace_id', workspaceId).eq('resolved', false)
          .order('severity', { ascending: false }).limit(12)
      : Promise.resolve({ data: [] }),
    workspaceId
      ? db.from('workspace_integrations').select('provider, status').eq('workspace_id', workspaceId)
      : Promise.resolve({ data: [] }),
    db.from('daemon_messages')
      .select('role, content')
      .eq('user_id', user.id).order('created_at', { ascending: false }).limit(30),
    // Cross-staff patterns — fetched optimistically; only injected for executives.
    workspaceId
      ? db.from('app_detected_patterns')
          .select('pattern_type, title, detail, confidence')
          .eq('workspace_id', workspaceId).eq('status', 'open')
          .order('confidence', { ascending: false }).limit(6)
      : Promise.resolve({ data: [] }),
    // Recent Slack activity — fetched optimistically; only injected when Slack is connected.
    workspaceId
      ? db.from('slack_messages')
          .select('channel_name, text, created_at')
          .eq('workspace_id', workspaceId)
          .order('created_at', { ascending: false }).limit(40)
      : Promise.resolve({ data: [] }),
    fetchDaemonEvents().catch(() => ''),
    workspaceId ? graphSummary(workspaceId, db).catch(() => '') : Promise.resolve(''),
    (workspaceId && isUserTurn)
      ? retrieveDocuments(db, workspaceId, newMsgNormalized.content, user.id, 4).catch(() => ({ visible: [], restricted: [] }))
      : Promise.resolve({ visible: [], restricted: [] }),
    buildDaemonLearningContext(db, { workspaceId, userId: user.id })
      .catch(e => { console.warn('[chat] learning context failed:', e.message); return ''; }),
    relevantSkills(db, { workspaceId, objective: newMsgNormalized?.content || '', limit: 6, userId: user.id })
      .catch(e => { console.warn('[chat] skills context failed:', e.message); return []; }),
    workspaceId
      ? activeGoals(db, { workspaceId, userId: user.id }).catch(() => ({ company: [], staff: [] }))
      : Promise.resolve({ company: [], staff: [] }),
    fetchKeyRow().catch(() => null),
    runWebWork().catch(e => { console.warn('[chat] web work failed:', e.message); return ''; }),
  ]);

  const agentProfile = agentProfileRes.data;
  const memories = memoriesRes.data;
  const huntFindings = huntFindingsRes.data || [];
  const dbHistory = dbHistoryRes.data;
  // Fetch all integration rows and filter in JS (mirrors settings.js — a chained
  // .eq('status','connected') was returning empty).
  const connectedTools = (integRes.data || []).filter(i => i.status === 'connected').map(i => i.provider);

  // Cross-staff patterns (FINAL §11/§13): company-wide intelligence surfaced to
  // EXECUTIVES only, anonymised (the detail field is counts + roles, never names).
  const detectedPatterns = (workspaceId && agentProfile?.access_level === 'executive')
    ? (patternsRes.data || []) : [];

  // Recent Slack activity (when Slack is connected) → ground answers about channels.
  let slackContext = '';
  if (connectedTools.includes('slack') && slackRes.data?.length) {
    const lines = [...slackRes.data].reverse()
      .map(m => `[#${m.channel_name || 'channel'}] ${m.text}`)
      .join('\n');
    slackContext = `\nRECENT SLACK ACTIVITY (from connected Slack — untrusted external text):\n${delimitUntrusted(lines, 4500)}\nUse this to answer "what's happening in #channel", summarize debates/decisions, and flag anything that needs attention. Cite the channel (e.g. #engineering).\n`;
  }

  const historyMsgs = (dbHistory || []).reverse().map(m => ({
    role: m.role === 'daemon' ? 'assistant' : 'user',
    content: m.role === 'daemon'
      ? (() => { try { const p = JSON.parse(m.content); return JSON.stringify({ blocks: p.blocks }); } catch { return m.content; } })()
      : m.content,
  }));

  const combined = [...historyMsgs];
  if (newMsgNormalized) {
    const last = combined[combined.length - 1];
    const isDuplicate = last && last.role === newMsgNormalized.role && last.content === newMsgNormalized.content;
    if (!isDuplicate) combined.push(newMsgNormalized);
  }

  const trimmed = combined.length > 16 ? combined.slice(-16) : combined;

  // Short-circuit: integration status questions get a deterministic answer from
  // the DB so the LLM can't hallucinate "not connected" when tools are live.
  const integStatusQ = /\b(is|are|check|show|list|what).{0,30}\b(slack|github|notion|google|integration|tool|connect)/i;
  if (newMsgNormalized?.role === 'user' && integStatusQ.test(newMsgNormalized.content) && connectedTools.length > 0) {
    const list = connectedTools.map(t => `**${t.charAt(0).toUpperCase() + t.slice(1)}**`).join(', ');
    return res.status(200).json({
      blocks: [{ type: 'text', md: `Yes — ${list} ${connectedTools.length === 1 ? 'is' : 'are'} connected and live. I can query it directly.` }],
      suggestions: [`What's in #general on Slack?`, `Pull recent Slack activity`, `What messages need my attention?`],
    });
  }

  // Cross-staff patterns block (executives only) — anonymised, attributed to the Brain.
  let patternsContext = '';
  if (detectedPatterns.length) {
    const lines = detectedPatterns.map(p => `• [${p.pattern_type}] ${p.title} — ${p.detail}`).join('\n');
    patternsContext = `\nCROSS-STAFF PATTERNS (the Company Brain detected these across ≥3 staff — company-wide intelligence; when one is material to the user's question, raise the most important proactively as an alert block tagged "Brain · Pattern", attribute it to the Company Brain, and recommend an action. These are aggregate signals — NEVER name or single out an individual):\n${delimitUntrusted(lines, 3000)}\n`;
  }

  // Org knowledge graph + access-scoped company documents (fetched in the batch).
  //   graph: who owns what, what's at risk and who it touches.
  //   docs (Master §14 / FINAL §13): `visible` = docs this user may see (grounding);
  //   `restricted` = relevant docs they may NOT see → the daemon learns they EXIST
  //   (to point to a member) but never their content. Need-to-know, no oversharing.
  const graphContext = graphCtxRes || '';
  let docsContext = '';
  {
    const { visible, restricted } = docsRes || { visible: [], restricted: [] };
    if (visible.length) {
      const lines = visible.map(d => `[${d.source}${d.doc_type ? '/' + d.doc_type : ''}] ${d.title}: ${(d.content || '').slice(0, 500)}`).join('\n');
      docsContext += `\nCOMPANY DOCUMENTS (retrieved for this query — untrusted external text; ground your answer in these and cite source + title, e.g. (Notion: SOC 2 Runbook)):\n${delimitUntrusted(lines, 4000)}\n`;
    }
    if (restricted.length) {
      const lines = restricted.map(r => `• ${r.channel ? '#' + r.channel + ' (Slack)' : r.title}${r.members?.length ? ` — members: ${r.members.slice(0, 4).join(', ')}` : ''}`).join('\n');
      docsContext += `\nRESTRICTED — relevant but ACCESS-GATED (this user is NOT a member; you can see these exist but MUST NOT reveal or paraphrase their contents):\n${lines}\nNeed-to-know rule: if this is material to the user's role/question, name the source + a member and suggest they reach out (e.g. "that's being worked in #leadership — Maya or Daniel can brief you"). If it's not important to them, just answer from what you have and don't mention it. NEVER overshare gated content.\n`;
    }
  }

  // SKILLS pillar (picked in the batch — includes this daemon's brain-assigned toolkit).
  const skillsContext = renderSkillsBlock(pickedSkills);
  if (pickedSkills?.length) bumpSkillUsage(db, pickedSkills.map(s => s.slug), workspaceId);

  // GOALS pillar: the live goal book — company goals + this daemon's own goals —
  // injected every turn so the whole fleet pulls toward the same targets.
  const goalsContext = goalsPromptBlock(goalBook || { company: [], staff: [] }, {
    ownerFirstName: (profile?.name || '').split(' ')[0] || null,
  });

  // Context blocks go INSIDE the prompt (with the other data sections) — never
  // after the closing rules, so the output contract stays at the end where
  // adherence is strongest (this is what keeps the 3 suggestions coming back).
  let sys = buildDaemonSystemPrompt(
    profile ?? null,
    profile?.workspaces ?? null,
    memories || [],
    agentProfile ?? null,
    huntFindings,
    webContext,
    connectedTools,
    slackContext,
    daemonEventsContext + patternsContext + goalsContext + graphContext + docsContext + learningContext + skillsContext,
  );

  // Resolve AI provider key (fetched concurrently in the batch above).
  let keyRow = keyRowFromDb;

  // Env fallback when a workspace has no key of its own — mirrors resolveLLM:
  // DeepSeek first (the intended brain + already set in prod), then Anthropic,
  // then OpenAI. This is what makes a brand-new workspace's daemon work
  // out-of-the-box instead of 503-ing until an admin adds a key.
  if (!keyRow) {
    // AUTO-ONBOARD: the shared Hermes gateway is the platform default daemon, so
    // every company without an explicit key (all current + future signups) runs on
    // a brain-connected Hermes agent automatically — no per-company deploy or DB
    // row. The brain reaches it via the per-workspace context injected into `sys`;
    // the cloud fallback below covers any gateway hiccup. Dedicated keys (Cobalt)
    // override this.
    if (process.env.HERMES_SHARED_GATEWAY_URL && process.env.HERMES_SHARED_API_KEY) {
      keyRow = {
        provider: 'hermes',
        endpoint: process.env.HERMES_SHARED_GATEWAY_URL,
        api_key:  process.env.HERMES_SHARED_API_KEY,
        model:    'hermes-agent',
      };
    } else if (process.env.DEEPSEEK_API_KEY) {
      keyRow = {
        provider: 'deepseek',
        api_key:  process.env.DEEPSEEK_API_KEY,
        endpoint: process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com',
        model:    'deepseek-chat',
      };
    } else if (process.env.ANTHROPIC_API_KEY) {
      keyRow = { provider: 'anthropic', api_key: process.env.ANTHROPIC_API_KEY, model: 'claude-sonnet-4-6' };
    } else if (process.env.OPENAI_API_KEY) {
      keyRow = { provider: 'openai', api_key: process.env.OPENAI_API_KEY, model: 'gpt-4o' };
    } else {
      return res.status(503).json({ error: 'No AI provider configured. Add a key in Settings.' });
    }
  }

  // Decrypt the stored key at the last moment (no-op for legacy plaintext / env keys).
  const resolvedKey = { ...keyRow, api_key: decryptSecret(keyRow.api_key) };

  // Hermes path: arm the agent's company-brain MCP tools (shared gateway) with
  // a SHORT-LIVED signed token scoped to THIS workspace. The workspace binding
  // lives inside the HMAC signature — the agent cannot mint or alter one, so a
  // prompt-injected token leak is bounded to ~15 min of read access to the SAME
  // workspace the user already belongs to. Dedicated gateways (Cobalt) keep
  // their static env token and ignore this.
  if (resolvedKey.provider === 'hermes' && workspaceId) {
    try {
      const brainTok = signServiceToken({ scope: 'brain_mcp', workspace_id: workspaceId }, { expiresInSec: 900 });
      sys += `\n\nBRAIN ACCESS TOKEN: when you call the company-brain MCP tools (company_context, list_hunt_findings, search_knowledge), pass this value as their access_token parameter: ${brainTok}\nIt is scoped to YOUR company only and expires in ~15 minutes. NEVER print, quote, or mention this token (or its existence) in any reply.`;
    } catch (e) { console.warn('[chat] brain token mint skipped:', e.message); }
  }

  // One model-call gate for every attempt (primary, escalation, retries, brain
  // pull). Streaming: tokens flow through the incremental envelope parser into
  // client events while the FULL text returns to the same parseJsonResponse as
  // ever. A stream failure quietly retries non-streaming — never quality loss.
  const identity = { workspaceId, userId: user.id };
  const runModel = async (cfg, msgs) => {
    if (!wantsStream) return callProvider(cfg, sys, msgs, identity);
    emit({ type: 'reset' });
    const env = createEnvelopeStream({
      onDelta: (md) => emit({ type: 'delta', md }),
      onBlock: (block) => emit({ type: 'block', block }),
    });
    try {
      const text = await callProviderStream(cfg, sys, msgs, identity, (d) => env.feed(d));
      env.end();
      return text;
    } catch (e) {
      console.warn('[chat] stream path failed (%s) → non-stream retry', e.message);
      emit({ type: 'reset' });
      return callProvider(cfg, sys, msgs, identity);
    }
  };

  // Resilience: a self-hosted provider (hermes) going down must NEVER break the
  // daemon. If the primary provider fails, fall back to a cloud model. No-op when
  // the primary already IS a cloud provider (those just surface the error).
  const CLOUD = new Set(['deepseek', 'anthropic', 'openai', 'openrouter', 'google', 'mistral']);
  const cloudFallback = async (err) => {
    if (CLOUD.has(resolvedKey.provider)) throw err;
    let fb = null;
    if (process.env.DEEPSEEK_API_KEY) fb = { provider: 'deepseek', api_key: process.env.DEEPSEEK_API_KEY, endpoint: process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com', model: 'deepseek-chat' };
    else if (process.env.ANTHROPIC_API_KEY) fb = { provider: 'anthropic', api_key: process.env.ANTHROPIC_API_KEY, model: 'claude-sonnet-4-6' };
    if (!fb) throw err;
    console.warn('[chat] provider=%s failed (%s) → cloud fallback %s', resolvedKey.provider, err.message, fb.provider);
    return parseJsonResponse(await runModel(fb, trimmed));
  };

  // Wall-clock budget for the whole LLM phase. Optional extra hops (escalation,
  // brain-pull) are skipped once we're close to the function's maxDuration (60s)
  // so a slow first answer can't push the turn into a platform 504.
  const phaseDeadline = Date.now() + 50000;
  const budgetLeft = () => phaseDeadline - Date.now();

  try {
    // ── Two-tier brain routing + escalation (spec §10 / ChangeSpec §2b) ────────
    // Route shallow turns to the workspace's fast model, deep/complex turns to a
    // stronger sibling; escalate fast→deep if a fast answer comes back thin.
    // Any error falls back to the workspace's configured model (today's behavior).
    const route = classifyTurn(
      newMsgNormalized?.role === 'user' ? newMsgNormalized.content : '',
      { connectedTools, msgCount: trimmed.length },
    );
    const tiers = pickTierModels(resolvedKey);
    const goDeep = tiers.twoTier && wantsDeep(route);
    let usedModel = goDeep ? tiers.deep : tiers.fast;
    let escalated = false;
    let parsed;
    try {
      parsed = parseJsonResponse(await runModel({ ...resolvedKey, model: usedModel }, trimmed));
      // Escalation gate: a fast-tier answer that came back thin → retry on deep.
      // Skip when the time budget is too tight to afford another full call.
      if (tiers.twoTier && !goDeep && responseIsThin(parsed) && budgetLeft() > LLM_CALL_TIMEOUT_MS) {
        try {
          emit({ type: 'status', label: 'GOING DEEPER…' });
          const deepParsed = parseJsonResponse(await runModel({ ...resolvedKey, model: tiers.deep }, trimmed));
          if (!responseIsThin(deepParsed)) { parsed = deepParsed; usedModel = tiers.deep; escalated = true; }
        } catch { /* keep the fast result */ }
      }
    } catch (e) {
      // Routed model failed → fall back to the workspace's configured model once,
      // then to a cloud provider (so a hermes outage never breaks the daemon).
      if (usedModel !== resolvedKey.model) {
        try {
          parsed = parseJsonResponse(await runModel(resolvedKey, trimmed));
          usedModel = resolvedKey.model;
        } catch (e2) { parsed = await cloudFallback(e2); usedModel = 'cloud-fallback'; }
      } else {
        parsed = await cloudFallback(e); usedModel = 'cloud-fallback';
      }
    }
    console.log('[chat] route depth=%s complexity=%s model=%s escalated=%s',
      route.depth, route.complexity || '-', usedModel, escalated);

    // ── Agentic Company-Brain pull (one hop; all providers; multi-tenant) ──────
    // If the agent asked for deeper brain data via a top-level "brain_queries"
    // array, run them against THIS workspace's brain server-side and call the agent
    // again with the results. This gives every company — including the shared-
    // gateway fleet — active brain pull, without per-company gateways or tokens in
    // the prompt. Bounded to one hop to cap latency.
    if (Array.isArray(parsed?.brain_queries) && parsed.brain_queries.length && usedModel !== 'cloud-fallback' && budgetLeft() > LLM_CALL_TIMEOUT_MS) {
      try {
        const qs = parsed.brain_queries.slice(0, 3);
        const results = [];
        for (const q of qs) {
          const r = await runBrainQuery(db, workspaceId, user.id, q);
          // Web results the agent pulled also compound into the brain's
          // document store; strip the ingest payload from what the model sees.
          if (Array.isArray(r.ingest)) { webIngest.push(...r.ingest); delete r.ingest; }
          results.push(r);
        }
        const followup = [
          ...trimmed,
          { role: 'assistant', content: JSON.stringify({ brain_queries: qs }) },
          { role: 'user', content: `COMPANY BRAIN RESULTS (from your queries — ground your answer in these and cite source + title; never mention this lookup step):\n${delimitUntrusted(JSON.stringify(results), 6000)}\n\nNow give your full answer to my previous message as ONE JSON object — no "brain_queries" this time.` },
        ];
        emit({ type: 'status', label: 'QUERYING THE COMPANY BRAIN…' });
        const followParsed = parseJsonResponse(await runModel({ ...resolvedKey, model: usedModel }, followup));
        if (followParsed?.blocks?.length) { parsed = followParsed; console.log('[chat] brain pull: %d quer(ies) → answered', qs.length); }
      } catch (e) { console.error('[chat] brain pull:', e.message); /* keep the first answer */ }
    }

    // HEAL a model misfire where the entire envelope arrives as an ESCAPED JSON
    // string inside a single text block (Hermes does this occasionally — the UI
    // would render raw JSON). Same recovery the client applies to stored history,
    // now applied to live replies too. The healed inner envelope replaces the
    // wrapper; its suggestions win when present.
    if (parsed?.blocks?.length === 1 && parsed.blocks[0]?.type === 'text'
        && typeof parsed.blocks[0].md === 'string'
        && parsed.blocks[0].md.trimStart().startsWith('{')
        && parsed.blocks[0].md.includes('"blocks"')) {
      const inner = parseJsonResponse(parsed.blocks[0].md);
      const isSameWrapper = inner?.blocks?.length === 1 && inner.blocks[0]?.md === parsed.blocks[0].md;
      if (inner?.blocks?.length && !isSameWrapper) {
        console.log('[chat] healed nested envelope: %d inner block(s)', inner.blocks.length);
        parsed = { ...inner, suggestions: inner.suggestions?.length ? inner.suggestions : parsed.suggestions };
      }
    }

    // CONTEXT-BUTTON GUARANTEE: the suggestion chips are part of the product
    // contract. If a truncated or disobedient model response lost them, synthesize
    // grounded fallbacks from the goal book + open findings so the chat never
    // renders a dead end.
    if (!Array.isArray(parsed.suggestions) || !parsed.suggestions.some(s => typeof s === 'string' && s.trim())) {
      const clip = (s, n) => { s = String(s); if (s.length <= n) return s; const cut = s.slice(0, n); return cut.slice(0, cut.lastIndexOf(' ') > n - 20 ? cut.lastIndexOf(' ') : n) + '…'; };
      const fb = [];
      const g = goalBook?.staff?.[0] || goalBook?.company?.[0];
      if (g?.title) fb.push(`What's the fastest next step on "${clip(g.title, 60)}"?`);
      if (huntFindings[0]?.pattern) fb.push(`Walk me through: ${clip(huntFindings[0].pattern, 70)}`);
      if (connectedTools.includes('slack')) fb.push("What's happening in Slack today?");
      fb.push('What needs my attention today?', 'Show our goal progress');
      parsed.suggestions = [...new Set(fb)].slice(0, 3);
    }

    // Fire-and-forget: persist messages + run learning pipeline
    const persist = async () => {
      try {
        const userText = newMsgNormalized?.content || '';
        // Both session sentinels are ephemeral UI pings: the boot/welcome greeting
        // is regenerated live every load. Persisting them makes the sentinel show
        // up as a user bubble and accumulates duplicate "welcome back" messages.
        const isSessionPing = userText === '[SESSION_START]' || userText === '[SESSION_RESUME]';

        // 1. Save user message
        if (newMsgNormalized?.role === 'user' && !isSessionPing) {
          await db.from('daemon_messages').insert({
            user_id:      user.id,
            workspace_id: workspaceId || null,
            role:         'user',
            content:      userText,
          });
        }

        // 2. Save daemon response (skip for session pings — boot/welcome is ephemeral)
        if (!isSessionPing) {
          const stored = JSON.stringify({ blocks: parsed.blocks, suggestions: parsed.suggestions });
          await db.from('daemon_messages').insert({
            user_id:      user.id,
            workspace_id: workspaceId || null,
            role:         'daemon',
            content:      stored,
          });
        }

        // 3. Upsert memories the daemon decided to store
        if (Array.isArray(parsed.memories) && parsed.memories.length > 0) {
          const validMems = parsed.memories.filter(m => m?.key && m?.value);
          if (validMems.length > 0) {
            const rows = validMems.map(m => ({
              user_id:      user.id,
              workspace_id: workspaceId || null,
              key:          String(m.key).slice(0, 120),
              value:        String(m.value).slice(0, 1000),
              memory_type:  m.type || 'preference',
              updated_at:   new Date().toISOString(),
            }));
            await db.from('daemon_memory').upsert(rows, { onConflict: 'user_id,key' });
          }
        }

        // 3b. Compound web knowledge into the Company Brain: every page this
        // turn read or searched (user-pasted URLs, trigger searches, and the
        // agent's own web/read_url pulls) lands in workspace_documents, so the
        // NEXT question retrieves it from the brain without re-fetching.
        if (workspaceId && webIngest.length) {
          const seen = new Set();
          const docs = webIngest.filter(d => d.external_id && !seen.has(d.external_id) && seen.add(d.external_id));
          try {
            const r = await upsertDocuments(db, workspaceId, 'web', docs);
            console.log('[chat] web ingest: %d page(s) → brain', r.upserted);
          } catch (e) { console.error('[chat] web ingest:', e.message); }
        }

        // 3c. SELF-SEEDING COMPANY BRAIN: when an admin tells the daemon facts
        // about the company (what it builds, customers, stage…), the model
        // emits a company_facts object and we fill the workspace context —
        // the same fields the Brain page's form edits. Only admins can seed,
        // only EMPTY fields are filled (never overwrite admin-entered truth);
        // new notes append. This is how chat onboarding becomes durable,
        // workspace-wide knowledge instead of one user's memory.
        if (workspaceId && parsed.company_facts && typeof parsed.company_facts === 'object' && !Array.isArray(parsed.company_facts)) {
          try {
            const { data: member } = await db.from('workspace_members')
              .select('role').eq('user_id', user.id).eq('workspace_id', workspaceId).single();
            if (member?.role === 'admin') {
              const FIELDS = ['description', 'stage', 'revenue', 'headcount', 'priorities', 'projects', 'metrics', 'customers', 'competitors', 'notes'];
              const { data: wsRow } = await db.from('workspaces').select('context').eq('id', workspaceId).single();
              const ctx = (wsRow?.context && typeof wsRow.context === 'object') ? { ...wsRow.context } : {};
              let changed = 0;
              for (const f of FIELDS) {
                const v = parsed.company_facts[f];
                if (v == null || typeof v === 'object') continue;
                const s = String(v).trim().slice(0, 600);
                if (!s) continue;
                if (!ctx[f] || !String(ctx[f]).trim()) { ctx[f] = s; changed++; }
                else if (f === 'notes' && !String(ctx.notes).includes(s)) { ctx.notes = `${ctx.notes} · ${s}`.slice(0, 1500); changed++; }
              }
              if (changed) {
                await db.from('workspaces').update({ context: ctx }).eq('id', workspaceId);
                console.log('[chat] company_facts: %d field(s) seeded into workspace context', changed);
              }
            }
          } catch (e) { console.error('[chat] company_facts:', e.message); }
        }

        // 3d. FULL TRANSCRIPT → BRAIN (owner directive: ingest everything,
        // select later). Each user's day of conversation rolls up into ONE
        // workspace_document (source 'chat', embedded) — so the Brain can mine
        // it and the user's own daemon gains semantic recall of past chats.
        // Visibility is RESTRICTED to the owner: ingestion is universal, but
        // other staff get pointer-only via retrieveDocuments, and the gateway
        // MCP search tool never returns restricted content at all.
        if (workspaceId && !isSessionPing) {
          try {
            const dayISO = new Date().toISOString().slice(0, 10);
            const { data: todays } = await db.from('daemon_messages')
              .select('role, content')
              .eq('user_id', user.id).gte('created_at', `${dayISO}T00:00:00Z`)
              .order('created_at', { ascending: true }).limit(200);
            const lines = transcriptLines(todays, profile?.name || 'User');
            if (lines.length) {
              await upsertDocuments(db, workspaceId, 'chat', [
                transcriptDoc({ userId: user.id, dayISO, ownerName: profile?.name, lines }),
              ]);
            }
          } catch (e) { console.error('[chat] transcript ingest:', e.message); }
        }

        // 4. Log to brain_interactions (skip session pings)
        if (!isSessionPing && userText && workspaceId) {
          const tags = extractTopicTags(userText);
          const hour = new Date().getHours();
          await db.from('brain_interactions').insert({
            user_id:      user.id,
            workspace_id: workspaceId,
            user_role:    profile?.role || profile?.title || null,
            access_level: agentProfile?.access_level || 'junior',
            // FULL message (owner directive: the Brain ingests everything) —
            // input is already capped at 8K; downstream consumers slice their
            // own samples, so no prompt-blowup risk.
            user_message: userText,
            topic_tags:   tags,
            session_hour: hour,
            message_length: userText.length,
          });

          // 5. Increment interaction_count in agent_profile
          await db.from('app_agent_profiles').upsert({
            user_id:           user.id,
            workspace_id:      workspaceId,
            interaction_count: (agentProfile?.interaction_count || 0) + 1,
            updated_at:        new Date().toISOString(),
          }, { onConflict: 'user_id' });

          // 6. Pattern detection: flag systemic issues (3+ users, same topic, 30 days)
          if (tags.length > 0) {
            const cutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
            for (const tag of tags.slice(0, 3)) {
              const { data: similar } = await db
                .from('brain_interactions')
                .select('user_id')
                .eq('workspace_id', workspaceId)
                .contains('topic_tags', [tag])
                .gte('created_at', cutoff)
                .neq('user_id', user.id)
                .limit(10);

              const uniqueOthers = new Set((similar || []).map(r => r.user_id));
              if (uniqueOthers.size >= 2) {
                // 3+ total users (including current) asking about same topic
                const { data: existingFinding } = await db
                  .from('hunt_findings')
                  .select('id')
                  .eq('workspace_id', workspaceId)
                  .eq('hunt_mode', 'knowledge')
                  .ilike('pattern', `%${tag}%`)
                  .eq('resolved', false)
                  .limit(1);

                if (!existingFinding?.length) {
                  await db.from('hunt_findings').insert({
                    workspace_id:  workspaceId,
                    hunt_mode:     'knowledge',
                    pattern:       `Multiple staff asking about "${tag}"`,
                    occurrences:   uniqueOthers.size + 1,
                    affected_roles: [profile?.role || profile?.title].filter(Boolean),
                    severity:      uniqueOthers.size >= 4 ? 'critical' : 'warning',
                    recommendation: `${uniqueOthers.size + 1} team members queried "${tag}". Consider documenting a clear answer or SOP.`,
                  });
                  console.log('[chat] hunt_finding created: knowledge "%s" occurrences=%d', tag, uniqueOthers.size + 1);
                }
              }
            }
          }
        }
      } catch (e) {
        console.error('[chat] persist error:', e.message);
      }
    };

    // Run persistence in the background WITHOUT delaying the response, but keep
    // the serverless function alive until the writes finish — a bare fire-and-
    // forget gets frozen/dropped after res returns (esp. on slow LLM turns), so
    // history/memories/interactions/agent-profile writes were silently lost.
    waitUntil(persist());

    if (streamStarted) {
      // The final envelope is AUTHORITATIVE — the client reconciles its streamed
      // view against this exact payload (same shape as the JSON response).
      emit({ type: 'final', payload: parsed });
      res.end();
      return;
    }
    return res.status(200).json(parsed);
  } catch (e) {
    console.error('[chat] provider=%s error=%s', keyRow.provider, e.message, e.stack);
    // LEARN (codebase): capture the failure for the weekly improver to cluster.
    recordSignal(db, {
      workspaceId: workspaceId || null, domain: 'codebase', subjectType: 'error', subjectId: 'chat.handler',
      signal: 'error', meta: { where: 'chat.handler', provider: keyRow?.provider, message: e.message, stack: String(e.stack || '').slice(0, 1000) },
    });
    if (streamStarted) {
      try { res.write(JSON.stringify({ type: 'error', error: 'AI request failed. Please try again.' }) + '\n'); res.end(); } catch { /* socket gone */ }
      return;
    }
    return res.status(502).json({ error: 'AI request failed. Please try again.' });
  }
}

// Vercel Node runtime: allow chunked/streamed responses for this function
// (maxDuration continues to come from vercel.json).
export const config = { supportsResponseStreaming: true };
