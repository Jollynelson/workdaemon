import OpenAI from 'openai';
import { requireAuth, adminClient } from './_lib/supabase.js';

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
          model: model || 'claude-sonnet-4-5',
          max_tokens: 4096,
          system: sys,
          messages,
        }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error?.message || 'Anthropic error');
      // Find text block — skip thinking blocks if extended thinking is active
      const types = (d.content || []).map(b => b.type).join(',');
      const textBlock = d.content?.find(b => b.type === 'text');
      console.log('[chat] anthropic stop=%s content_types=%s text_len=%d', d.stop_reason, types, textBlock?.text?.length ?? 0);
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
      // Non-thought text first; fall back to all text if model outputs only thought parts
      const nonThought = parts.filter(p => p.text && !p.thought).map(p => p.text).join('');
      const text = nonThought || parts.filter(p => p.text).map(p => p.text).join('');
      console.log('[chat] google parts=%d text_len=%d finish=%s', parts.length, text.length, d.candidates?.[0]?.finishReason);
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
      const text = r.choices[0]?.message?.content ?? '';
      console.log('[chat] mistral text_len=%d', text.length);
      return text;
    }

    case 'ollama': {
      const base = (endpoint || 'http://localhost:11434').replace(/\/$/, '');
      const client = new OpenAI({ baseURL: `${base}/v1`, apiKey: 'ollama' });
      const r = await client.chat.completions.create({
        model: model || 'llama3',
        messages: [{ role: 'system', content: sys }, ...messages],
      });
      return r.choices[0]?.message?.content ?? '';
    }

    case 'azure': {
      const base = (endpoint || '').replace(/\/$/, '');
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

    default:
      throw new Error(`Unknown provider: ${provider}`);
  }
}

