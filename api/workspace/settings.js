import { requireAuth, adminClient } from '../_lib/supabase.js';

// Fetch models from a provider's API (server-side to avoid CORS)
async function fetchProviderModels(provider, apiKey, endpoint) {
  try {
    switch (provider) {
      case 'openrouter': {
        const r = await fetch('https://openrouter.ai/api/v1/models', {
          headers: { Authorization: `Bearer ${apiKey}` },
        });
        const d = await r.json();
        return (d.data || []).map(m => ({ id: m.id, name: m.name, context: m.context_length }));
      }
      case 'anthropic': {
        const r = await fetch('https://api.anthropic.com/v1/models', {
          headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
        });
        const d = await r.json();
        return (d.data || []).map(m => ({ id: m.id, name: m.display_name || m.id }));
      }
      case 'openai': {
        const r = await fetch('https://api.openai.com/v1/models', {
          headers: { Authorization: `Bearer ${apiKey}` },
        });
        const d = await r.json();
        return (d.data || [])
          .filter(m => /gpt-|o1|o3|o4|embedding/.test(m.id))
          .sort((a, b) => b.created - a.created)
          .map(m => ({ id: m.id, name: m.id }));
      }
      case 'google': {
        const r = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`
        );
        const d = await r.json();
        return (d.models || []).map(m => ({
          id: m.name.replace('models/', ''),
          name: m.displayName || m.name,
        }));
      }
      case 'mistral': {
        const r = await fetch('https://api.mistral.ai/v1/models', {
          headers: { Authorization: `Bearer ${apiKey}` },
        });
        const d = await r.json();
        return (d.data || []).map(m => ({ id: m.id, name: m.id }));
      }
      case 'ollama': {
        const base = (endpoint || 'http://localhost:11434').replace(/\/$/, '');
        const r = await fetch(`${base}/api/tags`);
        const d = await r.json();
        return (d.models || []).map(m => ({ id: m.name, name: m.name }));
      }
      case 'azure': {
        const base = (endpoint || '').replace(/\/$/, '');
        const r = await fetch(
          `${base}/openai/deployments?api-version=2024-02-15-preview`,
          { headers: { 'api-key': apiKey } }
        );
        const d = await r.json();
        return (d.value || []).map(m => ({
          id: m.model,
          name: `${m.model} (${m.id || 'deployment'})`,
        }));
      }
      default:
        return [];
    }
  } catch {
    return [];
  }
}

async function resolveWorkspace(db, userId) {
  const { data: profile } = await db
    .from('profiles')
    .select('workspace_id')
    .eq('id', userId)
    .single();

  if (!profile?.workspace_id) {
    const { data: member } = await db
      .from('workspace_members')
      .select('workspace_id')
      .eq('user_id', userId)
      .limit(1)
      .single();
    return member?.workspace_id ?? null;
  }
  return profile.workspace_id;
}

async function checkAdmin(db, workspaceId, userId) {
  const { data } = await db
    .from('workspace_members')
    .select('role')
    .eq('workspace_id', workspaceId)
    .eq('user_id', userId)
    .single();
  return data?.role === 'admin';
}

export default async function handler(req, res) {
  const user = await requireAuth(req, res);
  if (!user) return;

  const db = adminClient();
  const workspaceId = await resolveWorkspace(db, user.id);
  if (!workspaceId) return res.status(404).json({ error: 'No workspace found' });

  // ── GET: list keys (masked) or proxy model fetch ─────────────────────────
  if (req.method === 'GET') {
    // ?models=true&keyId=xxx — proxy model list for a stored key
    if (req.query.models === 'true' && req.query.keyId) {
      const { data: keyRow } = await db
        .from('workspace_api_keys')
        .select('provider, api_key, endpoint')
        .eq('id', req.query.keyId)
        .eq('workspace_id', workspaceId)
        .single();

      if (!keyRow) return res.status(404).json({ error: 'Key not found' });
      const models = await fetchProviderModels(keyRow.provider, keyRow.api_key, keyRow.endpoint);
      return res.status(200).json({ models });
    }

    // List all keys for this workspace (no raw keys exposed)
    const { data: keys } = await db
      .from('workspace_api_keys')
      .select('id, provider, endpoint, model, use_case, label, created_at, api_key')
      .eq('workspace_id', workspaceId)
      .order('created_at');

    const masked = (keys || []).map(k => ({
      id: k.id,
      provider: k.provider,
      endpoint: k.endpoint,
      model: k.model,
      use_case: k.use_case,
      label: k.label,
      created_at: k.created_at,
      hasKey: !!(k.api_key),
      keyHint: k.api_key ? `...${k.api_key.slice(-4)}` : null,
    }));

    return res.status(200).json({ keys: masked });
  }

  // ── POST: validate key, save key ─────────────────────────────────────────
  if (req.method === 'POST') {
    const { action, provider, key, endpoint, model, use_case, label, id } = req.body ?? {};

    // Validate key + return model list (without saving)
    if (action === 'validate') {
      if (!provider || (!key && provider !== 'ollama'))
        return res.status(400).json({ error: 'Provider and key required' });
      const models = await fetchProviderModels(provider, key, endpoint);
      return res.status(200).json({ models, valid: models.length > 0 });
    }

    // Save / upsert — admin only
    const isAdmin = await checkAdmin(db, workspaceId, user.id);
    if (!isAdmin) return res.status(403).json({ error: 'Admin access required' });

    if (!provider) return res.status(400).json({ error: 'Provider required' });

    const upsertData = {
      workspace_id: workspaceId,
      provider,
      model: model || null,
      use_case: use_case || 'reasoning',
      label: label || null,
      endpoint: endpoint || null,
      updated_at: new Date().toISOString(),
    };

    // Only update api_key if a new one was provided (don't wipe existing key)
    if (key) upsertData.api_key = key;

    let error;
    if (id) {
      // Update existing
      ({ error } = await db
        .from('workspace_api_keys')
        .update(upsertData)
        .eq('id', id)
        .eq('workspace_id', workspaceId));
    } else {
      // Insert new
      ({ error } = await db
        .from('workspace_api_keys')
        .insert({ ...upsertData, api_key: key || null }));
    }

    if (error) return res.status(500).json({ error: error.message });
    return res.status(200).json({ ok: true });
  }

  // ── DELETE: remove a key ──────────────────────────────────────────────────
  if (req.method === 'DELETE') {
    const isAdmin = await checkAdmin(db, workspaceId, user.id);
    if (!isAdmin) return res.status(403).json({ error: 'Admin access required' });

    const { id } = req.body ?? {};
    if (!id) return res.status(400).json({ error: 'Key id required' });

    const { error } = await db
      .from('workspace_api_keys')
      .delete()
      .eq('id', id)
      .eq('workspace_id', workspaceId);

    if (error) return res.status(500).json({ error: error.message });
    return res.status(200).json({ ok: true });
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
