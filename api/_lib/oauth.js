import crypto from 'node:crypto';
import { encryptSecret, decryptSecret } from './security.js';

// ─────────────────────────────────────────────────────────────────────────────
// Native OAuth connector framework. One handler, many providers (Vercel Hobby
// caps a deployment at 12 functions and api/ is at the cap, so OAuth is hosted
// inside api/workspace/settings.js and reached via a /api/oauth rewrite).
//
// Flow:
//   1. UI (authed) → POST settings { action:'oauth_start', provider } → { url }
//      url = provider consent screen with a SIGNED state (workspace+user+provider).
//   2. Provider redirects to  /api/oauth?code=…&state=…  (no auth header) →
//      settings.js verifies the signed state, exchanges the code for tokens,
//      encrypts them, upserts workspace_integrations, redirects to the app.
// ─────────────────────────────────────────────────────────────────────────────

// ── Provider registry ────────────────────────────────────────────────────────
export const PROVIDERS = {
  slack: {
    label: 'Slack',
    authorizeUrl: 'https://slack.com/oauth/v2/authorize',
    tokenUrl: 'https://slack.com/api/oauth.v2.access',
    scopeSep: ',',                       // Slack uses comma-separated scope
    clientIdEnv: 'SLACK_CLIENT_ID',
    clientSecretEnv: 'SLACK_CLIENT_SECRET',
    // Bot scopes — full read + action toolset (parity with the connector below).
    scopes: [
      'channels:read', 'channels:history', 'channels:manage',
      'groups:read', 'groups:write', 'groups:history',
      'im:read', 'im:write', 'im:history', 'mpim:read', 'mpim:history',
      'chat:write', 'reactions:read', 'reactions:write',
      'users:read', 'users:read.email', 'team:read',
      'reminders:write', 'canvases:write', 'app_mentions:read',
    ],
    // User scopes — only what truly needs a user token: search, status, profile.
    userScopes: ['search:read', 'users.profile:write'],
    parseToken: (d) => {
      if (d.ok === false) throw new Error(`slack: ${d.error || 'oauth error'}`);
      return {
        access_token: d.access_token,                 // bot token
        user_token: d.authed_user?.access_token || null,
        refresh_token: d.refresh_token || null,       // only if token rotation is on
        expires_in: d.expires_in || null,
        scopes: (d.scope || '').split(',').filter(Boolean),
        external_account: d.team?.name || d.team?.id || null,
        metadata: {
          team: d.team || null, bot_user_id: d.bot_user_id || null,
          authed_user: d.authed_user?.id || null, app_id: d.app_id || null,
          user_scopes: (d.authed_user?.scope || '').split(',').filter(Boolean),
        },
      };
    },
  },

  // ── P0 connectors from INTEGRATIONS.md — 🔑-ready (need <PROVIDER>_CLIENT_ID/SECRET) ──
  github: {
    label: 'GitHub',
    authorizeUrl: 'https://github.com/login/oauth/authorize',
    tokenUrl: 'https://github.com/login/oauth/access_token',
    clientIdEnv: 'GITHUB_CLIENT_ID',
    clientSecretEnv: 'GITHUB_CLIENT_SECRET',
    scopes: ['repo', 'read:org', 'read:user'],
    parseToken: (d) => {
      if (d.error) throw new Error(`github: ${d.error_description || d.error}`);
      return { access_token: d.access_token, scopes: (d.scope || '').split(',').filter(Boolean), external_account: null, metadata: {} };
    },
  },
  notion: {
    label: 'Notion',
    authorizeUrl: 'https://api.notion.com/v1/oauth/authorize',
    tokenUrl: 'https://api.notion.com/v1/oauth/token',
    tokenAuth: 'basic',                    // Notion: Basic client auth + JSON body
    clientIdEnv: 'NOTION_CLIENT_ID',
    clientSecretEnv: 'NOTION_CLIENT_SECRET',
    scopes: [],
    responseType: 'code',
    authExtra: { owner: 'user' },
    parseToken: (d) => {
      if (d.error) throw new Error(`notion: ${d.error_description || d.error}`);
      return { access_token: d.access_token, scopes: [], external_account: d.workspace_name || null, metadata: { workspace_id: d.workspace_id, bot_id: d.bot_id } };
    },
  },
  google: {
    label: 'Google Drive',
    authorizeUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
    tokenUrl: 'https://oauth2.googleapis.com/token',
    clientIdEnv: 'GOOGLE_CLIENT_ID',
    clientSecretEnv: 'GOOGLE_CLIENT_SECRET',
    scopes: ['https://www.googleapis.com/auth/drive.readonly', 'https://www.googleapis.com/auth/userinfo.email'],
    responseType: 'code',
    authExtra: { access_type: 'offline', prompt: 'consent' },
    parseToken: (d) => {
      if (d.error) throw new Error(`google: ${d.error_description || d.error}`);
      return { access_token: d.access_token, refresh_token: d.refresh_token || null, expires_in: d.expires_in || null, scopes: (d.scope || '').split(' ').filter(Boolean), external_account: null, metadata: {} };
    },
  },
};

export function providerConfigured(provider) {
  const cfg = PROVIDERS[provider];
  return !!(cfg && process.env[cfg.clientIdEnv] && process.env[cfg.clientSecretEnv]);
}

// ── Redirect URI — derived from the request host so prod & preview both work
// (register each in the provider app). Always the clean /api/oauth path. ──────
export function getRedirectUri(req) {
  const host = req.headers['x-forwarded-host'] || req.headers.host;
  const proto = (req.headers['x-forwarded-proto'] || 'https').split(',')[0];
  const base = process.env.OAUTH_REDIRECT_BASE || `${proto}://${host}`;
  return `${base.replace(/\/$/, '')}/api/oauth`;
}

