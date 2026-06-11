import { createClient } from '@supabase/supabase-js';
import crypto from 'node:crypto';

// Verify CSRF state token
function verifyState(token) {
  if (typeof token !== 'string' || !token.includes('.')) return null;
  const [body, sig] = token.split('.');
  try {
    const expected = crypto.createHmac('sha256', process.env.ENCRYPTION_KEY).update(body).digest('base64url');
    const a = Buffer.from(sig), b = Buffer.from(expected);
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
    const data = JSON.parse(Buffer.from(body, 'base64url').toString());
    if (!data.exp || data.exp < Date.now()) return null;
    return data;
  } catch { return null; }
}

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const { code, error, error_description, state } = req.query;

  // Handle OAuth errors from Google
  if (error) {
    const msg = error_description || error;
    return res.redirect(`/login?error=${encodeURIComponent(msg.slice(0, 100))}`);
  }

  if (!code) {
    return res.redirect('/login?error=invalid_code');
  }

  // Verify CSRF state token
  if (!state || !verifyState(state)) {
    return res.redirect('/login?error=invalid_state');
  }

  try {
    // Exchange authorization code for tokens
    const tokenUrl = 'https://oauth2.googleapis.com/token';
    const tokenParams = new URLSearchParams({
      client_id: process.env.GOOGLE_CLIENT_ID,
      client_secret: process.env.GOOGLE_CLIENT_SECRET,
      code,
      grant_type: 'authorization_code',
      redirect_uri: `${process.env.OAUTH_REDIRECT_BASE || `https://${req.headers.host}`}/api/auth/google-callback`,
    });

    const tokenRes = await fetch(tokenUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: tokenParams,
    });

    const tokenData = await tokenRes.json();
    if (!tokenData.access_token) {
      throw new Error(tokenData.error || 'Token exchange failed');
    }

    // Get user info from Google
    const userInfoRes = await fetch('https://openidconnect.googleapis.com/v1/userinfo', {
      headers: { Authorization: `Bearer ${tokenData.access_token}` },
    });

    const userInfo = await userInfoRes.json();
    if (!userInfo.email) {
      throw new Error('Could not get email from Google');
    }

    // Sign in or create user via Supabase
    const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

    // Check if user exists
    let { data: existingUser, error: fetchErr } = await supabase
      .from('auth.users')
      .select('id')
      .eq('email', userInfo.email)
      .single();

    if (fetchErr && fetchErr.code !== 'PGRST116') {
      throw new Error(`User lookup failed: ${fetchErr.message}`);
    }

    let userId = existingUser?.id;

    // Create user if doesn't exist
    if (!userId) {
      const { data: authRes, error: authErr } = await supabase.auth.admin.createUser({
        email: userInfo.email,
        email_confirm: true,
        user_metadata: {
          full_name: userInfo.name,
          picture: userInfo.picture,
        },
      });

      if (authErr) {
        throw new Error(`User creation failed: ${authErr.message}`);
      }

      userId = authRes.user.id;
    }

    // Generate a session token using Supabase
    const { data: sessionData, error: sessionErr } = await supabase.auth.admin.createSession(userId);

    if (sessionErr) {
      throw new Error(`Session creation failed: ${sessionErr.message}`);
    }

    // Redirect to app with fragment (preserves session in Supabase SDK)
    // Include access_token in URL fragment for the frontend to establish the session
    const fragment = new URLSearchParams({
      access_token: sessionData.session.access_token,
      refresh_token: sessionData.session.refresh_token,
      type: 'recovery',
    });
    res.setHeader('Location', `/app#${fragment}`);
    res.statusCode = 302;
    res.end();
  } catch (err) {
    console.error('[google-callback]', err.message);
    res.redirect(`/login?error=${encodeURIComponent('Google sign-in failed')}`);
  }
}
