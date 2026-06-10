// Autonomous Role Agents — HTTP layer (action-router, like brain.js). The loop
// itself lives in agent_engine.js. NOT a serverless function: to stay under
// Vercel's 12-fn cap this is mounted through api/inbox.js via the
// `/api/agents → /api/inbox?__agents=1` rewrite (same trick as oauth/slack).
//
//   GET  /api/agents?action=run_due       → cron (Bearer CRON_SECRET)
//   GET  /api/agents?action=unsubscribe   → public one-click opt-out (compliance)
//   GET  /api/agents                      → list agents (+ summary)
//   GET  /api/agents?id=<uuid>            → agent detail (runs, targets, queue)
//   POST /api/agents {action:create|update|pause|resume|run|approve|reject}
import { requireAuth, adminClient } from './supabase.js';
import { enforceRateLimit, fail } from './security.js';
import { runAgent, runDueAgents, approveMessage, approveAction, rejectAction } from './agent_engine.js';
import { normAddress } from './channels/index.js';
import { recordSignal } from './learning.js';

async function resolveWorkspace(userId, db) {
  const { data } = await db.from('profiles').select('workspace_id, role').eq('id', userId).single();
  return data ?? null;
}
async function isMember(userId, workspaceId, db) {
  const { data } = await db.from('workspace_members')
    .select('role').eq('user_id', userId).eq('workspace_id', workspaceId).single();
  return data ?? null;
}

const ROLES = ['sales', 'social', 'support', 'research', 'custom', 'knowledge'];
const CHANNEL_KEYS = ['email', 'x', 'linkedin'];
const KINDS = ['outreach', 'knowledge'];

// Team Daemon access model (IA §5.2.3). Daemons are PRIVATE BY DEFAULT: a user
// can only see/act on a daemon they created (owner) or that's been shared with
// them (per-person or company-wide). Returns { agent, access } where access is
// 'owner'|'editor'|'user'|'viewer' or null (no visibility).
const ACCESS_RANK = { viewer: 0, user: 1, editor: 2, owner: 3 };
async function agentAccess(db, agentId, workspaceId, userId, { isAdmin = false } = {}) {
  const { data: agent } = await db.from('agents').select('*').eq('id', agentId).eq('workspace_id', workspaceId).single();
  if (!agent) return { agent: null, access: null };
  if (agent.created_by === userId) return { agent, access: 'owner' };
  const { data: shares } = await db.from('agent_shares').select('shared_with, company_wide, access_level').eq('agent_id', agentId);
  let access = null;
  for (const s of shares || []) {
    if (s.company_wide || s.shared_with === userId) {
      if (access === null || ACCESS_RANK[s.access_level] > ACCESS_RANK[access]) access = s.access_level;
    }
  }
  // IA §5.2.3: admins may VIEW any workspace daemon but get no edit rights unless
  // explicitly shared. So floor an admin's access at 'viewer' (never downgrades).
  if (access === null && isAdmin) access = 'viewer';
  return { agent, access };
}
const rankGte = (access, min) => access != null && ACCESS_RANK[access] >= ACCESS_RANK[min];

