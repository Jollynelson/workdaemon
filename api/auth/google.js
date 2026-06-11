import crypto from 'node:crypto';
import { encryptSecret } from '../_lib/security.js';

// Generate a signed state token to prevent CSRF
function generateState() {
  const payload = { exp: Date.now() + 10 * 60 * 1000 }; // 10 min expiry
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sig = crypto.createHmac('sha256', process.env.ENCRYPTION_KEY).update(body).digest('base64url');
  return `${body}.${sig}`;
}

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  // Validate Google OAuth is configured
  if (!process.env.GOOGLE_CLIENT_ID || !process.env.GOOGLE_CLIENT_SECRET) {
    return res.status(503).json({ error: 'Google OAuth is not configured' });
  }

  const state = generateState();
  const redirectUri = `${process.env.OAUTH_REDIRECT_BASE || `https://${req.headers.host}`}/api/auth/google-callback`;

  // Build Google OAuth consent URL
  const params = new URLSearchParams({
    client_id: process.env.GOOGLE_CLIENT_ID,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: 'openid email profile',
    state,
    access_type: 'offline',
    prompt: 'consent',
  });

  const consentUrl = `https://accounts.google.com/o/oauth2/v2/auth?${params}`;

  // Store state in session (client will need to return it)
  return res.status(200).json({ url: consentUrl });
}
