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
      'channels:read', 'channels:history', 'channels:manage', 'channels:join',
      'groups:read', 'groups:write', 'groups:history',
      'im:read', 'im:write', 'im:history', 'mpim:read', 'mpim:history',
      'chat:write', 'reactions:read', 'reactions:write',
      'users:read', 'users:read.email', 'team:read',
      'canvases:write', 'app_mentions:read',
      'pins:read', 'files:read',
    ],
    // User scopes — a staff member's OWN token. Two jobs: (1) the Brain reads what
    // THEY can see (incl. private channels) without a bot invite; (2) their own
    // daemon ACTS AS THEM — reads their 1:1 DMs (im:history) and posts as them
    // (chat:write). Personal DMs stay with the individual's daemon; the shared
    // Brain ingest still excludes `im` (see connectors/slack.js ingest()).
    userScopes: [
      'search:read', 'users.profile:write',
      'channels:read', 'channels:history',
      'groups:read', 'groups:history',          // private channels the user is in
      'mpim:read', 'mpim:history',
      'im:read', 'im:history',                  // their own 1:1 DMs (daemon acts as them)
      'chat:write',                             // post AS the user (Phase 2 actions)
      'users:read',                             // resolve DM-partner / mention names
      'pins:read', 'files:read',
    ],
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
      // A GitHub OAuth token IS the connecting user's own token, so store it as the
      // per-staff user_token too — lets each staff act on GitHub as themselves.
      return { access_token: d.access_token, user_token: d.access_token, scopes: (d.scope || '').split(',').filter(Boolean), external_account: null, metadata: {} };
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
    label: 'Google Workspace',
    // Umbrella: one connect grants all Google apps; covered sub-apps show connected.
    covers: ['gdrive', 'gmail', 'gcal'],
    authorizeUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
    tokenUrl: 'https://oauth2.googleapis.com/token',
    clientIdEnv: 'GOOGLE_CLIENT_ID',
    clientSecretEnv: 'GOOGLE_CLIENT_SECRET',
    scopes: [
      'https://www.googleapis.com/auth/drive.readonly',
      'https://www.googleapis.com/auth/drive.file',        // create/manage files the app makes (gdrive.create_doc)
      'https://www.googleapis.com/auth/gmail.readonly',
      'https://www.googleapis.com/auth/gmail.send',         // send email (gmail.send)
      'https://www.googleapis.com/auth/calendar.readonly',
      'https://www.googleapis.com/auth/calendar.events',    // create events (gcal.create_event)
      'https://www.googleapis.com/auth/userinfo.email',
    ],
    responseType: 'code',
    authExtra: { access_type: 'offline', prompt: 'consent' },
    parseToken: (d) => {
      if (d.error) throw new Error(`google: ${d.error_description || d.error}`);
      return { access_token: d.access_token, refresh_token: d.refresh_token || null, expires_in: d.expires_in || null, scopes: (d.scope || '').split(' ').filter(Boolean), external_account: null, metadata: {} };
    },
  },
  // Google Drive AS ITS OWN integration — a dedicated OAuth app (its own
  // GDRIVE_CLIENT_ID/SECRET, e.g. "WorkDaemon for Google Drive"), separate from
  // native sign-in (GOOGLE_CLIENT_ID) so the Drive consent + token are Drive-scoped
  // and independent. Connecting it ingests Drive files into the brain.
  gdrive: {
    label: 'Google Drive',
    authorizeUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
    tokenUrl: 'https://oauth2.googleapis.com/token',
    clientIdEnv: 'GDRIVE_CLIENT_ID',
    clientSecretEnv: 'GDRIVE_CLIENT_SECRET',
    scopes: [
      'https://www.googleapis.com/auth/drive.readonly',
      'https://www.googleapis.com/auth/drive.metadata.readonly',
      'https://www.googleapis.com/auth/userinfo.email',
    ],
    responseType: 'code',
    authExtra: { access_type: 'offline', prompt: 'consent' },
    parseToken: (d) => {
      if (d.error) throw new Error(`gdrive: ${d.error_description || d.error}`);
      return { access_token: d.access_token, refresh_token: d.refresh_token || null, expires_in: d.expires_in || null, scopes: (d.scope || '').split(' ').filter(Boolean), external_account: null, metadata: {} };
    },
  },
  // Gmail as its own integration (dedicated OAuth app, Gmail-scoped).
  gmail: {
    label: 'Gmail',
    authorizeUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
    tokenUrl: 'https://oauth2.googleapis.com/token',
    clientIdEnv: 'GMAIL_CLIENT_ID',
    clientSecretEnv: 'GMAIL_CLIENT_SECRET',
    scopes: [
      'https://www.googleapis.com/auth/gmail.readonly',
      'https://www.googleapis.com/auth/userinfo.email',
    ],
    responseType: 'code',
    authExtra: { access_type: 'offline', prompt: 'consent' },
    parseToken: (d) => {
      if (d.error) throw new Error(`gmail: ${d.error_description || d.error}`);
      return { access_token: d.access_token, refresh_token: d.refresh_token || null, expires_in: d.expires_in || null, scopes: (d.scope || '').split(' ').filter(Boolean), external_account: null, metadata: {} };
    },
  },
  // Google Calendar as its own integration (dedicated OAuth app, Calendar-scoped).
  gcal: {
    label: 'Google Calendar',
    authorizeUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
    tokenUrl: 'https://oauth2.googleapis.com/token',
    clientIdEnv: 'GCAL_CLIENT_ID',
    clientSecretEnv: 'GCAL_CLIENT_SECRET',
    scopes: [
      'https://www.googleapis.com/auth/calendar.readonly',
      'https://www.googleapis.com/auth/userinfo.email',
    ],
    responseType: 'code',
    authExtra: { access_type: 'offline', prompt: 'consent' },
    parseToken: (d) => {
      if (d.error) throw new Error(`gcal: ${d.error_description || d.error}`);
      return { access_token: d.access_token, refresh_token: d.refresh_token || null, expires_in: d.expires_in || null, scopes: (d.scope || '').split(' ').filter(Boolean), external_account: null, metadata: {} };
    },
  },
  microsoft: {
    label: 'Microsoft 365',
    authorizeUrl: 'https://login.microsoftonline.com/common/oauth2/v2.0/authorize',
    tokenUrl: 'https://login.microsoftonline.com/common/oauth2/v2.0/token',
    clientIdEnv: 'MICROSOFT_CLIENT_ID',
    clientSecretEnv: 'MICROSOFT_CLIENT_SECRET',
    scopes: ['offline_access', 'User.Read', 'Mail.Read', 'Calendars.Read', 'Files.Read.All'],
    responseType: 'code',
    parseToken: (d) => {
      if (d.error) throw new Error(`microsoft: ${d.error_description || d.error}`);
      return { access_token: d.access_token, refresh_token: d.refresh_token || null, expires_in: d.expires_in || null, scopes: (d.scope || '').split(' ').filter(Boolean), external_account: null, metadata: {} };
    },
  },
  atlassian: {
    label: 'Jira / Confluence',
    authorizeUrl: 'https://auth.atlassian.com/authorize',
    tokenUrl: 'https://auth.atlassian.com/oauth/token',
    tokenBody: 'json',
    clientIdEnv: 'ATLASSIAN_CLIENT_ID',
    clientSecretEnv: 'ATLASSIAN_CLIENT_SECRET',
    scopes: ['read:jira-work', 'write:jira-work', 'read:jira-user', 'offline_access'],
    responseType: 'code',
    authExtra: { audience: 'api.atlassian.com', prompt: 'consent' },
    parseToken: (d) => {
      if (d.error) throw new Error(`atlassian: ${d.error_description || d.error}`);
      return { access_token: d.access_token, refresh_token: d.refresh_token || null, expires_in: d.expires_in || null, scopes: (d.scope || '').split(' ').filter(Boolean), external_account: null, metadata: {} };
    },
  },
  salesforce: {
    label: 'Salesforce',
    authorizeUrl: 'https://login.salesforce.com/services/oauth2/authorize',
    tokenUrl: 'https://login.salesforce.com/services/oauth2/token',
    clientIdEnv: 'SALESFORCE_CLIENT_ID',
    clientSecretEnv: 'SALESFORCE_CLIENT_SECRET',
    scopes: ['api', 'refresh_token'],
    responseType: 'code',
    parseToken: (d) => {
      if (d.error) throw new Error(`salesforce: ${d.error_description || d.error}`);
      return { access_token: d.access_token, refresh_token: d.refresh_token || null, scopes: [], external_account: null, metadata: { instance_url: d.instance_url } };
    },
  },
  hubspot: {
    label: 'HubSpot',
    authorizeUrl: 'https://app.hubspot.com/oauth/authorize',
    tokenUrl: 'https://api.hubapi.com/oauth/v1/token',
    clientIdEnv: 'HUBSPOT_CLIENT_ID',
    clientSecretEnv: 'HUBSPOT_CLIENT_SECRET',
    scopes: ['crm.objects.contacts.read', 'crm.objects.deals.read'],
    responseType: 'code',
    parseToken: (d) => {
      if (d.error) throw new Error(`hubspot: ${d.message || d.error}`);
      return { access_token: d.access_token, refresh_token: d.refresh_token || null, expires_in: d.expires_in || null, scopes: [], external_account: null, metadata: {} };
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
// FAIL CLOSED: no configured secret → throw, never fall back to a guessable
// constant (that would let an attacker forge OAuth callback state).
function stateSecret() {
  const s = process.env.OAUTH_STATE_SECRET || process.env.ENCRYPTION_KEY;
  if (!s) throw new Error('OAUTH_STATE_SECRET (or ENCRYPTION_KEY) is not configured');
  return s;
}
export function signState(payload) {
  const body = Buffer.from(JSON.stringify({ ...payload, exp: Date.now() + 10 * 60 * 1000 })).toString('base64url');
  const sig = crypto.createHmac('sha256', stateSecret()).update(body).digest('base64url');
  return `${body}.${sig}`;
}
export function verifyState(token) {
  if (typeof token !== 'string' || !token.includes('.')) return null;
  const [body, sig] = token.split('.');
  let expected;
  try { expected = crypto.createHmac('sha256', stateSecret()).update(body).digest('base64url'); }
  catch { return null; } // no secret configured → nothing verifies
  const a = Buffer.from(sig), b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
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
  } else if (cfg.tokenBody === 'json') {
    // Atlassian-style: JSON body with client creds inline.
    headers['content-type'] = 'application/json';
    body = JSON.stringify({ grant_type: 'authorization_code', client_id: process.env[cfg.clientIdEnv], client_secret: process.env[cfg.clientSecretEnv], code, redirect_uri: redirectUri });
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

// Like getAccessToken but refreshes an expired OAuth2 token via its refresh_token
// (Google/Microsoft/Atlassian expire hourly; Slack/Notion/GitHub are long-lived
// and return the stored token unchanged). Used by the action executor so a
// staged action's "Verify & Apply" never fails on a stale token.
export async function getFreshAccessToken(db, workspaceId, provider) {
  const { data } = await db.from('workspace_integrations')
    .select('access_token, refresh_token, token_expires_at, status').eq('workspace_id', workspaceId).eq('provider', provider).single();
  if (!data || data.status !== 'connected') return null;
  const expired = data.token_expires_at && new Date(data.token_expires_at).getTime() - 60000 <= Date.now();
  if (!expired) return data.access_token ? decryptSecret(data.access_token) : null;
  if (!data.refresh_token) return data.access_token ? decryptSecret(data.access_token) : null;

  const cfg = PROVIDERS[provider];
  try {
    const params = new URLSearchParams({
      client_id: process.env[cfg.clientIdEnv] || '',
      client_secret: process.env[cfg.clientSecretEnv] || '',
      refresh_token: decryptSecret(data.refresh_token),
      grant_type: 'refresh_token',
    });
    const r = await fetch(cfg.tokenUrl, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: params });
    const d = await r.json().catch(() => ({}));
    if (!r.ok || !d.access_token) return data.access_token ? decryptSecret(data.access_token) : null;
    const expiresAt = d.expires_in ? new Date(Date.now() + d.expires_in * 1000).toISOString() : null;
    await db.from('workspace_integrations').update({
      access_token: encryptSecret(d.access_token), token_expires_at: expiresAt, updated_at: new Date().toISOString(),
    }).eq('workspace_id', workspaceId).eq('provider', provider);
    return d.access_token;
  } catch (e) {
    console.error('[oauth] refresh %s:', provider, e.message);
    return data.access_token ? decryptSecret(data.access_token) : null;
  }
}

// ── Per-staff tokens (each staff connects their own daemon) ──────────────────
export async function storeUserIntegration(db, { workspaceId, userId, provider, parsed }) {
  if (!userId || !parsed?.user_token) return;   // nothing to store without a user token
  const { error } = await db.from('user_integrations').upsert({
    workspace_id:     workspaceId,
    user_id:          userId,
    provider,
    user_token:       encryptSecret(parsed.user_token),
    scopes:           parsed.metadata?.user_scopes || [],
    external_account: parsed.external_account || null,
    metadata:         { authed_user: parsed.metadata?.authed_user || null },
    updated_at:       new Date().toISOString(),
  }, { onConflict: 'workspace_id,user_id,provider' });
  if (error) console.error('[oauth] storeUserIntegration:', error.message);
}

// One staff member's own connected token (decrypted), or null. Lets an executor
// act AS the requesting staff (their OAuth grant) instead of the workspace token.
export async function getUserToken(db, workspaceId, userId, provider) {
  if (!userId) return null;
  const { data } = await db.from('user_integrations')
    .select('user_token').eq('workspace_id', workspaceId).eq('user_id', userId).eq('provider', provider).maybeSingle();
  return data?.user_token ? decryptSecret(data.user_token) : null;
}

// All staff user tokens for a provider (decrypted) — for per-user ingest.
export async function getUserTokens(db, workspaceId, provider) {
  const { data } = await db.from('user_integrations')
    .select('user_id, user_token').eq('workspace_id', workspaceId).eq('provider', provider);
  return (data || []).filter(r => r.user_token).map(r => ({ userId: r.user_id, token: decryptSecret(r.user_token) }));
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
    // Also capture the connecting staff member's own user token (per-staff ingest).
    await storeUserIntegration(db, { workspaceId: st.workspace_id, userId: st.user_id, provider, parsed });
    // Stage 4: on a Hermes workspace, connecting a tool adds its MCP server to the
    // staff's agent (the agent then acts on it itself — no executor). Inert + best-
    // effort: a no-op for non-Hermes workspaces and never blocks the OAuth callback.
    try {
      const { connectTool } = await import('./hermes_admin.js');
      await connectTool(db, st.workspace_id, { staffId: st.user_id, provider });
    } catch (e) { console.error('[oauth] hermes connect_tool:', e.message); }
    console.log('[oauth] connected provider=%s ws=%s user=%s', provider, st.workspace_id, st.user_id);
    return redirect(res, `/app/integrations?connected=${provider}`);
  } catch (e) {
    console.error('[oauth] callback provider=%s error=%s', provider, e.message);
    return redirect(res, `/app/integrations?error=connect_failed`);
  }
}
