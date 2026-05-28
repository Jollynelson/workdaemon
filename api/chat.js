import OpenAI from 'openai';
import { requireAuth, adminClient } from './_lib/supabase.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const user = await requireAuth(req, res);
  if (!user) return;

  const { messages, systemPrompt } = req.body ?? {};
  if (!Array.isArray(messages)) return res.status(400).json({ error: 'messages array required' });

  const db = adminClient();
  const sys = systemPrompt || 'You are WorkDaemon, an AI operating system for companies.';

  // Look up workspace OpenRouter config
  let orKey = null, orModel = null;
  const { data: profile } = await db
    .from('profiles')
    .select('workspace_id')
    .eq('id', user.id)
    .single();

  if (profile?.workspace_id) {
    const { data: ws } = await db
      .from('workspaces')
      .select('openrouter_key, openrouter_model')
      .eq('id', profile.workspace_id)
      .single();
    orKey = ws?.openrouter_key || null;
    orModel = ws?.openrouter_model || null;
  }

  // ── OpenRouter via OpenAI SDK ─────────────────────────────────────────────
  if (orKey) {
    const client = new OpenAI({
      baseURL: 'https://openrouter.ai/api/v1',
      apiKey: orKey,
      defaultHeaders: {
        'HTTP-Referer': 'https://workdaemon.com',
        'X-Title': 'WorkDaemon',
      },
    });

    try {
      const completion = await client.chat.completions.create({
        model: orModel || 'anthropic/claude-sonnet-4-6',
        max_tokens: 1024,
        messages: [{ role: 'system', content: sys }, ...messages],
      });
      return res.status(200).json({ reply: completion.choices[0]?.message?.content ?? '' });
    } catch (e) {
      return res.status(502).json({ error: e.message || 'OpenRouter request failed' });
    }
  }

  // ── Anthropic fallback (also via OpenAI-compat on OpenRouter if no key) ───
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return res.status(503).json({ error: 'AI not configured — add an OpenRouter key in Settings' });

  const client = new OpenAI({
    baseURL: 'https://openrouter.ai/api/v1',
    apiKey,
    defaultHeaders: {
      'HTTP-Referer': 'https://workdaemon.com',
      'X-Title': 'WorkDaemon',
    },
  });

  try {
    const completion = await client.chat.completions.create({
      model: 'anthropic/claude-sonnet-4-6',
      max_tokens: 1024,
      messages: [{ role: 'system', content: sys }, ...messages],
    });
    return res.status(200).json({ reply: completion.choices[0]?.message?.content ?? '' });
  } catch (e) {
    return res.status(502).json({ error: e.message || 'AI request failed' });
  }
}
