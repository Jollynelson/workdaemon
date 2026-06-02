import { createClient } from '@supabase/supabase-js';
import { enforceRateLimit, clientIp, parseBody } from '../_lib/security.js';

export default async function handler(req, res) {
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
