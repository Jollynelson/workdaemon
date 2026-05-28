import { adminClient } from '../_lib/supabase.js';

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const slug = (req.query.slug || '').toLowerCase().trim();
  if (slug.length < 2) return res.status(400).json({ error: 'Slug too short' });
  if (!/^[a-z0-9-]+$/.test(slug)) return res.status(400).json({ available: false, slug });

  const { data } = await adminClient()
    .from('workspaces')
    .select('id')
    .eq('slug', slug)
    .maybeSingle();

  return res.status(200).json({ available: !data, slug });
}
