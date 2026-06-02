import { requireAuth, adminClient } from '../_lib/supabase.js';
import { assertSafeUrl, encryptSecret, decryptSecret, enforceRateLimit, fail } from '../_lib/security.js';
import {
  PROVIDERS, providerConfigured, getRedirectUri, signState, buildAuthorizeUrl, handleOAuthCallback,
} from '../_lib/oauth.js';

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
        if (!endpoint) return []; // no public default — localhost is not reachable/safe from serverless
        const base = (await assertSafeUrl(endpoint, { allowHttp: true })).replace(/\/$/, '');
        const r = await fetch(`${base}/api/tags`);
        const d = await r.json();
        return (d.models || []).map(m => ({ id: m.name, name: m.name }));
      }
      case 'azure': {
        if (!endpoint) return [];
        const base = (await assertSafeUrl(endpoint)).replace(/\/$/, '');
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
  // OAuth callback (provider redirect to /api/oauth → rewritten here). No auth
  // header — trust the HMAC-signed `state`. Handle before requireAuth.
  if (req.method === 'GET' && req.query.code && req.query.state) {
    return handleOAuthCallback(req, res, adminClient());
  }

  const user = await requireAuth(req, res);
  if (!user) return;

  const db = adminClient();
  const workspaceId = await resolveWorkspace(db, user.id);
  if (!workspaceId) return res.status(404).json({ error: 'No workspace found' });

  // Per-user rate limit across all settings operations.
  if (!(await enforceRateLimit(res, { key: `settings:${user.id}`, max: 60, windowSec: 60 }))) return;

  // ── GET: list keys (masked) or proxy model fetch ─────────────────────────
  if (req.method === 'GET') {
    // ?integrations=true — list available providers + this workspace's connections
    if (req.query.integrations === 'true') {
      const { data: rows } = await db
        .from('workspace_integrations')
        .select('provider, status, external_account, scopes, updated_at')
        .eq('workspace_id', workspaceId);
      const byProvider = Object.fromEntries((rows || []).map(r => [r.provider, r]));
      const providers = Object.entries(PROVIDERS).map(([id, cfg]) => ({
        id, label: cfg.label, configured: providerConfigured(id),
        connection: byProvider[id] || null, // {status, external_account, scopes, updated_at} or null
      }));
      return res.status(200).json({ providers });
    }

    // ?publishing=true — read the workspace's autonomous-publishing config
    if (req.query.publishing === 'true') {
      const { data: ws } = await db
        .from('workspaces')
        .select('auto_publish, publish_webhook_url')
        .eq('id', workspaceId)
        .single();
      return res.status(200).json({
        auto_publish: !!ws?.auto_publish,
        publish_webhook_url: ws?.publish_webhook_url || '',
      });
    }

    // ?models=true&keyId=xxx — proxy model list for a stored key
    if (req.query.models === 'true' && req.query.keyId) {
      if (!(await enforceRateLimit(res, { key: `models:${user.id}`, max: 30, windowSec: 600 }))) return;
      const { data: keyRow } = await db
        .from('workspace_api_keys')
        .select('provider, api_key, endpoint')
        .eq('id', req.query.keyId)
        .eq('workspace_id', workspaceId)
        .single();

      if (!keyRow) return res.status(404).json({ error: 'Key not found' });
      const models = await fetchProviderModels(keyRow.provider, decryptSecret(keyRow.api_key), keyRow.endpoint);
      return res.status(200).json({ models });
    }

    // List all keys for this workspace (no raw keys exposed)
    const { data: keys } = await db
      .from('workspace_api_keys')
      .select('id, provider, endpoint, model, use_case, label, created_at, api_key')
      .eq('workspace_id', workspaceId)
      .order('created_at');

    const masked = (keys || []).map(k => {
      const plain = decryptSecret(k.api_key);
      return {
        id: k.id,
        provider: k.provider,
        endpoint: k.endpoint,
        model: k.model,
        use_case: k.use_case,
        label: k.label,
        created_at: k.created_at,
        hasKey: !!(k.api_key),
        keyHint: plain ? `...${plain.slice(-4)}` : null,
      };
    });

    return res.status(200).json({ keys: masked });
  }

  // ── POST: validate key, save key ─────────────────────────────────────────
  if (req.method === 'POST') {
    const { action, provider, key, endpoint, model, use_case, label, id } = req.body ?? {};

    // ── Integrations OAuth (admin) — handled before the API-key provider checks
    // so a connector slug like 'slack' isn't rejected by the LLM-provider allowlist.
    if (action === 'oauth_start' || action === 'oauth_disconnect') {
      if (!(await checkAdmin(db, workspaceId, user.id))) return res.status(403).json({ error: 'Admin access required' });
      const p = (req.body?.provider || '').toString();
      if (!PROVIDERS[p]) return res.status(400).json({ error: 'Unknown integration provider' });

      if (action === 'oauth_disconnect') {
        const { error } = await db.from('workspace_integrations').delete()
          .eq('workspace_id', workspaceId).eq('provider', p);
        if (error) return fail(res, 500, 'Could not disconnect integration', error, 'settings');
        return res.status(200).json({ ok: true });
      }
      // oauth_start → return the provider consent URL (UI redirects to it)
      if (!providerConfigured(p)) {
        return res.status(503).json({ error: `${PROVIDERS[p].label} isn't configured yet — app credentials are missing.` });
      }
      const state = signState({ workspace_id: workspaceId, user_id: user.id, provider: p });
      return res.status(200).json({ url: buildAuthorizeUrl(p, { state, redirectUri: getRedirectUri(req) }) });
    }

    // Type + length validation on every supplied field (reject malformed input early).
    const ALLOWED_PROVIDERS = ['openrouter', 'anthropic', 'openai', 'google', 'mistral', 'ollama', 'azure', 'modal', 'deepseek'];
    const strLimits = { provider: 40, key: 8000, endpoint: 2000, model: 200, use_case: 40, label: 120, id: 64 };
    for (const [field, limit] of Object.entries(strLimits)) {
      const v = req.body?.[field];
      if (v === undefined || v === null) continue;
      if (typeof v !== 'string') return res.status(400).json({ error: `${field} must be a string` });
      if (v.length > limit) return res.status(400).json({ error: `${field} is too long` });
    }
    if (provider && !ALLOWED_PROVIDERS.includes(provider)) {
      return res.status(400).json({ error: 'Unknown provider' });
    }

    // Validate key + return model list (without saving)
    if (action === 'validate') {
      if (!(await enforceRateLimit(res, { key: `validate:${user.id}`, max: 20, windowSec: 600 }))) return;
      if (!provider || (!key && provider !== 'ollama'))
        return res.status(400).json({ error: 'Provider and key required' });
      const models = await fetchProviderModels(provider, key, endpoint);
      return res.status(200).json({ models, valid: models.length > 0 });
    }

    // Save / upsert — admin only
    const isAdmin = await checkAdmin(db, workspaceId, user.id);
    if (!isAdmin) return res.status(403).json({ error: 'Admin access required' });

    // ── Autonomous (L3) publishing config ──────────────────────────────────
    if (action === 'update_publishing') {
      const autoPublish = req.body?.auto_publish === true;
      let webhook = (req.body?.publish_webhook_url ?? '').toString().trim();
      if (webhook.length > 2000) return res.status(400).json({ error: 'Webhook URL is too long' });
      if (webhook) {
        // SSRF guard — must be a public https endpoint.
        try { await assertSafeUrl(webhook); }
        catch (e) { return res.status(400).json({ error: `Invalid webhook URL: ${e.message}` }); }
      }
      // Can't enable autonomous publishing without somewhere to publish.
      if (autoPublish && !webhook) {
        return res.status(400).json({ error: 'Set a publish webhook URL before enabling autonomous publishing.' });
      }
      const { error: upErr } = await db
        .from('workspaces')
        .update({ auto_publish: autoPublish, publish_webhook_url: webhook || null })
        .eq('id', workspaceId);
      if (upErr) return fail(res, 500, 'Could not save publishing settings', upErr, 'settings');
      return res.status(200).json({ ok: true, auto_publish: autoPublish, publish_webhook_url: webhook });
    }

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

    // Validate any user-supplied endpoint before persisting (SSRF guard).
    if (endpoint) {
      try { await assertSafeUrl(endpoint, { allowHttp: provider === 'ollama' }); }
      catch (e) { return res.status(400).json({ error: `Invalid endpoint: ${e.message}` }); }
    }

    // Encrypt the key at rest. Only update api_key if a new one was provided
    // (don't wipe an existing key on a metadata-only edit).
    if (key) upsertData.api_key = encryptSecret(key);

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
        .insert({ ...upsertData, api_key: key ? encryptSecret(key) : null }));
    }

    if (error) return fail(res, 500, 'Could not save API key', error, 'settings');
    return res.status(200).json({ ok: true });
  }

  // ── DELETE: remove a key ──────────────────────────────────────────────────
  if (req.method === 'DELETE') {
    const isAdmin = await checkAdmin(db, workspaceId, user.id);
    if (!isAdmin) return res.status(403).json({ error: 'Admin access required' });

    const { id } = req.body ?? {};
    if (typeof id !== 'string' || !id) return res.status(400).json({ error: 'Key id (string) required' });

    const { error } = await db
      .from('workspace_api_keys')
      .delete()
      .eq('id', id)
      .eq('workspace_id', workspaceId);

    if (error) return fail(res, 500, 'Could not delete API key', error, 'settings');
    return res.status(200).json({ ok: true });
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
