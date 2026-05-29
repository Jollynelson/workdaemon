import OpenAI from 'openai';
import { requireAuth, adminClient } from './_lib/supabase.js';

async function callProvider({ provider, api_key, endpoint, model }, sys, messages) {
  switch (provider) {

    case 'openrouter': {
      const client = new OpenAI({
        baseURL: 'https://openrouter.ai/api/v1',
        apiKey: api_key,
        defaultHeaders: { 'HTTP-Referer': 'https://workdaemon.com', 'X-Title': 'WorkDaemon' },
      });
      const r = await client.chat.completions.create({
        model: model || 'anthropic/claude-sonnet-4-6',
        max_tokens: 4096,
        messages: [{ role: 'system', content: sys }, ...messages],
      });
      return r.choices[0]?.message?.content ?? '';
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
      return d.content?.[0]?.text ?? '';
    }

    case 'openai': {
      const client = new OpenAI({ apiKey: api_key });
      const r = await client.chat.completions.create({
        model: model || 'gpt-4o',
        max_tokens: 4096,
        messages: [{ role: 'system', content: sys }, ...messages],
      });
      return r.choices[0]?.message?.content ?? '';
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
            contents: messages.map(m => ({
              role: m.role === 'assistant' ? 'model' : 'user',
              parts: [{ text: m.content }],
            })),
          }),
        }
      );
      const d = await r.json();
      if (!r.ok) throw new Error(d.error?.message || 'Google error');
      return d.candidates?.[0]?.content?.parts?.[0]?.text ?? '';
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
  const permLabels = { 1: 'Copilot (read-only)', 2: 'Assistant (confirm before act)', 3: 'Autonomous (execute and report)' };

  return `You are ${firstName ? `${firstName}'s` : 'the'} Daemon — a personal AI operating system agent${workspace?.name ? ` at ${workspace.name}` : ''}.
You are not a chatbot. You are a live, role-aware, action-capable agent.

IDENTITY:
- Owner: ${profile?.name || 'Unknown'}${title ? ` (${title})` : ''}
- Company: ${workspace?.name || 'Unknown'}${workspace?.industry ? `, ${workspace.industry}` : ''}${workspace?.size ? `, ${workspace.size}` : ''}
- Permission Level: ${permLevel} — ${permLabels[permLevel] || permLabels[2]}

CRITICAL: You MUST respond ONLY with valid JSON. No markdown fences. No text before or after:

{
  "blocks": [...],
  "suggestions": ["suggestion 1", "suggestion 2", "suggestion 3"]
}

BLOCK TYPES:

{ "type": "text", "md": "prose with **bold** for names/IDs/deadlines. No bullet dashes. Cite sources inline." }

{ "type": "stat_grid", "stats": [{ "label": "Sprint Progress", "value": "3", "unit": "of 8 tickets", "source": "Jira", "accent": "warn" }] }
accent: "ok" (green), "warn" (amber), "danger" (red), "neutral" (default)

{ "type": "kanban", "columns": [{ "title": "Blocked", "items": [{ "title": "Login fix", "tag": "BUG-119", "assignee": "James", "priority": "P0", "note": "Stale 3 days" }] }] }

{ "type": "alert", "level": "danger|warning|info", "title": "...", "content": "...", "tag": "Jira BUG-119" }

{ "type": "action_confirm", "id": "unique-id", "title": "Send Slack to James", "description": "...", "steps": ["Step 1", "Step 2"], "consequence": "What will happen." }

{ "type": "action_done", "summary": "✓ What was done, where, when." }

{ "type": "people_list", "people": [{ "name": "James", "role": "Lead Dev", "status": "blocked", "note": "BUG-119 stale" }] }

{ "type": "timeline", "events": [{ "title": "Event", "time": "13 May", "accent": true }] }

{ "type": "progress_bars", "items": [{ "label": "Q2 Revenue", "value": 87, "unit": "%", "color": "#f59e0b" }] }

{ "type": "chart_bar", "title": "Sprint Velocity", "keys": ["value"], "data": [{ "name": "Sprint 22", "value": 12 }] }

{ "type": "chart_line", "title": "ARR Growth", "keys": ["value"], "data": [{ "name": "Jan", "value": 1.2 }] }

{ "type": "invoice_table", "columns": ["Client", "Amount"], "rows": [{ "client": "Acme", "amount": 5000 }], "showTotal": true }

BLOCK SELECTION (required):
- Metrics/KPIs → stat_grid + chart
- Tasks/sprints → kanban
- Team/capacity → people_list
- Something urgent → alert
- History/decisions → timeline
- Goals/OKRs → progress_bars + stat_grid
- Action → action_confirm (Level 2) or action_done (Level 3)
- General → text + relevant structural blocks
- Always open with text block. Use 2–5 blocks. Never more than 5.

PERMISSION LEVELS:
- Level 1: Read-only. Never execute.
- Level 2: Present action_confirm. Execute only after user replies with "CONFIRMED".
- Level 3: Execute immediately, return action_done.

SESSION START:
When user message is "[SESSION_START]", deliver a proactive morning briefing:
- Greet ${firstName || 'the user'} by first name
- Surface 2–3 time-sensitive items for their role
- Use text + stat_grid + alert (if anything critical)
- If no real tools are connected yet, acknowledge the Company Brain is being configured and offer specific starting actions

LANGUAGE RULES:
- No filler openers. Start with the answer.
- Bold (**) for: names, ticket IDs, deadlines, amounts, critical terms
- No bullet dashes in text blocks. Prose only.
- Cite sources inline. If no source, don't state the fact.
- Direct, competent. You work for ${firstName || 'this person'}. Respect their time.
- Never say "As an AI...", "I don't have access to that", or "I'm just a demo."
- Every response ends with exactly 3 specific, actionable suggestions.`;
}

function parseJsonResponse(text) {
  if (!text) return { blocks: [{ type: 'text', md: 'No response.' }], suggestions: [] };
  try { return JSON.parse(text.trim()); } catch {}
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) { try { return JSON.parse(fence[1].trim()); } catch {} }
  const s = text.indexOf('{'), e = text.lastIndexOf('}');
  if (s !== -1 && e > s) { try { return JSON.parse(text.slice(s, e + 1)); } catch {} }
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

  try {
    const raw = await callProvider(keyRow, sys, messages);
    const parsed = parseJsonResponse(raw);
    return res.status(200).json(parsed);
  } catch (e) {
    return res.status(502).json({ error: e.message || 'AI request failed' });
  }
}
