import crypto from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import { enforceRateLimit, clientIp, parseBody } from '../_lib/security.js';

// ─────────────────────────────────────────────────────────────────────────────
// Auth entry point. Hosts THREE logical routes inside one serverless function
// (Vercel Hobby caps a deployment at 12 functions and api/ is at the cap):
//   • POST /api/auth/login                  → email + password sign-in
//   • GET  /api/auth/google                 → start native Google OAuth (rewrite)
//   • GET  /api/auth/google-callback        → Google redirects here (rewrite)
// The /api/auth/google* paths are mapped to this file by rewrites in vercel.json.
//
// Native Google flow (so the consent screen reads app.workdaemon.com, NOT the
// supabase.co project host): we run the OAuth dance ourselves, then mint a real
// Supabase session for the user via admin generateLink → verifyOtp (there is no
// admin.createSession), and hand the tokens to the SPA through the URL fragment.
// ─────────────────────────────────────────────────────────────────────────────

const GOOGLE_AUTH_URL  = 'https://accounts.google.com/o/oauth2/v2/auth';
const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const GOOGLE_USERINFO  = 'https://openidconnect.googleapis.com/v1/userinfo';

function stateSecret() {
  const s = process.env.OAUTH_STATE_SECRET || process.env.ENCRYPTION_KEY;
  if (!s) throw new Error('OAUTH_STATE_SECRET (or ENCRYPTION_KEY) is not configured');
  return s;
}
function signState() {
  const body = Buffer.from(JSON.stringify({ exp: Date.now() + 10 * 60 * 1000 })).toString('base64url');
  const sig = crypto.createHmac('sha256', stateSecret()).update(body).digest('base64url');
  return `${body}.${sig}`;
}
function verifyState(token) {
  if (typeof token !== 'string' || !token.includes('.')) return false;
  const [body, sig] = token.split('.');
  let expected;
  try { expected = crypto.createHmac('sha256', stateSecret()).update(body).digest('base64url'); }
  catch { return false; }
  const a = Buffer.from(sig), b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return false;
  try {
    const data = JSON.parse(Buffer.from(body, 'base64url').toString());
    return !!(data.exp && data.exp >= Date.now());
  } catch { return false; }
}

function googleRedirectUri(req) {
  const base = process.env.OAUTH_REDIRECT_BASE || `https://${req.headers['x-forwarded-host'] || req.headers.host}`;
  return `${base.replace(/\/$/, '')}/api/auth/google-callback`;
}

function redirect(res, location) {
  res.setHeader('Location', location);
  res.statusCode = 302;
  res.end();
}

// Mint a real Supabase session for an email (creating the user on first sign-in).
// Uses the admin generateLink → public verifyOtp exchange (no admin.createSession).
async function sessionForEmail(email, metadata) {
  const admin = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

  async function genLink() {
    return admin.auth.admin.generateLink({ type: 'magiclink', email });
  }

  let { data, error } = await genLink();
  if (error) {
    // First sign-in: the user doesn't exist yet — create then retry.
    const { error: createErr } = await admin.auth.admin.createUser({
      email, email_confirm: true, user_metadata: metadata || {},
    });
    if (createErr && !/already|registered|exists/i.test(createErr.message)) {
      throw new Error(`user create: ${createErr.message}`);
    }
    ({ data, error } = await genLink());
    if (error) throw new Error(`generate link: ${error.message}`);
  }

  const tokenHash = data?.properties?.hashed_token;
  if (!tokenHash) throw new Error('no token hash from generateLink');

  // Exchange the one-time hash for a session (public client, anon key).
  const pub = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);
  const { data: verified, error: vErr } = await pub.auth.verifyOtp({ token_hash: tokenHash, type: 'magiclink' });
  if (vErr) throw new Error(`verify otp: ${vErr.message}`);
  if (!verified?.session) throw new Error('no session from verifyOtp');
  return verified.session;
}

