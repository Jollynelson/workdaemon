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
        max_tokens: 1024,
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
          max_tokens: 1024,
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
        max_tokens: 1024,
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
        max_tokens: 1024,
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

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const user = await requireAuth(req, res);
  if (!user) return;

  const { messages, systemPrompt } = req.body ?? {};
  if (!Array.isArray(messages)) return res.status(400).json({ error: 'messages array required' });

  const db = adminClient();
  const sys = systemPrompt || 'You are WorkDaemon, an AI operating system for companies.';

  // Resolve workspace
  const { data: profile } = await db
    .from('profiles')
    .select('workspace_id')
    .eq('id', user.id)
    .single();

  const workspaceId = profile?.workspace_id;

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
    const reply = await callProvider(keyRow, sys, messages);
    return res.status(200).json({ reply });
  } catch (e) {
    return res.status(502).json({ error: e.message || 'AI request failed' });
  }
}