export async function agentsHandler(req, res) {
  // ── Cron: run due agents ───────────────────────────────────────────────────
  if (req.method === 'GET' && req.query?.action === 'run_due') {
    const secret = process.env.CRON_SECRET;
    if (!secret || req.headers.authorization !== `Bearer ${secret}`) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
    try {
      const results = await runDueAgents(adminClient());
      console.log('[agents] run_due agents=%d', results.length);
      return res.status(200).json({ ok: true, ran: results.length, results });
    } catch (e) {
      console.error('[agents] run_due error:', e.message);
      return res.status(500).json({ error: 'Run failed' });
    }
  }

  // ── Public one-click unsubscribe (no auth — CAN-SPAM/GDPR) ──────────────────
  if (req.method === 'GET' && req.query?.action === 'unsubscribe') {
    const db = adminClient();
    const workspaceId = req.query.w;
    const address = normAddress(req.query.a);
    const channel = req.query.c || 'email';
    if (workspaceId && address) {
      await db.from('suppression_list').upsert(
        { workspace_id: workspaceId, channel, address, reason: 'unsubscribe' },
        { onConflict: 'workspace_id,channel,address' }
      );
    }
    res.setHeader('Content-Type', 'text/html');
    return res.status(200).send('<html><body style="font-family:system-ui;text-align:center;padding:4rem"><h2>You’re unsubscribed.</h2><p>You won’t receive further outreach from this sender.</p></body></html>');
  }

  // ── Authenticated actions ───────────────────────────────────────────────────
  const user = await requireAuth(req, res);
  if (!user) return;
  if (!(await enforceRateLimit(res, { key: `agents:${user.id}`, max: 120, windowSec: 60 }))) return;

  const db = adminClient();
  const profile = await resolveWorkspace(user.id, db);
  const workspaceId = profile?.workspace_id ?? null;
  if (!workspaceId) return res.status(400).json({ error: 'No workspace' });
  const member = await isMember(user.id, workspaceId, db);
  if (!member) return res.status(403).json({ error: 'Not a workspace member' });
  const isAdmin = member.role === 'admin';

  try {
    // ── GET: list or detail ───────────────────────────────────────────────────
    if (req.method === 'GET') {
      if (req.query?.id) {
        // Private by default — owner, shared-with, or admin (view-only) may see it.
        const { agent, access } = await agentAccess(db, req.query.id, workspaceId, user.id, { isAdmin });
        if (!agent || access == null) return res.status(404).json({ error: 'Agent not found' });
        const [{ data: runs }, { data: targets }, { data: queue }, { data: actions }] = await Promise.all([
          db.from('agent_runs').select('*').eq('agent_id', agent.id).order('started_at', { ascending: false }).limit(10),
          db.from('outreach_targets').select('*').eq('agent_id', agent.id).order('score', { ascending: false }).limit(100),
          db.from('outreach_messages').select('*, outreach_targets(company,person_name)').eq('agent_id', agent.id).in('status', ['draft', 'approved', 'failed']).order('created_at', { ascending: false }).limit(100),
          db.from('daemon_actions').select('*').eq('agent_id', agent.id).order('created_at', { ascending: false }).limit(100),
        ]);
        return res.status(200).json({ agent, my_access: access, runs: runs || [], targets: targets || [], queue: queue || [], actions: actions || [] });
      }
      const [{ data: agents }, { data: shares }, { data: members }] = await Promise.all([
        db.from('agents').select('*').eq('workspace_id', workspaceId).order('created_at', { ascending: false }),
        db.from('agent_shares').select('agent_id, shared_with, company_wide, access_level').eq('workspace_id', workspaceId),
        db.from('profiles').select('id, name, title').eq('workspace_id', workspaceId),
      ]);
      const nameOf = Object.fromEntries((members || []).map(m => [m.id, m.name || m.title || 'Teammate']));
      const sharesByAgent = {};
      for (const s of shares || []) (sharesByAgent[s.agent_id] = sharesByAgent[s.agent_id] || []).push(s);
      // Annotate each agent with the caller's relationship: My Daemons (created_by
      // me → owner) vs Team Daemons (shared with me / company-wide), + my access.
      const annotated = (agents || []).map(a => {
        const mine = a.created_by === user.id;
        const ash = sharesByAgent[a.id] || [];
        // Private by default: my_access is null unless I own it or it's shared with me.
        let my_access = mine ? 'owner' : null;
        if (!mine) {
          for (const s of ash) {
            const applies = s.company_wide || s.shared_with === user.id;
            if (applies && (my_access === null || ACCESS_RANK[s.access_level] > ACCESS_RANK[my_access])) my_access = s.access_level;
          }
          // IA §5.2.3: admins see (view-only) any daemon not otherwise shared to them.
          if (my_access === null && isAdmin) my_access = 'viewer';
        }
        return {
          ...a, mine, my_access,
          // Owners get the share roster (names) to manage access in the dialog.
          shares: mine ? ash.map(s => ({ ...s, name: s.company_wide ? 'Everyone' : nameOf[s.shared_with] || 'Teammate' })) : undefined,
        };
      }).filter(a => a.my_access != null); // hide daemons the caller has no access to
      return res.status(200).json({ agents: annotated, members: (members || []).map(m => ({ id: m.id, name: nameOf[m.id] })) });
    }

    // ── POST: mutations ───────────────────────────────────────────────────────
    if (req.method === 'POST') {
      const body = req.body || {};
      const action = body.action;

      if (action === 'create') {
        const name = String(body.name || '').trim();
        const objective = String(body.objective || '').trim();
        if (!name || !objective) return res.status(400).json({ error: 'name and objective are required' });
        const kind = KINDS.includes(body.kind) ? body.kind : 'outreach';
        const role = ROLES.includes(body.role) ? body.role : (kind === 'knowledge' ? 'knowledge' : 'sales');
        const channels = Array.isArray(body.channels) ? body.channels.filter(c => CHANNEL_KEYS.includes(c)) : [];
        const { data: agent, error } = await db.from('agents').insert({
          workspace_id: workspaceId, created_by: user.id, name, kind, role, objective,
          channels, kpi: body.kpi || {}, config: body.config || {},
          autonomy: body.autonomy === 'auto_send' ? 'auto_send' : 'approve_first',
          schedule: body.schedule || '0 8 * * *',
        }).select().single();
        if (error) throw error;
        return res.status(200).json({ ok: true, agent });
      }

      // ── Team Daemon sharing (IA §5.2.3) — only the owner (creator) manages access.
      if (action === 'share' || action === 'unshare') {
        const id = body.id;
        if (!id) return res.status(400).json({ error: 'id required' });
        const { data: agent } = await db.from('agents').select('created_by').eq('id', id).eq('workspace_id', workspaceId).single();
        if (!agent) return res.status(404).json({ error: 'Daemon not found' });
        if (agent.created_by !== user.id) return res.status(403).json({ error: 'Only the owner can change sharing' });
        const companyWide = body.company_wide === true;
        const sharedWith = companyWide ? null : (body.user_id || null);
        if (!companyWide && !sharedWith) return res.status(400).json({ error: 'user_id or company_wide required' });
        if (action === 'unshare') {
          let q = db.from('agent_shares').delete().eq('agent_id', id);
          q = companyWide ? q.eq('company_wide', true) : q.eq('shared_with', sharedWith);
          await q;
          return res.status(200).json({ ok: true });
        }
        const level = ['viewer', 'user', 'editor', 'owner'].includes(body.access_level) ? body.access_level : 'viewer';
        // Replace any existing matching share (delete-then-insert keeps it simple
        // with the partial unique indexes).
        let del = db.from('agent_shares').delete().eq('agent_id', id);
        del = companyWide ? del.eq('company_wide', true) : del.eq('shared_with', sharedWith);
        await del;
        const { error } = await db.from('agent_shares').insert({
          agent_id: id, workspace_id: workspaceId, shared_with: sharedWith, company_wide: companyWide,
          access_level: level, created_by: user.id,
        });
        if (error) return res.status(500).json({ error: 'Could not update sharing' });
        return res.status(200).json({ ok: true });
      }

      if (['update', 'pause', 'resume'].includes(action)) {
        const id = body.id;
        if (!id) return res.status(400).json({ error: 'id required' });
        // Editing config / pausing requires Editor or Owner access.
        const { agent: tgt, access } = await agentAccess(db, id, workspaceId, user.id);
        if (!tgt) return res.status(404).json({ error: 'Daemon not found' });
        if (!rankGte(access, 'editor')) return res.status(403).json({ error: 'You need Editor access to change this daemon' });
        const patch = { updated_at: new Date().toISOString() };
        if (action === 'pause') patch.status = 'paused';
        if (action === 'resume') patch.status = 'active';
        if (action === 'update') {
          for (const k of ['name', 'objective', 'kpi', 'channels', 'autonomy', 'schedule', 'config', 'auto_channels']) {
            if (body[k] !== undefined) patch[k] = body[k];
          }
        }
        const { data: agent, error } = await db.from('agents')
          .update(patch).eq('id', id).eq('workspace_id', workspaceId).select().single();
        if (error) throw error;
        return res.status(200).json({ ok: true, agent });
      }

      if (action === 'run') {
        if (!(await enforceRateLimit(res, { key: `agent_run:${user.id}`, max: 10, windowSec: 3600 }))) return;
        // Running requires User access or above (Viewers can look but not trigger).
        const { agent, access } = await agentAccess(db, body.id, workspaceId, user.id);
        if (!agent) return res.status(404).json({ error: 'Agent not found' });
        if (!rankGte(access, 'user')) return res.status(403).json({ error: 'You need at least User access to run this daemon' });
        const result = await runAgent(db, agent);
        return res.status(200).json(result);
      }

      // Approving/rejecting a daemon's proposed work = acting on it → needs User+.
      const canActOnMessageAgent = async (messageId) => {
        const { data: m } = await db.from('outreach_messages').select('agent_id').eq('id', messageId).eq('workspace_id', workspaceId).maybeSingle();
        if (!m?.agent_id) return false;
        const { access } = await agentAccess(db, m.agent_id, workspaceId, user.id);
        return rankGte(access, 'user');
      };
      const canActOnActionAgent = async (actionId) => {
        const { data: a } = await db.from('daemon_actions').select('agent_id').eq('id', actionId).eq('workspace_id', workspaceId).maybeSingle();
        if (!a?.agent_id) return false;
        const { access } = await agentAccess(db, a.agent_id, workspaceId, user.id);
        return rankGte(access, 'user');
      };

      if (action === 'approve') {
        if (!body.messageId) return res.status(400).json({ error: 'messageId required' });
        if (!(await canActOnMessageAgent(body.messageId))) return res.status(403).json({ error: 'You need at least User access to act on this daemon' });
        const result = await approveMessage(db, {
          workspaceId, messageId: body.messageId, userId: user.id, edits: body.edits || {},
        });
        return res.status(result.ok ? 200 : 400).json(result);
      }

      if (action === 'reject') {
        if (!body.messageId) return res.status(400).json({ error: 'messageId required' });
        if (!(await canActOnMessageAgent(body.messageId))) return res.status(403).json({ error: 'You need at least User access to act on this daemon' });
        // Fetch attribution before updating so the rejection trains the bandit.
        const { data: rmsg } = await db.from('outreach_messages')
          .select('agent_id, variant_id, channel, outreach_targets(source_query)')
          .eq('id', body.messageId).eq('workspace_id', workspaceId).maybeSingle();
        const { error } = await db.from('outreach_messages')
          .update({ status: 'rejected', approved_by: user.id })
          .eq('id', body.messageId).eq('workspace_id', workspaceId);
        if (error) throw error;
        await recordSignal(db, {
          workspaceId, domain: 'agent', subjectType: 'outreach_message', subjectId: body.messageId,
          signal: 'rejected',
          meta: { agent_id: rmsg?.agent_id, variant_id: rmsg?.variant_id, source_query: rmsg?.outreach_targets?.source_query, channel: rmsg?.channel },
        });
        return res.status(200).json({ ok: true });
      }

      // ── Knowledge-daemon proposed actions ───────────────────────────────────
      if (action === 'approve_action') {
        if (!body.actionId) return res.status(400).json({ error: 'actionId required' });
        if (!(await canActOnActionAgent(body.actionId))) return res.status(403).json({ error: 'You need at least User access to act on this daemon' });
        const result = await approveAction(db, { workspaceId, actionId: body.actionId, userId: user.id, edits: body.edits || {} });
        return res.status(result.ok ? 200 : 400).json(result);
      }
      if (action === 'reject_action') {
        if (!body.actionId) return res.status(400).json({ error: 'actionId required' });
        if (!(await canActOnActionAgent(body.actionId))) return res.status(403).json({ error: 'You need at least User access to act on this daemon' });
        const result = await rejectAction(db, { workspaceId, actionId: body.actionId, userId: user.id });
        return res.status(result.ok ? 200 : 400).json(result);
      }


      if (action === 'suppress') {
        const address = normAddress(body.address);
        if (!address) return res.status(400).json({ error: 'address required' });
        await db.from('suppression_list').upsert(
          { workspace_id: workspaceId, channel: body.channel || 'email', address, reason: body.reason || 'manual' },
          { onConflict: 'workspace_id,channel,address' });
        return res.status(200).json({ ok: true });
      }

      return res.status(400).json({ error: `Unknown action: ${action}` });
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (e) {
    return fail(res, 500, 'Agent request failed', e, 'agents');
  }
}
