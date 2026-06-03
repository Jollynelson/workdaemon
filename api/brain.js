import { requireAuth, adminClient } from './_lib/supabase.js';
import { researchRole, researchCompany, scanAllWorkspaces } from './_lib/research_actions.js';
import { fail, enforceRateLimit } from './_lib/security.js';

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

// ── Cross-staff pattern detection (FINAL spec §11) ────────────────────────────
// Cluster the last 30 days of interactions by topic; a topic touched by ≥3
// DISTINCT staff is a cross-staff pattern. Type it (shared_blocker /
// cross_team_dependency / repeated_question), write it to detected_patterns, and
// push it to managers/executives — anonymised: counts + roles, never names
// (spec §13 asymmetric surfacing).
const BLOCKER_RE = /\b(block(ed|er)?|stuck|waiting on|can'?t|cannot|unable|broken|fail(s|ed|ing)?|error|delayed|pending|depends on)\b/i;

export async function detectPatterns(workspaceId, db) {
  const cutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
  const { data: rows } = await db
    .from('brain_interactions')
    .select('user_id, user_role, user_message, created_at')
    .eq('workspace_id', workspaceId)
    .gte('created_at', cutoff)
    .order('created_at', { ascending: false })
    .limit(400);
  if (!rows?.length) return { patterns: 0, pushed: 0 };

  // Cluster by extracted topic tag (semantic-ish; tags already normalize the message).
  const clusters = {};
  for (const r of rows) {
    const isBlocker = BLOCKER_RE.test(r.user_message || '');
    for (const tag of extractTopicTags(r.user_message)) {
      const c = clusters[tag] || (clusters[tag] = { users: new Set(), roles: new Set(), blocker: 0, sample: null });
      c.users.add(r.user_id);
      if (r.user_role) c.roles.add(r.user_role);
      if (isBlocker) c.blocker++;
      if (!c.sample) c.sample = (r.user_message || '').slice(0, 120);
    }
  }

  const candidates = [];
  for (const [tag, c] of Object.entries(clusters)) {
    if (c.users.size < 3) continue;            // ≥3 distinct staff (spec threshold)
    const roles = [...c.roles];
    const n = c.users.size;
    let pattern_type, title, detail;
    if (c.blocker >= 2) {
      pattern_type = 'shared_blocker';
      title = `Shared blocker around "${tag}"`;
      detail = `${n} staff${roles.length > 1 ? ` across ${roles.length} teams` : ''} flagged blockers related to "${tag}" this month. Likely a shared dependency — an unblocking decision or owner would clear several people at once.`;
    } else if (roles.length >= 2) {
      pattern_type = 'cross_team_dependency';
      title = `Cross-team focus on "${tag}"`;
      detail = `${n} staff across ${roles.length} teams (${roles.join(', ')}) are working "${tag}" in parallel. Worth coordinating to avoid duplicated effort or misalignment.`;
    } else {
      pattern_type = 'repeated_question';
      title = `Repeated questions about "${tag}"`;
      detail = `${n} staff asked about "${tag}" this month — a knowledge gap worth documenting once, centrally, and surfacing proactively.`;
    }
    candidates.push({ tag, pattern_type, title, detail, staff: [...c.users], roles, n,
      confidence: Math.min(0.95, 0.5 + n * 0.1) });
  }
  if (!candidates.length) return { patterns: 0, pushed: 0 };

  // Dedup against still-open patterns.
  const { data: open } = await db.from('app_detected_patterns')
    .select('title').eq('workspace_id', workspaceId).eq('status', 'open');
  const openTitles = new Set((open || []).map(p => p.title));
  const fresh = candidates.filter(p => !openTitles.has(p.title));
  if (!fresh.length) return { patterns: 0, pushed: 0 };

  // Push targets: executives (spec §13 — company-wide patterns → executives only).
  const { data: leaders } = await db.from('app_agent_profiles')
    .select('user_id, access_level').eq('workspace_id', workspaceId)
    .eq('access_level', 'executive');

  let pushed = 0;
  for (const p of fresh) {
    const { data: row } = await db.from('app_detected_patterns').insert({
      workspace_id: workspaceId, pattern_type: p.pattern_type, title: p.title, detail: p.detail,
      evidence: { tag: p.tag, staff_count: p.n, roles: p.roles },
      staff_involved: p.staff, confidence: p.confidence, status: 'open',
    }).select().single();
    for (const l of (leaders || [])) {
      await db.from('inbox_items').insert({
        workspace_id: workspaceId, user_id: l.user_id, type: 'alert', source: 'daemon',
        title: `Brain · Pattern: ${p.title}`,
        body: p.detail,   // counts + roles only — never individual names
        metadata: { event_type: 'pattern', pattern_id: row?.id, severity: p.confidence > 0.8 ? 'warning' : 'info' },
        read: false,
      });
      pushed++;
    }
  }
  return { patterns: fresh.length, pushed };
}

// ── Handler ───────────────────────────────────────────────────────────────────
export default async function handler(req, res) {
  // ── Cron: proactive external scan (system job, no user session) ──────────────
  // Vercel Cron hits GET /api/brain?action=scan_external and, when CRON_SECRET is
  // set, attaches `Authorization: Bearer <CRON_SECRET>`. Runs the brain's
  // outside-world scan across all workspaces → role-targeted hunt_findings.
  if (req.method === 'GET' && req.query?.action === 'scan_external') {
    const secret = process.env.CRON_SECRET;
    if (!secret || req.headers.authorization !== `Bearer ${secret}`) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
    try {
      const cronDb = adminClient();
      const results = await scanAllWorkspaces(cronDb);
      const inserted = results.reduce((n, r) => n + (r.inserted || 0), 0);
      // Also run cross-staff pattern detection per workspace (spec §11).
      let patterns = 0;
      const { data: wss } = await cronDb.from('workspaces').select('id').limit(50);
      for (const w of (wss || [])) {
        try { patterns += (await detectPatterns(w.id, cronDb)).patterns || 0; }
        catch (e) { console.error('[brain] detectPatterns ws=%s:', w.id, e.message); }
      }
      console.log('[brain] scan_external workspaces=%d findings=%d patterns=%d', results.length, inserted, patterns);
      return res.status(200).json({ ok: true, workspaces: results.length, findings: inserted, patterns, results });
    } catch (e) {
      console.error('[brain] scan_external error:', e.message);
      return res.status(500).json({ error: 'Scan failed' });
    }
  }

  const user = await requireAuth(req, res);
  if (!user) return;

  // Per-user rate limit covering all brain reads/writes (research actions add
  // their own stricter limits on top).
  if (!(await enforceRateLimit(res, { key: `brain:${user.id}`, max: 120, windowSec: 60 }))) return;

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
        .from('app_agent_profiles')
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

    if (error) return fail(res, 500, 'Could not load company context', error, 'brain');
    return res.status(200).json({ context: ws?.context || {} });
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // POST /api/brain  → save context | run hunt | update agent | resolve finding
  // ═══════════════════════════════════════════════════════════════════════════
  if (req.method === 'POST') {
    const body = req.body ?? {};

    // ── Hunt scan ─────────────────────────────────────────────────────────────
    if (body.action === 'detect_patterns') {
      if (!isAdmin) return res.status(403).json({ error: 'Admin only' });
      const result = await detectPatterns(workspaceId, db);
      return res.status(200).json({ ok: true, ...result });
    }

    if (body.action === 'hunt_scan') {
      if (!isAdmin) return res.status(403).json({ error: 'Admin only' });
      const result = await runHuntScan(workspaceId, db);
      return res.status(200).json(result);
    }

    // ── Resolve / reopen finding ──────────────────────────────────────────────
    if (body.action === 'resolve_finding') {
      if (!isAdmin) return res.status(403).json({ error: 'Admin only' });
      const { id, resolved } = body;
      if (typeof id !== 'string' || !id) return res.status(400).json({ error: 'id (string) required' });
      if (resolved !== undefined && typeof resolved !== 'boolean') {
        return res.status(400).json({ error: 'resolved must be a boolean' });
      }
      // Scoped to the caller's workspace → cannot resolve another tenant's findings.
      await db
        .from('hunt_findings')
        .update({ resolved: resolved ?? true, updated_at: new Date().toISOString() })
        .eq('id', id)
        .eq('workspace_id', workspaceId);
      return res.status(200).json({ ok: true });
    }

    // ── Update agent profile ──────────────────────────────────────────────────
    // access_level and permitted_tools are the daemon's authorization surface, so
    // they are ADMIN-ONLY. A user must never be able to raise their own level
    // (that would be a vertical privilege escalation). The target must also be a
    // member of the caller's workspace.
    if (body.action === 'update_agent') {
      if (!isAdmin) return res.status(403).json({ error: 'Admin only' });

      const { target_user_id, access_level, permitted_tools } = body;
      if (typeof target_user_id !== 'string' || !target_user_id) {
        return res.status(400).json({ error: 'target_user_id (string) required' });
      }

      const targetMember = await isMember(target_user_id, workspaceId, db);
      if (!targetMember) return res.status(404).json({ error: 'User is not a member of this workspace' });

      const validLevels = ['junior', 'manager', 'director', 'executive'];
      if (access_level && !validLevels.includes(access_level)) {
        return res.status(400).json({ error: 'Invalid access_level' });
      }
      if (permitted_tools && (!Array.isArray(permitted_tools) || permitted_tools.some(t => typeof t !== 'string'))) {
        return res.status(400).json({ error: 'permitted_tools must be an array of strings' });
      }

      const update = { updated_at: new Date().toISOString() };
      if (access_level) update.access_level = access_level;
      if (permitted_tools) update.permitted_tools = permitted_tools.slice(0, 32);

      const { error } = await db
        .from('app_agent_profiles')
        .upsert({ user_id: target_user_id, workspace_id: workspaceId, ...update }, { onConflict: 'user_id' });

      if (error) return fail(res, 500, 'Could not update agent profile', error, 'brain');
      return res.status(200).json({ ok: true });
    }

    // ── Research the user's role → daemon_memory (any member) ─────────────────
    // Rate-limited: each call burns Brave + LLM credits (cost-based DoS guard).
    if (body.action === 'research_role') {
      if (!(await enforceRateLimit(res, { key: `research_role:${user.id}`, max: 5, windowSec: 3600 }))) return;
      const result = await researchRole(db, user.id, body);
      return res.status(result.status).json(result.body);
    }

    // ── Research the company + competitors → context + hunt_findings (admin) ──
    if (body.action === 'research_company') {
      if (!isAdmin) return res.status(403).json({ error: 'Admin only' });
      if (!(await enforceRateLimit(res, { key: `research_company:${workspaceId}`, max: 10, windowSec: 3600 }))) return;
      const { data: ws } = await db
        .from('workspaces')
        .select('name, industry, context')
        .eq('id', workspaceId)
        .single();
      const result = await researchCompany(db, workspaceId, ws, body);
      return res.status(result.status).json(result.body);
    }

    // ── Save company context (existing) ───────────────────────────────────────
    if (!isAdmin) return res.status(403).json({ error: 'Admin access required' });
    const { context } = body;
    if (typeof context !== 'object' || context === null) {
      return res.status(400).json({ error: 'context must be an object' });
    }
    const { error } = await db.from('workspaces').update({ context }).eq('id', workspaceId);
    if (error) return fail(res, 500, 'Could not save company context', error, 'brain');
    return res.status(200).json({ ok: true });
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
