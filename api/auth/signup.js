import { createClient } from '@supabase/supabase-js';
import { enforceRateLimit, clientIp, parseBody } from '../_lib/security.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  // Strict, schema-based validation: valid email + 8–200 char password, no extras.
  const body = parseBody(res, req.body, {
    email:    { type: 'email',  required: true },
    password: { type: 'string', required: true, min: 8, max: 200, trim: false },
  });
  if (!body) return;
  const { email, password } = body;

  // Abuse guard: cap signups per IP (mass account creation / enumeration).
  if (!(await enforceRateLimit(res, { key: `signup:ip:${clientIp(req)}`, max: 5, windowSec: 3600 }))) return;

  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);
  const { data, error } = await supabase.auth.signUp({ email, password });

  if (error) return res.status(400).json({ error: error.message });

  // Supabase returns session: null when email confirmation is required
  if (!data.session) {
    return res.status(200).json({ user: data.user, access_token: null, requiresConfirmation: true });
  }

  return res.status(200).json({
    user: data.user,
    access_token: data.session.access_token,
    refresh_token: data.session.refresh_token,
  });
}