export default async function handler(req, res) {
  // ── GET: native Google OAuth (start + callback), mapped here via rewrites ──
  if (req.method === 'GET') {
    const phase = req.query.__google;

    if (!process.env.GOOGLE_CLIENT_ID || !process.env.GOOGLE_CLIENT_SECRET) {
      if (phase === 'callback') return redirect(res, '/login?error=google_not_configured');
      return res.status(503).json({ error: 'Google sign-in is not configured' });
    }

    // 1) START → return the Google consent URL for the SPA to send the user to.
    if (phase === 'start') {
      if (!(await enforceRateLimit(res, { key: `gstart:ip:${clientIp(req)}`, max: 20, windowSec: 300 }))) return;
      const params = new URLSearchParams({
        client_id: process.env.GOOGLE_CLIENT_ID,
        redirect_uri: googleRedirectUri(req),
        response_type: 'code',
        scope: 'openid email profile',
        state: signState(),
        access_type: 'online',
        prompt: 'select_account',
      });
      return res.status(200).json({ url: `${GOOGLE_AUTH_URL}?${params}` });
    }

    // 2) CALLBACK → Google redirected back with ?code&state.
    if (phase === 'callback') {
      const { code, state, error } = req.query;
      if (error) return redirect(res, `/login?error=${encodeURIComponent(String(error).slice(0, 80))}`);
      if (!code) return redirect(res, '/login?error=invalid_code');
      if (!verifyState(state)) return redirect(res, '/login?error=invalid_state');

      try {
        // Exchange the code for Google tokens.
        const tokenRes = await fetch(GOOGLE_TOKEN_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({
            client_id: process.env.GOOGLE_CLIENT_ID,
            client_secret: process.env.GOOGLE_CLIENT_SECRET,
            code, grant_type: 'authorization_code',
            redirect_uri: googleRedirectUri(req),
          }),
        });
        const tok = await tokenRes.json();
        if (!tok.access_token) throw new Error(tok.error_description || tok.error || 'token exchange failed');

        // Who is it?
        const uiRes = await fetch(GOOGLE_USERINFO, { headers: { Authorization: `Bearer ${tok.access_token}` } });
        const info = await uiRes.json();
        if (!info.email || info.email_verified === false) throw new Error('no verified email from Google');

        // Mint a Supabase session (create user on first sign-in).
        const session = await sessionForEmail(info.email, { full_name: info.name, avatar_url: info.picture });

        // Hand tokens to the SPA via the URL fragment — Supabase's detectSessionInUrl
        // consumes this implicit-grant format and fires SIGNED_IN.
        const frag = new URLSearchParams({
          access_token: session.access_token,
          refresh_token: session.refresh_token,
          expires_in: String(session.expires_in ?? 3600),
          token_type: 'bearer',
        });
        return redirect(res, `/app#${frag}`);
      } catch (e) {
        console.error('[auth/google] callback:', e.message);
        return redirect(res, '/login?error=google_signin_failed');
      }
    }

    return res.status(400).json({ error: 'Unknown auth action' });
  }

  // ── POST: email + password sign-in ───────────────────────────────────────
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  // Strict, schema-based validation (type checks, length limits, no extra fields).
  const body = parseBody(res, req.body, {
    email:    { type: 'email',  required: true },
    password: { type: 'string', required: true, min: 1, max: 200, trim: false },
  });
  if (!body) return;
  const { email, password } = body;

  // Brute-force / credential-stuffing guard: limit by IP and by target account.
  if (!(await enforceRateLimit(res, { key: `login:ip:${clientIp(req)}`, max: 10, windowSec: 300 }))) return;
  if (!(await enforceRateLimit(res, { key: `login:email:${email}`, max: 5, windowSec: 900 }))) return;

  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });

  if (error) return res.status(401).json({ error: error.message });

  return res.status(200).json({
    user: data.user,
    access_token: data.session.access_token,
    refresh_token: data.session.refresh_token,
  });
}