// ── Signed state (HMAC) so the unauthenticated callback can trust workspace/user ─
function stateSecret() {
  return process.env.OAUTH_STATE_SECRET || process.env.ENCRYPTION_KEY || 'workdaemon-dev-secret';
}
export function signState(payload) {
  const body = Buffer.from(JSON.stringify({ ...payload, exp: Date.now() + 10 * 60 * 1000 })).toString('base64url');
  const sig = crypto.createHmac('sha256', stateSecret()).update(body).digest('base64url');
  return `${body}.${sig}`;
}
export function verifyState(token) {
  if (typeof token !== 'string' || !token.includes('.')) return null;
  const [body, sig] = token.split('.');
  const expected = crypto.createHmac('sha256', stateSecret()).update(body).digest('base64url');
  if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
  try {
    const data = JSON.parse(Buffer.from(body, 'base64url').toString());
    if (!data.exp || data.exp < Date.now()) return null;
    return data;
  } catch { return null; }
}

// ── Build the provider consent URL ───────────────────────────────────────────
export function buildAuthorizeUrl(provider, { state, redirectUri }) {
  const cfg = PROVIDERS[provider];
  const params = new URLSearchParams({
    client_id: process.env[cfg.clientIdEnv],
    redirect_uri: redirectUri,
    state,
  });
  if (cfg.scopes?.length) params.set('scope', cfg.scopes.join(cfg.scopeSep || ' '));
  if (cfg.userScopes?.length) params.set('user_scope', cfg.userScopes.join(cfg.scopeSep || ' '));
  if (cfg.responseType) params.set('response_type', cfg.responseType);
  for (const [k, v] of Object.entries(cfg.authExtra || {})) params.set(k, v);
  return `${cfg.authorizeUrl}?${params}`;
}

// ── Exchange the authorization code for tokens ───────────────────────────────
export async function exchangeCode(provider, code, redirectUri) {
  const cfg = PROVIDERS[provider];
  const headers = { accept: 'application/json' };
  let body;
  if (cfg.tokenAuth === 'basic') {
    // Notion-style: HTTP Basic client auth + JSON body.
    headers.Authorization = 'Basic ' + Buffer.from(`${process.env[cfg.clientIdEnv]}:${process.env[cfg.clientSecretEnv]}`).toString('base64');
    headers['content-type'] = 'application/json';
    body = JSON.stringify({ grant_type: 'authorization_code', code, redirect_uri: redirectUri });
  } else {
    headers['content-type'] = 'application/x-www-form-urlencoded';
    body = new URLSearchParams({
      client_id: process.env[cfg.clientIdEnv],
      client_secret: process.env[cfg.clientSecretEnv],
      code, redirect_uri: redirectUri, grant_type: 'authorization_code',
    });
  }
  const r = await fetch(cfg.tokenUrl, { method: 'POST', headers, body });
  const d = await r.json();
  if (!r.ok && d.ok === undefined && !d.access_token) throw new Error(`token exchange http ${r.status}`);
  return cfg.parseToken(d);
}

// ── Persist (encrypted) ──────────────────────────────────────────────────────
export async function storeIntegration(db, { workspaceId, provider, parsed, userId }) {
  const expiresAt = parsed.expires_in ? new Date(Date.now() + parsed.expires_in * 1000).toISOString() : null;
  const { error } = await db.from('workspace_integrations').upsert({
    workspace_id:     workspaceId,
    provider,
    status:           'connected',
    access_token:     parsed.access_token ? encryptSecret(parsed.access_token) : null,
    user_token:       parsed.user_token ? encryptSecret(parsed.user_token) : null,
    refresh_token:    parsed.refresh_token ? encryptSecret(parsed.refresh_token) : null,
    token_expires_at: expiresAt,
    scopes:           parsed.scopes || [],
    external_account: parsed.external_account || null,
    metadata:         parsed.metadata || {},
    connected_by:     userId || null,
    updated_at:       new Date().toISOString(),
  }, { onConflict: 'workspace_id,provider' });
  if (error) throw new Error(`store integration: ${error.message}`);
}

// ── Load a connected integration's decrypted token (for connectors) ──────────
// kind: 'bot' (default, the workspace token) | 'user' (acting-user token).
export async function getAccessToken(db, workspaceId, provider, kind = 'bot') {
  const { data } = await db.from('workspace_integrations')
    .select('access_token, user_token, status').eq('workspace_id', workspaceId).eq('provider', provider).single();
  if (!data || data.status !== 'connected') return null;
  const enc = kind === 'user' ? data.user_token : data.access_token;
  return enc ? decryptSecret(enc) : null;
}

// ── The unauthenticated callback (called from settings.js before requireAuth) ─
function redirect(res, path) { res.setHeader('Location', path); res.statusCode = 302; res.end(); }

export async function handleOAuthCallback(req, res, db) {
  const { code, state, error } = req.query || {};
  if (error) return redirect(res, `/app/integrations?error=${encodeURIComponent(String(error).slice(0, 60))}`);
  const st = verifyState(state);
  if (!st || !code) return redirect(res, '/app/integrations?error=invalid_state');
  const provider = st.provider;
  if (!PROVIDERS[provider]) return redirect(res, '/app/integrations?error=unknown_provider');
  try {
    const parsed = await exchangeCode(provider, code, getRedirectUri(req));
    await storeIntegration(db, { workspaceId: st.workspace_id, provider, parsed, userId: st.user_id });
    console.log('[oauth] connected provider=%s ws=%s', provider, st.workspace_id);
    return redirect(res, `/app/integrations?connected=${provider}`);
  } catch (e) {
    console.error('[oauth] callback provider=%s error=%s', provider, e.message);
    return redirect(res, `/app/integrations?error=connect_failed`);
  }
}