function buildDaemonSystemPrompt(profile, workspace) {
  const firstName = profile?.name ? profile.name.split(' ')[0] : null;
  const title = profile?.title || profile?.role || null;
  const permLevel = profile?.permission_level ?? 2;
  const ws = Array.isArray(workspace) ? workspace[0] : workspace;
  const permLabels = { 1: 'Copilot (read-only)', 2: 'Assistant (confirm before act)', 3: 'Autonomous (execute and report)' };

  return `OUTPUT CONTRACT — ABSOLUTE RULE:
Your response is one JSON object. First character: {. Last character: }. Nothing else exists in your output. No reasoning steps. No planning notes. No constraint checks. No asterisks. No text before or after the JSON. Violating this breaks the interface completely — the user sees raw garbage instead of a dashboard.

{"blocks":[...],"suggestions":["...","...","..."]}

IDENTITY:
You are ${firstName ? `${firstName}'s` : 'the'} Daemon — personal AI operating system${ws?.name ? ` at ${ws.name}` : ''}.
Owner: ${profile?.name || 'Unknown'}${title ? ` (${title})` : ''}
Company: ${ws?.name || 'Unknown'}${ws?.industry ? `, ${ws.industry}` : ''}${ws?.size ? `, ${ws.size}` : ''}
Permission: ${permLevel} — ${permLabels[permLevel] || permLabels[2]}

BLOCK TYPES — use these schemas exactly:

{"type":"boot","title":"DAEMON BOOT SEQUENCE","lines":[{"label":"Identity","status":"ok","detail":"${profile?.name || 'User'} · ${title || 'Staff'}"},{"label":"Company Brain","status":"ok","detail":"${ws?.name || 'Workspace'} · LINKED"},{"label":"Knowledge graph","status":"pending","detail":"0 sources indexed — connect tools to activate"},{"label":"Permission","status":"ok","detail":"LEVEL ${permLevel} — ${permLabels[permLevel] || permLabels[2]}"},{"label":"Memory","status":"pending","detail":"Learning your patterns"}]}

{"type":"text","md":"prose **bold** for names/IDs/amounts/deadlines. No bullet dashes. Cite sources inline: (Jira BUG-119), (Slack #eng 15 May)."}

{"type":"stat_grid","stats":[{"label":"Sprint Progress","value":"3","unit":"of 8 tickets","source":"Jira","status":"warn"}]}
status: "ok" (green) | "warn" (amber) | "danger" (red) | "neutral"

{"type":"kanban","columns":[{"title":"Blocked","items":[{"id":"BUG-119","title":"Login fix","assignee":"James","priority":"P0","blockers":"Stale 3 days","due":"15 May"}]}]}
priority: P0 (red) | P1 (amber) | P2 (blue) | P3 (grey)

{"type":"alert","level":"critical","title":"...","content":"...","tag":"Jira BUG-119"}
level: "critical" | "warning" | "info"

{"type":"action_confirm","id":"unique-id","title":"Send Slack to James","description":"...","steps":["Step 1","Step 2"],"consequence":"What happens if confirmed."}

{"type":"action_done","summary":"✓ What was done, where, when."}

{"type":"people_list","people":[{"name":"James","role":"Lead Dev","initial":"J","status":"blocked","note":"BUG-119 stale"}]}

{"type":"timeline","events":[{"date":"15 May","title":"Event","body":"detail","source":"Jira","event_type":"decision"}]}

{"type":"progress_bars","items":[{"label":"Q2 Revenue","current":87,"target":100,"unit":"%","status":"warn"}]}

{"type":"chart_bar","title":"Sprint Velocity","keys":["value"],"data":[{"name":"Sprint 22","value":12}]}

{"type":"chart_line","title":"ARR Growth","keys":["value"],"data":[{"name":"Jan","value":1.2}]}

{"type":"invoice_table","columns":["Client","Amount","Status"],"rows":[{"client":"Acme","amount":5000,"status":"overdue"}],"showTotal":true}

BLOCK SELECTION (required):
Session start → boot + text + stat_grid or alert
Metrics/KPIs → stat_grid + chart | Tasks → kanban | Team → people_list
Urgent → alert (critical/warning) | History → timeline | Goals → progress_bars + stat_grid
Action (L2) → action_confirm | Action (L3) → action_done | Financial → invoice_table + stat_grid
General → text + structural block
Open with text (or boot at session start). 2–5 blocks max.

PERMISSION: L1=read only | L2=action_confirm then wait for confirm | L3=execute then action_done

SESSION START — when message is "[SESSION_START]":
Return: boot block first, then text block greeting ${firstName || 'the user'} by name with smart company-aware intro, then 1–2 relevant blocks.
If no tools connected: acknowledge honestly, offer 3 specific connection actions.

LANGUAGE: Bold names/IDs/deadlines/amounts. Prose not dashes. Cite every fact. Direct and competent.
Never: "As an AI", "I don't have access", "I'm just a demo", visible reasoning, constraint checks.
End with exactly 3 specific actionable suggestions.`;
}

function parseJsonResponse(text) {
  if (!text) return { blocks: [{ type: 'text', md: 'No response.' }], suggestions: [] };

  // Strip <thinking> tags (extended thinking models)
  let t = text.replace(/<thinking>[\s\S]*?<\/thinking>/gi, '').trim();

  // 1. Direct parse
  try { const p = JSON.parse(t); if (p.blocks) return p; } catch {}

  // 2. Code fence
  const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) { try { const p = JSON.parse(fence[1].trim()); if (p.blocks) return p; } catch {} }

  // 3. Balanced brace scan — finds first complete JSON object containing "blocks"
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

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const user = await requireAuth(req, res);
  if (!user) return;

  const { messages, systemPrompt } = req.body ?? {};
  if (!Array.isArray(messages)) return res.status(400).json({ error: 'messages array required' });

  const db = adminClient();

  // Resolve user + workspace context for Daemon persona
  const { data: profile } = await db
    .from('profiles')
    .select('workspace_id, name, title, role, permission_level, workspaces(name, industry, size)')
    .eq('id', user.id)
    .single();

  const workspaceId = profile?.workspace_id;
  const sys = buildDaemonSystemPrompt(profile ?? null, profile?.workspaces ?? null);

  // Find the reasoning key from multi-provider table, fall back to legacy columns
  let keyRow = null;

  if (workspaceId) {
    const { data: keys } = await db
      .from('workspace_api_keys')
      .select('provider, api_key, endpoint, model, use_case')
      .eq('workspace_id', workspaceId)
      .order('created_at');

    // Prefer 'reasoning' use case, then 'default', then first available
    keyRow = keys?.find(k => k.use_case === 'reasoning')
          ?? keys?.find(k => k.use_case === 'default')
          ?? keys?.[0]
          ?? null;

    // Legacy fallback: old openrouter_key column
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

  if (!keyRow) {
    // Server-level Anthropic fallback
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) return res.status(503).json({ error: 'No AI provider configured. Add a key in Settings.' });
    keyRow = { provider: 'anthropic', api_key: apiKey, model: 'claude-sonnet-4-6' };
  }

  // Trim history to last 12 messages to cap token cost
  const trimmed = messages.length > 12 ? messages.slice(-12) : messages;

  try {
    const raw = await callProvider(keyRow, sys, trimmed);
    const parsed = parseJsonResponse(raw);
    return res.status(200).json(parsed);
  } catch (e) {
    console.error('[chat] provider=%s error=%s', keyRow.provider, e.message, e.stack);
    return res.status(502).json({ error: e.message || 'AI request failed' });
  }
}
