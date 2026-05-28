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

  // ── OpenRouter ────────────────────────────────────────────────────────────
  if (orKey) {
    const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${orKey}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': 'https://workdaemon.com',
        'X-Title': 'WorkDaemon',
      },
      body: JSON.stringify({
        model: orModel || 'anthropic/claude-sonnet-4-6',
        max_tokens: 1024,
        messages: [{ role: 'system', content: sys }, ...messages],
      }),
    });

    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      return res.status(502).json({ error: err.error?.message || 'OpenRouter request failed' });
    }

    const data = await response.json();
    return res.status(200).json({ reply: data.choices[0]?.message?.content ?? '' });
  }

  // ── Anthropic fallback ────────────────────────────────────────────────────
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return res.status(503).json({ error: 'AI not configured — add an OpenRouter key in Settings' });

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-6',
      max_tokens: 1024,
      system: sys,
      messages,
    }),
  });

  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    return res.status(502).json({ error: err.error?.message || 'AI request failed' });
  }

  const data = await response.json();
  return res.status(200).json({ reply: data.content[0]?.text ?? '' });
}
