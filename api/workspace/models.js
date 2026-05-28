export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const r = await fetch('https://openrouter.ai/api/v1/models', {
      headers: { 'Content-Type': 'application/json' },
    });
    if (!r.ok) return res.status(502).json({ error: 'Could not fetch model list' });
    const { data } = await r.json();

    // Shape: id, name, context_length, pricing.prompt (per token)
    const models = (data || [])
      .filter(m => m.id && m.name)
      .map(m => ({
        id: m.id,
        name: m.name,
        context: m.context_length,
        promptCost: parseFloat(m.pricing?.prompt || 0),
        provider: m.id.split('/')[0],
      }))
      .sort((a, b) => a.name.localeCompare(b.name));

    return res.status(200).json({ models });
  } catch (e) {
    return res.status(502).json({ error: e.message });
  }
}
