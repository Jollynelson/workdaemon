import { requireAuth, adminClient } from './_lib/supabase.js';

// ── Helpers ───────────────────────────────────────────────────────────────────

async function resolveWorkspace(userId, db) {
  const { data } = await db
    .from('profiles')
    .select('workspace_id, role, title')
    .eq('id', userId)
    .single();
  return data ?? null;
}

async function isMember(userId, workspaceId, db) {
  const { data } = await db
    .from('workspace_members')
    .select('role')
    .eq('user_id', userId)
    .eq('workspace_id', workspaceId)
    .single();
  return data ?? null;
}

// ── Topic tag extraction (keyword-based, no vector DB needed) ─────────────────
function extractTopicTags(message) {
  const stop = new Set([
    'the','a','an','is','are','was','were','be','been','have','has','had',
    'do','does','did','will','would','could','should','can','may','might',
    'what','where','when','how','why','who','which','that','this','these',
    'those','for','and','but','or','nor','yet','so','if','while','with',
    'at','by','from','to','in','on','about','just','my','our','your','their',
    'its','we','they','you','he','she','it','i','need','want','help','know',
    'think','tell','make','get','give','show','find','look','feel','seem',
  ]);
  return message
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, ' ')
    .split(/\s+/)
    .map(w => w.trim())
    .filter(w => w.length > 3 && !stop.has(w))
    .slice(0, 8);
}

// ── Hunt Engine ───────────────────────────────────────────────────────────────
async function runHuntScan(workspaceId, db) {
  const cutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();

  const { data: interactions } = await db
    .from('brain_interactions')
    .select('user_id, user_role, user_message, session_hour, created_at')
    .eq('workspace_id', workspaceId)
    .gte('created_at', cutoff)
    .order('created_at', { ascending: false })
    .limit(300);

  if (!interactions?.length) return { new_findings: 0, scanned: 0 };

  const newFindings = [];

  // ── KNOWLEDGE HUNT: topics asked by 3+ distinct users ──────────────────────
  const topicUsers = {};   // topic_key → Set<user_id>
  const topicRoles = {};   // topic_key → Set<role>
  const topicSamples = {}; // topic_key → example message

  for (const row of interactions) {
    const tags = extractTopicTags(row.user_message);
    for (const tag of tags) {
      if (!topicUsers[tag]) { topicUsers[tag] = new Set(); topicRoles[tag] = new Set(); }
      topicUsers[tag].add(row.user_id);
      if (row.user_role) topicRoles[tag].add(row.user_role);
      if (!topicSamples[tag]) topicSamples[tag] = row.user_message.slice(0, 100);
    }
  }

  for (const [tag, userSet] of Object.entries(topicUsers)) {
    if (userSet.size < 3) continue;
    const roles = [...topicRoles[tag]];
    const occurrences = userSet.size;
    const { data: existing } = await db
      .from('hunt_findings')
      .select('id')
      .eq('workspace_id', workspaceId)
      .eq('hunt_mode', 'knowledge')
      .ilike('pattern', `%${tag}%`)
      .eq('resolved', false)
      .limit(1);
    if (existing?.length) continue;
    newFindings.push({
      workspace_id: workspaceId,
      hunt_mode: 'knowledge',
      pattern: `Multiple staff asking about "${tag}" — example: "${topicSamples[tag]}"`,
      occurrences,
      affected_roles: roles,
      severity: occurrences >= 5 ? 'critical' : 'warning',
      recommendation: `${occurrences} team members queried "${tag}" this month. This signals a knowledge gap — document a clear answer or SOP and surface it proactively.`,
    });
  }

  // ── PERFORMANCE HUNT: after-hours work patterns ────────────────────────────
  const afterHoursUsers = new Set();
  const afterHoursRoles = new Set();
  for (const row of interactions) {
    const h = row.session_hour ?? new Date(row.created_at).getUTCHours();
    if (h < 7 || h > 21) {
      afterHoursUsers.add(row.user_id);
      if (row.user_role) afterHoursRoles.add(row.user_role);
    }
  }
  if (afterHoursUsers.size >= 3) {
    const { data: existingPerf } = await db
      .from('hunt_findings')
      .select('id')
      .eq('workspace_id', workspaceId)
      .eq('hunt_mode', 'performance')
      .ilike('pattern', '%after-hours%')
      .eq('resolved', false)
      .limit(1);
    if (!existingPerf?.length) {
      newFindings.push({
        workspace_id: workspaceId,
        hunt_mode: 'performance',
        pattern: `After-hours work pattern detected — ${afterHoursUsers.size} staff active outside 07:00–21:00`,
        occurrences: afterHoursUsers.size,
        affected_roles: [...afterHoursRoles],
        severity: afterHoursUsers.size >= 5 ? 'critical' : 'warning',
        recommendation: 'Multiple team members are working outside business hours regularly. This may signal unsustainable workload or timezone misalignment — flag to HR for a wellbeing check-in.',
      });
    }
  }

  // ── WASTE HUNT: users repeating the same request ───────────────────────────
  const userMsgCounts = {};
  for (const row of interactions) {
    const key = `${row.user_id}::${extractTopicTags(row.user_message).join(',')}`;
    userMsgCounts[key] = (userMsgCounts[key] || 0) + 1;
  }
  const heavyRepeat = Object.entries(userMsgCounts).filter(([, c]) => c >= 4);
  if (heavyRepeat.length >= 2) {
    const { data: existingWaste } = await db
      .from('hunt_findings')
      .select('id')
      .eq('workspace_id', workspaceId)
      .eq('hunt_mode', 'waste')
      .ilike('pattern', '%repeated requests%')
      .eq('resolved', false)
      .limit(1);
    if (!existingWaste?.length) {
      newFindings.push({
        workspace_id: workspaceId,
        hunt_mode: 'waste',
        pattern: `${heavyRepeat.length} users making repeated identical requests to the Brain`,
        occurrences: heavyRepeat.length,
        affected_roles: [],
        severity: 'info',
        recommendation: 'Staff are asking the same questions repeatedly — the Brain\'s answers may not be landing or the information needs to be more proactively surfaced.',
      });
    }
  }

  if (newFindings.length > 0) {
    await db.from('hunt_findings').insert(newFindings);
  }

  return { new_findings: newFindings.length, scanned: interactions.length };
}

