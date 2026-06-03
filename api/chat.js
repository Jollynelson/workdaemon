import OpenAI from 'openai';
import { requireAuth, adminClient } from './_lib/supabase.js';
import {
  assertSafeUrl, decryptSecret, enforceRateLimit,
  sanitizeForPrompt, delimitUntrusted, UNTRUSTED_DATA_NOTICE, parseBody,
} from './_lib/security.js';
import { braveSearchMany, roleToTags } from './_lib/research.js';
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
  if (!queries.length) return { grounded: false, snippets: [] };
  return braveSearchMany([...new Set(queries)], { count: 6, freshness });
}

// Format fetched results as delimited UNTRUSTED context (web text can carry
// prompt-injection, so it must never sit in instruction position).
function buildWebContext(web, { attempted }) {
  if (web?.snippets?.length) {
    const lines = web.snippets.slice(0, 6).map((s, i) =>
      `${i + 1}. ${s.title || '(untitled)'}${s.age ? ` [${s.age}]` : ''}\n   ${s.description || ''}\n   ${s.url || ''}`
    ).join('\n');
    return `\nLIVE WEB RESULTS — you ran a live web search just now for this query; these are fresh external facts:\n${delimitUntrusted(lines, 5000)}\nGround your answer in these results and cite sources inline as (domain.com). You DID perform a live web search — never claim you "cannot search online".\n`;
  }
  if (attempted) {
    return `\nWEB SEARCH: ran a live search for this query but it returned no usable results. Answer from your general knowledge and briefly note the search was thin — do NOT claim you are permanently unable to search the web.\n`;
  }
  return '';
}

// ── Tool permission map (from agent access_level) ─────────────────────────────
const TOOL_PERMISSIONS = {
  executive: ['Slack', 'Notion', 'Google Drive', 'CRM', 'Finance', 'HR System', 'Market Feeds', 'All Reports', 'Interaction Logs'],
  director:  ['Slack', 'Notion', 'Google Drive', 'CRM', 'Finance', 'HR System', 'Department Reports'],
  manager:   ['Slack', 'Notion', 'Google Drive', 'CRM', 'Team Reports', 'Project Tools'],
  junior:    ['Slack', 'Notion', 'Google Drive', 'Email', 'Assigned Projects'],
};

// ── Topic tag extraction ───────────────────────────────────────────────────────
function extractTopicTags(message) {
  const stop = new Set([
    'the','a','an','is','are','was','were','be','been','have','has','had',
    'do','does','did','will','would','could','should','can','may','might',
    'what','where','when','how','why','who','which','that','this','these',
    'those','for','and','but','or','nor','yet','so','if','while','with',
    'at','by','from','to','in','on','about','just','my','our','your','their',
    'its','we','they','you','he','she','it','i','need','want','help','know',
    'think','tell','make','get','give','show','find','look','feel','seem',
  ]);
  return message
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, ' ')
    .split(/\s+/)
    .map(w => w.trim())
    .filter(w => w.length > 3 && !stop.has(w))
    .slice(0, 8);
}

// ── AI provider dispatcher ────────────────────────────────────────────────────
async function callProvider({ provider, api_key, endpoint, model }, sys, messages) {
  console.log('[chat] provider=%s model=%s', provider, model || '(default)');
  switch (provider) {

    case 'openrouter': {
      const client = new OpenAI({
        baseURL: 'https://openrouter.ai/api/v1',
        apiKey: api_key,
        defaultHeaders: { 'HTTP-Referer': 'https://workdaemon.com', 'X-Title': 'WorkDaemon' },
      });
      const r = await client.chat.completions.create({
        model: model || 'anthropic/claude-sonnet-4-5',
        max_tokens: 4096,
        messages: [{ role: 'system', content: sys }, ...messages],
      });
      const text = r.choices[0]?.message?.content ?? '';
      console.log('[chat] openrouter text_len=%d finish=%s', text.length, r.choices[0]?.finish_reason);
      return text;
    }

    case 'anthropic': {
      const r = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'x-api-key': api_key,
          'anthropic-version': '2023-06-01',
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          model: model || 'claude-sonnet-4-6',
          max_tokens: 4096,
          system: sys,
          messages,
        }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error?.message || 'Anthropic error');
      const textBlock = d.content?.find(b => b.type === 'text');
      console.log('[chat] anthropic stop=%s text_len=%d', d.stop_reason, textBlock?.text?.length ?? 0);
      return textBlock?.text ?? '';
    }

    case 'openai': {
      const client = new OpenAI({ apiKey: api_key });
      const r = await client.chat.completions.create({
        model: model || 'gpt-4o',
        max_tokens: 4096,
        messages: [{ role: 'system', content: sys }, ...messages],
      });
      const text = r.choices[0]?.message?.content ?? '';
      console.log('[chat] openai text_len=%d finish=%s', text.length, r.choices[0]?.finish_reason);
      return text;
    }

    case 'deepseek': {
      const client = new OpenAI({
        baseURL: (endpoint || 'https://api.deepseek.com').replace(/\/$/, ''),
        apiKey: api_key,
      });
      const r = await client.chat.completions.create({
        model: model || 'deepseek-chat',
        max_tokens: 4096,
        messages: [{ role: 'system', content: sys }, ...messages],
      });
      const text = r.choices[0]?.message?.content ?? '';
      console.log('[chat] deepseek text_len=%d finish=%s', text.length, r.choices[0]?.finish_reason);
      return text;
    }

    case 'google': {
      const mdl = model || 'gemini-2.5-flash';
      const r = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${mdl}:generateContent?key=${api_key}`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            systemInstruction: { parts: [{ text: sys }] },
            generationConfig: { thinkingConfig: { thinkingBudget: 0 } },
            contents: messages.map(m => ({
              role: m.role === 'assistant' ? 'model' : 'user',
              parts: [{ text: m.content }],
            })),
          }),
        }
      );
      const d = await r.json();
      if (!r.ok) throw new Error(d.error?.message || 'Google error');
      const parts = d.candidates?.[0]?.content?.parts || [];
      const nonThought = parts.filter(p => p.text && !p.thought).map(p => p.text).join('');
      const text = nonThought || parts.filter(p => p.text).map(p => p.text).join('');
      console.log('[chat] google parts=%d text_len=%d', parts.length, text.length);
      return text;
    }

    case 'mistral': {
      const client = new OpenAI({
        baseURL: 'https://api.mistral.ai/v1',
        apiKey: api_key,
      });
      const r = await client.chat.completions.create({
        model: model || 'mistral-large-latest',
        max_tokens: 4096,
        messages: [{ role: 'system', content: sys }, ...messages],
      });
      return r.choices[0]?.message?.content ?? '';
    }

    case 'ollama': {
      if (!endpoint) throw new Error('Ollama provider requires an endpoint');
      const base = (await assertSafeUrl(endpoint, { allowHttp: true })).replace(/\/$/, '');
      const client = new OpenAI({ baseURL: `${base}/v1`, apiKey: 'ollama' });
      const r = await client.chat.completions.create({
        model: model || 'llama3',
        messages: [{ role: 'system', content: sys }, ...messages],
      });
      return r.choices[0]?.message?.content ?? '';
    }

    case 'azure': {
      if (!endpoint) throw new Error('Azure provider requires an endpoint');
      const base = (await assertSafeUrl(endpoint)).replace(/\/$/, '');
      const client = new OpenAI({
        baseURL: `${base}/openai/deployments/${model}`,
        apiKey: api_key,
        defaultQuery: { 'api-version': '2024-02-15-preview' },
        defaultHeaders: { 'api-key': api_key },
      });
      const r = await client.chat.completions.create({
        model,
        messages: [{ role: 'system', content: sys }, ...messages],
      });
      return r.choices[0]?.message?.content ?? '';
    }

    // Per-company fine-tuned Hermes-3 served on Modal GPU. `endpoint` is the
    // serving FastAPI base URL, `model` carries the company_id to route to.
    // The serving layer (router.chat) handles warm/cold/Claude-fallback itself.
    case 'modal': {
      if (!endpoint) throw new Error('Modal provider requires an endpoint (serving base URL)');
      const base = (await assertSafeUrl(endpoint)).replace(/\/$/, '');
      const r = await fetch(`${base}/api/serve/chat`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          ...(api_key ? { authorization: `Bearer ${api_key}` } : {}),
        },
        body: JSON.stringify({ company_id: model, system_prompt: sys, messages }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.detail || d.error || 'Modal serving error');
      console.log('[chat] modal source=%s model=%s text_len=%d', d.source, d.model, (d.content ?? '').length);
      return d.content ?? '';
    }

    default:
      throw new Error(`Unknown provider: ${provider}`);
  }
}

// ── Context builders ──────────────────────────────────────────────────────────

function buildCompanyContext(ws) {
  const ctx = ws?.context;
  if (!ctx || typeof ctx !== 'object') return '';
  const fields = [
    ['Description',     ctx.description],
    ['Stage',           ctx.stage],
    ['Revenue',         ctx.revenue],
    ['Headcount',       ctx.headcount],
    ['Q priorities',    ctx.priorities],
    ['Active projects', ctx.projects],
    ['Key metrics',     ctx.metrics],
    ['Customers / ICP', ctx.customers],
    ['Competitors',     ctx.competitors],
    ['Notes',           ctx.notes],
  ].filter(([, v]) => v && String(v).trim());
  if (!fields.length) return '';
  // Company context is partly auto-filled from web research → treat as untrusted
  // data and wrap in delimiters so it can't act as an instruction (prompt injection).
  const body = fields.map(([k, v]) => `${k}: ${v}`).join('\n');
  return '\nCOMPANY CONTEXT (admin-verified facts):\n' + delimitUntrusted(body, 4000) + '\n';
}

function buildMemoriesContext(memories) {
  if (!memories?.length) return '';
  // Memories are derived from prior user conversations → untrusted; delimit them.
  const lines = memories
    .map(m => `[${m.memory_type}] ${m.key}: ${m.value}`)
    .join('\n');
  return `\nMEMORIES — apply silently, never announce:\n${delimitUntrusted(lines, 4000)}\n`;
}

function buildHuntContext(findings, userTags = []) {
  if (!findings?.length) return '';
  const isCeo = userTags.includes('ceo'); // founders/CEOs see everything
  const targeted = (f) => {
    const roles = Array.isArray(f.affected_roles) ? f.affected_roles : [];
    return roles.length > 0 && roles.some(r => userTags.includes(r));
  };
  // Surface findings routed to this user (any severity) plus all critical/warning.
  const relevant = findings.filter(f =>
    targeted(f) || isCeo || f.severity === 'critical' || f.severity === 'warning');
  if (!relevant.length) return '';

  // Order: findings routed to this user first, then by severity.
  const sev = { critical: 0, warning: 1, info: 2 };
  relevant.sort((a, b) =>
    (Number(targeted(b)) - Number(targeted(a))) ||
    ((sev[a.severity] ?? 3) - (sev[b.severity] ?? 3)));

  // hunt_mode / severity are enums (trusted); pattern + recommendation contain
  // web-derived and cross-user text → untrusted, so delimit the block. This is a
  // cross-user injection vector, so it must never sit in instruction position.
  let hasDraft = false;
  const lines = relevant.slice(0, 6).map(f => {
    const mark = targeted(f) ? ' ⟵ ROUTED TO YOU' : '';
    let line = `[${f.hunt_mode.toUpperCase()} · ${f.severity.toUpperCase()}]${mark} ${f.pattern}`
      + (f.recommendation ? ` → ${f.recommendation}` : '');
    if (f.draft && targeted(f)) { hasDraft = true; line += `\n   DRAFT READY: ${f.draft}`; }
    return line;
  }).join('\n');

  return `\nBRAIN INTELLIGENCE — findings from the Company Brain (external scans + internal patterns):\n${delimitUntrusted(lines, 5000)}\n`
    + `Findings marked "⟵ ROUTED TO YOU" were directed to your role by the brain. When one is material, proactively raise the most important early in your reply with its recommended action, as an alert block tagged "Brain · …" (it came from the Company Brain, not you).\n`
    + (hasDraft ? `When a finding has a "DRAFT READY", the brain has already drafted the asset for you — present it verbatim in a text block as a ready-to-use draft, then offer (via action_confirm, since this is an outward post) to refine, schedule or publish it. Never send it without explicit confirmation.\n` : '');
}

function buildAgentContext(agentProfile) {
  if (!agentProfile) return '';
  const tools = TOOL_PERMISSIONS[agentProfile.access_level] || TOOL_PERMISSIONS.junior;
  const interactionNote = agentProfile.interaction_count > 0
    ? `You have had ${agentProfile.interaction_count} prior interactions with this user.`
    : 'This is an early interaction with this user — calibrate carefully.';
  const trustNote = agentProfile.trust_score < 0.7
    ? 'Trust signal is low — this user has been ignoring suggestions. Reduce push frequency and ask calibration questions.'
    : agentProfile.trust_score > 1.3
    ? 'Trust signal is high — this user acts on suggestions consistently. Be proactive and direct.'
    : '';
  return `\nAGENT PROFILE:\nAccess level: ${agentProfile.access_level}\nAuthorized tools: ${tools.join(', ')}\n${interactionNote}${trustNote ? '\n' + trustNote : ''}\n`;
}

// ── System prompt builder ─────────────────────────────────────────────────────
function buildDaemonSystemPrompt(profile, workspace, memories, agentProfile, huntFindings, webContext = '', connectedTools = [], slackContext = '') {
  // Identity fields are user-/admin-supplied free text. Sanitize to a single
  // short line each so they cannot smuggle instructions into the system prompt.
  const safeName  = sanitizeForPrompt(profile?.name, 80).replace(/\s+/g, ' ').trim();
  const firstName = safeName ? safeName.split(' ')[0] : null;
  const title     = sanitizeForPrompt(profile?.title || profile?.role, 80).replace(/\s+/g, ' ').trim() || null;
  const permLevel = profile?.permission_level ?? 2;
  const ws        = Array.isArray(workspace) ? workspace[0] : workspace;
  const wsName     = sanitizeForPrompt(ws?.name, 120).replace(/\s+/g, ' ').trim() || null;
  const wsIndustry = sanitizeForPrompt(ws?.industry, 80).replace(/\s+/g, ' ').trim() || null;
  const wsSize     = sanitizeForPrompt(ws?.size, 40).replace(/\s+/g, ' ').trim() || null;
  const accessLevel = agentProfile?.access_level || 'junior';
  const roleLabel = title || 'team member';

  // Current date — without this the model hallucinates a date from its training
  // cutoff (e.g. "May 15, 2024"). Inject a fresh, readable timestamp every turn.
  const now = new Date();
  const todayLong = now.toLocaleDateString('en-US', {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC',
  });
  const todayISO = now.toISOString().slice(0, 10);

  const permLabels = {
    1: 'Copilot (read-only)',
    2: 'Assistant (confirm before act)',
    3: 'Autonomous (execute and report)',
  };

  const tools = TOOL_PERMISSIONS[accessLevel] || TOOL_PERMISSIONS.junior;

  const userTags        = roleToTags(title || profile?.role);
  const companyContext  = buildCompanyContext(ws);
  const memoriesContext = buildMemoriesContext(memories);
  const huntContext     = buildHuntContext(huntFindings, userTags);
  const agentContext    = buildAgentContext(agentProfile);

  return `OUTPUT CONTRACT — ABSOLUTE RULE:
Your response is one JSON object. First character: {. Last character: }. Nothing else exists in your output. No reasoning steps. No planning notes. No constraint checks. No asterisks. No text before or after the JSON. Violating this breaks the interface completely.

{"blocks":[...],"suggestions":["...","...","..."],"memories":[...]}

The "memories" field is OPTIONAL — include it only when you learn something new about the user this turn. When included:
[{"key":"short-kebab-slug","value":"what you learned","type":"preference|pattern|priority|relationship|fact"}]
Never announce memories. Just apply them silently.

CURRENT DATE: Today is ${todayLong} (${todayISO}). Use this whenever asked the date/time or when reasoning about "today", deadlines, or recency. Never state a date from memory.

${connectedTools.length ? `LIVE INTEGRATION STATE (authoritative — overrides anything in conversation history):
CONNECTED RIGHT NOW: ${connectedTools.join(', ')}. These tools ARE fully connected and authenticated. Do NOT say any of them are disconnected, pending, require authentication, or need setup. Never say "Slack is not connected" or any variant when Slack is listed here. The conversation history may be stale — this system prompt is the source of truth.` : ''}

IDENTITY:
You are ${firstName || 'the user'}'s personal work daemon at ${wsName || 'this company'} — a sharp, dedicated agent built around THEIR role, not a generic chatbot. You are NOT the Company Brain: the Company Brain is the separate, company-wide intelligence layer (knowledge graph, cross-user patterns, hunt findings) that YOU draw on. Refer to it in the third person ("the Company Brain flagged…") and attribute insights that come from it. Never call YOURSELF a "brain", an "AI", or a "language model" — you are their daemon.
Owner: ${safeName || 'Unknown'} — ${roleLabel}
Company: ${wsName || 'Unknown'}${wsIndustry ? `, ${wsIndustry}` : ''}${wsSize ? `, ${wsSize}` : ''}
Permission: ${permLevel} — ${permLabels[permLevel] || permLabels[2]}

ROLE-TAILORED MINDSET:
This daemon is tuned for a ${roleLabel}${wsIndustry ? ` in ${wsIndustry}` : ''}. Think and speak the way a great chief-of-staff for a ${roleLabel} would: know what a ${roleLabel} cares about, the metrics they watch, the fires they fight, and the language they use. Lead with that lens in every answer — you already know what this role is about; you don't need to ask.

KNOWLEDGE POLICY — be genuinely useful, not a dead end:
You have broad general knowledge about ${wsIndustry || 'this industry'}, the ${roleLabel} function, best practices, frameworks, and the kinds of topics, themes and trends that move this field. SHARE IT. When asked about news, trends, "what's happening", or anything industry/role-related, give a substantive, confident answer.
WEB SEARCH: You CAN search the live web. When the user asks for news/latest/online info, a search runs automatically and fresh results appear under "LIVE WEB RESULTS" — use and cite them. NEVER say "I cannot perform live online searches" or "I cannot search online"; that is false. Only refuse when the request needs THIS company's private internal data and no tool is connected — and even then, give the general-knowledge version first, then note the tool gap. Forbidden: opening with "I don't have access", "I cannot", or "my function is limited". Never punt the whole answer to a tool connection.

${UNTRUSTED_DATA_NOTICE}
${agentContext}${companyContext}${memoriesContext}${huntContext}${webContext}${slackContext}
BLOCK TYPES — use these schemas exactly:

{"type":"boot","title":"DAEMON BOOT SEQUENCE","lines":[{"label":"Identity","status":"ok","detail":"${safeName || 'User'} · ${title || 'Staff'}"},{"label":"Company Brain","status":"ok","detail":"${wsName || 'Workspace'} · LINKED"},{"label":"Integrations","status":"${connectedTools.length ? 'ok' : 'pending'}","detail":"${connectedTools.length ? connectedTools.join(', ') + ' — live' : 'No tools connected yet'}"},{"label":"Permission","status":"ok","detail":"LEVEL ${permLevel} — ${permLabels[permLevel] || permLabels[2]}"},{"label":"Memory","status":"ok","detail":"${memories?.length ? `${memories.length} memories loaded` : 'Learning your patterns'}"},{"label":"Brain Intelligence","status":"${huntFindings?.length ? 'ok' : 'pending'}","detail":"${huntFindings?.length ? `${huntFindings.length} active findings` : 'No patterns detected yet'}"}]}

{"type":"text","md":"prose **bold** for names/IDs/amounts/deadlines. No bullet dashes. Cite sources inline: (Jira BUG-119), (Slack #eng 15 May)."}

{"type":"stat_grid","stats":[{"label":"Sprint Progress","value":"3","unit":"of 8 tickets","source":"Jira","status":"warn"}]}
status: "ok" (green) | "warn" (amber) | "danger" (red) | "neutral"

{"type":"kanban","columns":[{"title":"Blocked","items":[{"id":"BUG-119","title":"Login fix","assignee":"James","priority":"P0","blockers":"Stale 3 days","due":"15 May"}]}]}
priority: P0 (red) | P1 (amber) | P2 (blue) | P3 (grey)

{"type":"alert","level":"critical","title":"...","content":"...","tag":"Brain · Threat Hunt"}
level: "critical" | "warning" | "info"
TAG ATTRIBUTION — the "tag" field names the SOURCE of the block, so attribute honestly:
• "Brain · …" ONLY when the block surfaces genuine Company-Brain intelligence — hunt findings, cross-user patterns, knowledge-graph facts (e.g. "Brain · Threat Hunt", "Brain · Knowledge Gap"). This signals the insight came from company-wide intelligence, not from you.
• For your OWN output — setup/connect-tool nudges, onboarding, answers from general knowledge — never use "Brain · ". Tag it plainly (e.g. "Setup", "Getting Started") or omit the tag. Tagging your own onboarding chatter "Brain · Setup" is a lie about where it came from.

{"type":"action_confirm","id":"unique-id","title":"Send Slack to James","description":"...","steps":["Step 1","Step 2"],"consequence":"What happens if confirmed."}

{"type":"action_done","summary":"✓ What was done, where, when."}

{"type":"people_list","people":[{"name":"James","role":"Lead Dev","initial":"J","status":"blocked","note":"BUG-119 stale"}]}

{"type":"timeline","events":[{"date":"15 May","title":"Event","body":"detail","source":"Jira","event_type":"decision"}]}

{"type":"progress_bars","items":[{"label":"Q2 Revenue","current":87,"target":100,"unit":"%","status":"warn"}]}

{"type":"chart_bar","title":"Sprint Velocity","keys":["value"],"data":[{"name":"Sprint 22","value":12}]}

{"type":"chart_line","title":"ARR Growth","keys":["value"],"data":[{"name":"Jan","value":1.2}]}

{"type":"invoice_table","columns":["Client","Amount","Status"],"rows":[{"client":"Acme","amount":5000,"status":"overdue"}],"showTotal":true}

BLOCK SELECTION (required):
Session start → boot + text + stat_grid or alert (surface any active hunt findings as alerts)
Metrics/KPIs → stat_grid + chart | Tasks → kanban | Team → people_list
Urgent → alert (critical/warning) | History → timeline | Goals → progress_bars + stat_grid
Action (L2) → action_confirm | Action (L3) → action_done | Financial → invoice_table + stat_grid
General → text + structural block
Open with text (or boot at session start). 2–5 blocks max.

ACCESS LEVEL — ${accessLevel.toUpperCase()}: Authorized tools for this user: ${tools.join(', ')}.
Only reference data from these tools. Never reveal data from unauthorized systems.
${connectedTools.length
  ? `CONNECTED INTEGRATIONS (LIVE — real data available now): ${connectedTools.join(', ')}. These ARE connected; use them confidently and never claim they're unconnected or "not set up".`
  : 'No external tools connected yet — offer to connect them (Integrations page), and meanwhile be useful from general knowledge + web search.'}

PERMISSION: L1=read only | L2=action_confirm then wait | L3=execute then action_done

SESSION START — when message is "[SESSION_START]":
Return: boot block first, then a text block that greets ${firstName || 'the user'} by name with ENERGY and role-flattery. Open with a punchy, genuine hook about why their role matters — e.g. for a Head of People: "HR is the engine room of ${wsName || 'this company'} — the people side is where culture and retention are won. Good to have you, ${firstName || 'there'}." Make ${roleLabel} feel seen and important.
Then, to learn more about them, surface 1–2 current themes or trends shaping the ${roleLabel} world right now (from your general knowledge) and ask which one is live for them — turn the greeting into a way to gather context. Keep it warm, sharp, and short.
${huntFindings?.filter(f => f.severity === 'critical').length > 0
  ? `CRITICAL: Surface ${huntFindings.filter(f => f.severity === 'critical').length} critical finding(s) as alert blocks immediately.`
  : ''}
If there is conversation history: acknowledge it briefly and surface any unresolved threads.
If no tools connected: don't dwell on it — be useful from general knowledge, then offer 3 specific connection actions as upside.

SESSION RESUME — when message is "[SESSION_RESUME]":
Do NOT repeat the boot block. Return ONE short text block: a warm one-line "welcome back, ${firstName || 'there'}". Then look at the conversation history above and pick up the LAST unresolved thread — if the prior user message was a real question (e.g. about their field, a task, a metric), answer it now using your general knowledge, don't just say "welcome back". Reference it specifically. Keep it tight. End with 3 suggestions that continue that thread.

LANGUAGE: Bold names/IDs/deadlines/amounts. Prose not dashes. Cite every fact. Direct, warm, and competent — a sharp chief-of-staff for a ${roleLabel}.
Never: "As an AI", "I don't have access", "I'm just a demo", "I am a brain", "I cannot search online", visible reasoning.
End with exactly 3 specific actionable suggestions tuned to a ${roleLabel}.`;
}

// ── Response parser ───────────────────────────────────────────────────────────
function parseJsonResponse(text) {
  if (!text) return { blocks: [{ type: 'text', md: 'No response.' }], suggestions: [] };

  let t = text.replace(/<thinking>[\s\S]*?<\/thinking>/gi, '').trim();

  try { const p = JSON.parse(t); if (p.blocks) return p; } catch {}

  const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) { try { const p = JSON.parse(fence[1].trim()); if (p.blocks) return p; } catch {} }

  let depth = 0, start = -1;
  for (let i = 0; i < t.length; i++) {
    if (t[i] === '{') { if (depth === 0) start = i; depth++; }
    else if (t[i] === '}') {
      depth--;
      if (depth === 0 && start !== -1) {
        try { const p = JSON.parse(t.slice(start, i + 1)); if (p.blocks) return p; } catch {}
        start = -1;
      }
    }
  }

  return { blocks: [{ type: 'text', md: text }], suggestions: [] };
}

// ── GET: chat history ─────────────────────────────────────────────────────────
async function handleHistory(req, res) {
  const user = await requireAuth(req, res);
  if (!user) return;
  const db = adminClient();
  const { data: rows, error } = await db
    .from('daemon_messages')
    .select('id, role, content, created_at')
    .eq('user_id', user.id)
    .order('created_at', { ascending: false })
    .limit(60);
  if (error) return res.status(500).json({ error: 'Failed to load history' });
  return res.status(200).json({ messages: (rows || []).reverse() });
}

// ── POST: main chat handler ───────────────────────────────────────────────────
export default async function handler(req, res) {
  if (req.method === 'GET') return handleHistory(req, res);
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const user = await requireAuth(req, res);
  if (!user) return;

  // Rate limit first (cheap reject), then strictly validate the body shape.
  if (!(await enforceRateLimit(res, { key: `chat:${user.id}`, max: 60, windowSec: 60 }))) return;

  // Cap is a generous upper bound (the client may post a long visible history;
  // the handler only uses the last message + server-side DB history) — high
  // enough never to break real sessions, low enough to reject abusive payloads.
  const body = parseBody(res, req.body, {
    messages: { type: 'array', required: true, min: 1, max: 1000, items: { type: 'object' } },
  });
  if (!body) return;
  const messages = body.messages;

  const db = adminClient();

  // Resolve user + workspace context
  const { data: profile } = await db
    .from('profiles')
    .select('workspace_id, name, title, role, permission_level, workspaces(name, industry, size, context)')
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

  // Load agent profile (access level, trust score, interaction count)
  const { data: agentProfile } = await db
    .from('app_agent_profiles')
    .select('access_level, trust_score, interaction_count, permitted_tools')
    .eq('user_id', user.id)
    .single();

  // Load stored memories
  const { data: memories } = await db
    .from('daemon_memory')
    .select('key, value, memory_type')
    .eq('user_id', user.id)
    .order('updated_at', { ascending: false })
    .limit(40);

  // Load recent hunt findings to inject into system prompt
  let huntFindings = [];
  if (workspaceId) {
    const { data: findings } = await db
      .from('hunt_findings')
      .select('hunt_mode, pattern, severity, recommendation, occurrences, affected_roles, draft')
      .eq('workspace_id', workspaceId)
      .eq('resolved', false)
      .order('severity', { ascending: false })
      .limit(12);
    huntFindings = findings || [];
  }

  // Connected integrations → tell the daemon which tools are actually live.
  // Fetch all rows for the workspace and filter in JS (mirrors settings.js approach
  // which is known to work; chained .eq('status','connected') was returning empty).
  let connectedTools = [];
  if (workspaceId) {
    const { data: integ } = await db
      .from('workspace_integrations')
      .select('provider, status')
      .eq('workspace_id', workspaceId);
    connectedTools = (integ || []).filter(i => i.status === 'connected').map(i => i.provider);
  }

  // Recent Slack activity (when Slack is connected) → ground answers about
  // channels and surface what's happening across the company's conversations.
  let slackContext = '';
  if (workspaceId && connectedTools.includes('slack')) {
    const { data: msgs } = await db
      .from('slack_messages')
      .select('channel_name, text, created_at')
      .eq('workspace_id', workspaceId)
      .order('created_at', { ascending: false })
      .limit(40);
    if (msgs?.length) {
      const lines = msgs.reverse()
        .map(m => `[#${m.channel_name || 'channel'}] ${m.text}`)
        .join('\n');
      slackContext = `\nRECENT SLACK ACTIVITY (from connected Slack — untrusted external text):\n${delimitUntrusted(lines, 4500)}\nUse this to answer "what's happening in #channel", summarize debates/decisions, and flag anything that needs attention. Cite the channel (e.g. #engineering).\n`;
    }
  }

  // Load recent DB history for persistent context
  const { data: dbHistory } = await db
    .from('daemon_messages')
    .select('role, content')
    .eq('user_id', user.id)
    .order('created_at', { ascending: false })
    .limit(30);

  const historyMsgs = (dbHistory || []).reverse().map(m => ({
    role: m.role === 'daemon' ? 'assistant' : 'user',
    content: m.role === 'daemon'
      ? (() => { try { const p = JSON.parse(m.content); return JSON.stringify({ blocks: p.blocks }); } catch { return m.content; } })()
      : m.content,
  }));

  const newMsg = messages[messages.length - 1];
  const newMsgNormalized = newMsg
    ? {
        role: newMsg.role === 'user' ? 'user' : 'assistant',
        // Cap content length to bound payload/cost; the message stays in USER
        // position (never the system prompt), so it can't override instructions.
        content: String(newMsg.content || newMsg.text || '').slice(0, 8000),
      }
    : null;

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

  // Live web search: when the latest user message asks for fresh/external info,
  // fetch results now and ground the answer in them (retrieval augmentation).
  let webContext = '';
  if (newMsgNormalized?.role === 'user' && wantsWebSearch(newMsgNormalized.content)) {
    try {
      const wsObj = Array.isArray(profile?.workspaces) ? profile.workspaces[0] : profile?.workspaces;
      const web = await runWebSearch(newMsgNormalized.content, {
        wsName:      wsObj?.name,
        wsIndustry:  wsObj?.industry,
        companyDesc: wsObj?.context?.description,
      });
      webContext = buildWebContext(web, { attempted: true });
      console.log('[chat] web search grounded=%s snippets=%d', !!web?.grounded, web?.snippets?.length || 0);
    } catch (e) {
      console.warn('[chat] web search failed:', e.message);
    }
  }

  const sys = buildDaemonSystemPrompt(
    profile ?? null,
    profile?.workspaces ?? null,
    memories || [],
    agentProfile ?? null,
    huntFindings,
    webContext,
    connectedTools,
    slackContext,
  );

  // Resolve AI provider key
  let keyRow = null;
  if (workspaceId) {
    const { data: keys } = await db
      .from('workspace_api_keys')
      .select('provider, api_key, endpoint, model, use_case')
      .eq('workspace_id', workspaceId)
      .order('created_at');
    keyRow = keys?.find(k => k.use_case === 'reasoning')
          ?? keys?.find(k => k.use_case === 'default')
          ?? keys?.[0]
          ?? null;

    if (!keyRow) {
      const { data: ws } = await db
        .from('workspaces')
        .select('openrouter_key, openrouter_model')
        .eq('id', workspaceId)
        .single();
      if (ws?.openrouter_key) {
        keyRow = { provider: 'openrouter', api_key: ws.openrouter_key, model: ws.openrouter_model };
      }
    }
  }

  // Env fallback when a workspace has no key of its own — mirrors resolveLLM:
  // DeepSeek first (the intended brain + already set in prod), then Anthropic,
  // then OpenAI. This is what makes a brand-new workspace's daemon work
  // out-of-the-box instead of 503-ing until an admin adds a key.
  if (!keyRow) {
    if (process.env.DEEPSEEK_API_KEY) {
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

  try {
    const raw    = await callProvider(resolvedKey, sys, trimmed);
    const parsed = parseJsonResponse(raw);

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

        // 4. Log to brain_interactions (skip session pings)
        if (!isSessionPing && userText && workspaceId) {
          const tags = extractTopicTags(userText);
          const hour = new Date().getHours();
          await db.from('brain_interactions').insert({
            user_id:      user.id,
            workspace_id: workspaceId,
            user_role:    profile?.role || profile?.title || null,
            access_level: agentProfile?.access_level || 'junior',
            user_message: userText.slice(0, 500),
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

    return res.status(200).json(parsed);
  } catch (e) {
    console.error('[chat] provider=%s error=%s', keyRow.provider, e.message, e.stack);
    return res.status(502).json({ error: 'AI request failed. Please try again.' });
  }
}