// ── Handler ───────────────────────────────────────────────────────────────────
export default async function handler(req, res) {
  const user = await requireAuth(req, res);
  if (!user) return;

  const db = adminClient();
  const profile = await resolveWorkspace(user.id, db);
  const workspaceId = profile?.workspace_id ?? null;
  if (!workspaceId) return res.status(400).json({ error: 'No workspace' });

  const member = await isMember(user.id, workspaceId, db);
  const isAdmin = member?.role === 'admin';

  const tab = req.query?.tab ?? null;

  // ═══════════════════════════════════════════════════════════════════════════
  // GET /api/brain            → company context (existing)
  // GET /api/brain?tab=hunt   → hunt findings + interaction stats
  // GET /api/brain?tab=agents → agent profiles for workspace (admin)
  // ═══════════════════════════════════════════════════════════════════════════
  if (req.method === 'GET') {

    // ── Hunt findings ─────────────────────────────────────────────────────────
    if (tab === 'hunt') {
      const { data: findings } = await db
        .from('hunt_findings')
        .select('*')
        .eq('workspace_id', workspaceId)
        .eq('resolved', false)
        .order('severity', { ascending: false })
        .order('created_at', { ascending: false })
        .limit(30);

      const cutoff30 = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
      const cutoff7  = new Date(Date.now() -  7 * 24 * 60 * 60 * 1000).toISOString();

      const { data: statsRows } = await db
        .from('brain_interactions')
        .select('user_id, user_role, created_at')
        .eq('workspace_id', workspaceId)
        .gte('created_at', cutoff30);

      const rows = statsRows || [];
      const stats = {
        total_30d: rows.length,
        total_7d:  rows.filter(r => r.created_at >= cutoff7).length,
        unique_users: new Set(rows.map(r => r.user_id)).size,
        unique_roles: new Set(rows.map(r => r.user_role).filter(Boolean)).size,
      };

      const modeCount = {};
      for (const f of findings || []) modeCount[f.hunt_mode] = (modeCount[f.hunt_mode] || 0) + 1;

      return res.status(200).json({ findings: findings || [], stats, mode_counts: modeCount });
    }

    // ── Agent profiles (admin) ────────────────────────────────────────────────
    if (tab === 'agents') {
      if (!isAdmin) return res.status(403).json({ error: 'Admin only' });

      const { data: members } = await db
        .from('workspace_members')
        .select('user_id, role')
        .eq('workspace_id', workspaceId);

      const userIds = (members || []).map(m => m.user_id);

      const { data: profilesData } = await db
        .from('profiles')
        .select('id, name, title, role')
        .in('id', userIds);

      const { data: agentProfiles } = await db
        .from('agent_profiles')
        .select('user_id, access_level, permitted_tools, trust_score, interaction_count, last_calibration')
        .eq('workspace_id', workspaceId);

      const profileMap = Object.fromEntries((agentProfiles || []).map(p => [p.user_id, p]));
      const memberMap  = Object.fromEntries((members || []).map(m => [m.user_id, m]));

      const agents = (profilesData || []).map(p => ({
        user_id: p.id,
        name: p.name || 'Unknown',
        title: p.title || p.role || '',
        workspace_role: memberMap[p.id]?.role || 'member',
        access_level: profileMap[p.id]?.access_level || 'junior',
        permitted_tools: profileMap[p.id]?.permitted_tools || ['slack', 'notion'],
        trust_score: profileMap[p.id]?.trust_score ?? 1.0,
        interaction_count: profileMap[p.id]?.interaction_count || 0,
        last_calibration: profileMap[p.id]?.last_calibration || null,
      }));

      return res.status(200).json({ agents });
    }

    // ── Company context (existing default) ────────────────────────────────────
    const { data: ws, error } = await db
      .from('workspaces')
      .select('context')
      .eq('id', workspaceId)
      .single();

    if (error) return res.status(500).json({ error: error.message });
    return res.status(200).json({ context: ws?.context || {} });
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // POST /api/brain  → save context | run hunt | update agent | resolve finding
  // ═══════════════════════════════════════════════════════════════════════════
  if (req.method === 'POST') {
    const body = req.body ?? {};

    // ── Hunt scan ─────────────────────────────────────────────────────────────
    if (body.action === 'hunt_scan') {
      if (!isAdmin) return res.status(403).json({ error: 'Admin only' });
      const result = await runHuntScan(workspaceId, db);
      return res.status(200).json(result);
    }

    // ── Resolve / reopen finding ──────────────────────────────────────────────
    if (body.action === 'resolve_finding') {
      if (!isAdmin) return res.status(403).json({ error: 'Admin only' });
      const { id, resolved } = body;
      if (!id) return res.status(400).json({ error: 'id required' });
      await db
        .from('hunt_findings')
        .update({ resolved: resolved ?? true, updated_at: new Date().toISOString() })
        .eq('id', id)
        .eq('workspace_id', workspaceId);
      return res.status(200).json({ ok: true });
    }

    // ── Update agent profile (admin sets another user's level; own profile allowed too) ──
    if (body.action === 'update_agent') {
      const { target_user_id, access_level, permitted_tools } = body;
      if (!target_user_id) return res.status(400).json({ error: 'target_user_id required' });
      if (target_user_id !== user.id && !isAdmin) return res.status(403).json({ error: 'Admin only' });

      const validLevels = ['junior', 'manager', 'director', 'executive'];
      if (access_level && !validLevels.includes(access_level)) {
        return res.status(400).json({ error: 'Invalid access_level' });
      }

      const update = { updated_at: new Date().toISOString() };
      if (access_level) update.access_level = access_level;
      if (permitted_tools && Array.isArray(permitted_tools)) update.permitted_tools = permitted_tools;

      const { error } = await db
        .from('agent_profiles')
        .upsert({ user_id: target_user_id, workspace_id: workspaceId, ...update }, { onConflict: 'user_id' });

      if (error) return res.status(500).json({ error: error.message });
      return res.status(200).json({ ok: true });
    }

    // ── Save company context (existing) ───────────────────────────────────────
    if (!isAdmin) return res.status(403).json({ error: 'Admin access required' });
    const { context } = body;
    if (typeof context !== 'object' || context === null) {
      return res.status(400).json({ error: 'context must be an object' });
    }
    const { error } = await db.from('workspaces').update({ context }).eq('id', workspaceId);
    if (error) return res.status(500).json({ error: error.message });
    return res.status(200).json({ ok: true });
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
