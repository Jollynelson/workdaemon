import { requireAuth, adminClient } from './_lib/supabase.js';
import { fail, enforceRateLimit, parseBody } from './_lib/security.js';
import { assessCapacity, suggestAlternatives } from './_lib/capacity.js';

// Tasks + Cross-Daemon Communication.
// GET                → list workspace tasks (with assignee + from-staff)
// GET ?events=1      → pending daemon events tagged to the current user
// POST {action:...}  → cross-daemon actions: assign / accept / flag / broadcast /
//                      set_availability / resolve_event
// Consolidated into one function to stay under the Vercel serverless fn limit.

async function getProfile(db, userId) {
  const { data } = await db
    .from('profiles')
    .select('workspace_id, name, title, role')
    .eq('id', userId)
    .single();
  return data;
}

async function isMember(db, workspaceId, userId) {
  const { data } = await db
    .from('workspace_members')
    .select('user_id')
    .eq('workspace_id', workspaceId)
    .eq('user_id', userId)
    .maybeSingle();
  return !!data;
}

// Resolve {id → {name, title}} via the public profiles table. We can't embed
// auth.users through PostgREST (auth schema isn't exposed), so join names here.
async function resolveNames(db, ids) {
  const uniq = [...new Set(ids.filter(Boolean))];
  if (!uniq.length) return {};
  const { data } = await db.from('profiles').select('id, name, title').in('id', uniq);
  return Object.fromEntries((data || []).map(p => [p.id, { id: p.id, name: p.name, title: p.title }]));
}

// Pending events tagged to a user: direct (to_user_id = me) + broadcasts (null),
// excluding ones this user sent.
async function pendingEvents(db, workspaceId, userId) {
  const { data } = await db
    .from('daemon_events')
    .select('*')
    .eq('workspace_id', workspaceId)
    .eq('status', 'pending')
    .or(`to_user_id.eq.${userId},to_user_id.is.null`)
    .neq('from_user_id', userId)
    .order('created_at', { ascending: false })
    .limit(20);
  const events = data || [];
  const names = await resolveNames(db, events.map(e => e.from_user_id));
  return events.map(e => ({ ...e, from_staff: names[e.from_user_id] || null }));
}

export default async function handler(req, res) {
  const user = await requireAuth(req, res);
  if (!user) return;

  const db = adminClient();
  const profile = await getProfile(db, user.id);
  const workspaceId = profile?.workspace_id;

  // ── GET ────────────────────────────────────────────────────────────────────
  if (req.method === 'GET') {
    if (!(await enforceRateLimit(res, { key: `tasks:${user.id}`, max: 120, windowSec: 60 }))) return;
    if (!workspaceId) return res.status(200).json({ tasks: [], events: [] });

    if (req.query?.events) {
      const events = await pendingEvents(db, workspaceId, user.id);
      return res.status(200).json({ events });
    }

    const { data: tasks, error } = await db
      .from('tasks')
      .select('*')
      .eq('workspace_id', workspaceId)
      .order('created_at', { ascending: false });

    if (error) return fail(res, 500, 'Could not load tasks', error, 'tasks');
    // Resolve assignee + from-staff names via profiles (auth.users isn't embeddable).
    const names = await resolveNames(db, (tasks || []).flatMap(t => [t.assignee_id, t.from_user_id]));
    const shaped = (tasks || []).map(t => ({
      ...t,
      assignee: names[t.assignee_id] || null,
      from_staff: names[t.from_user_id] || null,
    }));
    return res.status(200).json({ tasks: shaped });
  }

  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  if (!(await enforceRateLimit(res, { key: `tasks-w:${user.id}`, max: 60, windowSec: 60 }))) return;
  if (!workspaceId) return res.status(400).json({ error: 'No workspace' });

  const action = (req.body?.action || '').toString();
  const actorName = profile?.name || profile?.title || 'A teammate';

  // ── assign: capacity-aware assignment (the heart of cross-daemon comms) ──────
  if (action === 'assign') {
    const body = parseBody(res, req.body, {
      action:     { type: 'string' },
      to_user_id: { type: 'string', required: true, max: 64 },
      title:      { type: 'string', required: true, min: 1, max: 200 },
      brief:      { type: 'string', max: 4000 },
      priority:   { type: 'string', max: 4 },
      due_date:   { type: 'string', max: 10 },
      force:      { type: 'boolean' },
    });
    if (!body) return;
    if (!(await isMember(db, workspaceId, body.to_user_id)))
      return res.status(400).json({ error: 'Assignee is not in your workspace' });

    const capacity = await assessCapacity(db, workspaceId, body.to_user_id);

    // High load + not forced → the assigning daemon does NOT silently assign;
    // it surfaces a decision with alternatives (doc Scenario 2).
    if (capacity.load === 'high' && !body.force) {
      const alternatives = await suggestAlternatives(db, workspaceId, body.to_user_id);
      return res.status(200).json({ outcome: 'risk', capacity, alternatives });
    }

    const { data: task, error } = await db.from('tasks').insert({
      workspace_id: workspaceId,
      title: body.title,
      description: body.brief || null,
      brief: body.brief || null,
      status: 'todo',
      priority: body.priority || 'P2',
      assignee_id: body.to_user_id,
      from_user_id: user.id,
      created_by: user.id,
      due_date: body.due_date || null,
      routed_by_brain: true,
    }).select().single();
    if (error) return fail(res, 500, 'Could not create task', error, 'tasks');

    await db.from('daemon_events').insert({
      workspace_id: workspaceId, from_user_id: user.id, to_user_id: body.to_user_id,
      type: 'assignment', task_id: task.id,
      payload: { title: body.title, priority: task.priority, brief: body.brief || null, capacity },
    });
    await db.from('inbox_items').insert({
      workspace_id: workspaceId, user_id: body.to_user_id, type: 'task', source: 'daemon',
      title: `${actorName} assigned you: ${body.title}`,
      body: body.brief || `New ${task.priority} task from ${actorName}.`,
      metadata: { task_id: task.id, event_type: 'assignment', priority: task.priority, from: actorName },
      read: false,
    });

    return res.status(200).json({ outcome: 'assigned', task, capacity });
  }

  // ── accept: assignee's daemon accepts → notify the assigner ──────────────────
  if (action === 'accept') {
    const body = parseBody(res, req.body, { action: { type: 'string' }, task_id: { type: 'string', required: true, max: 64 } });
    if (!body) return;
    const { data: task } = await db.from('tasks').select('*').eq('id', body.task_id).eq('workspace_id', workspaceId).single();
    if (!task || task.assignee_id !== user.id) return res.status(403).json({ error: 'Not your task' });

    await db.from('tasks').update({ status: 'in_progress', updated_at: new Date().toISOString() }).eq('id', task.id);
    if (task.from_user_id) {
      await db.from('daemon_events').insert({
        workspace_id: workspaceId, from_user_id: user.id, to_user_id: task.from_user_id,
        type: 'accepted', task_id: task.id, payload: { title: task.title },
      });
      await db.from('inbox_items').insert({
        workspace_id: workspaceId, user_id: task.from_user_id, type: 'update', source: 'daemon',
        title: `${actorName}'s daemon accepted: ${task.title}`,
        body: `${actorName} has started on it.`,
        metadata: { task_id: task.id, event_type: 'accepted' }, read: false,
      });
    }
    return res.status(200).json({ ok: true });
  }

  // ── flag: assignee's daemon pushes back with a counter-proposal (Scenario 3) ─
  if (action === 'flag') {
    const body = parseBody(res, req.body, {
      action: { type: 'string' }, task_id: { type: 'string', required: true, max: 64 },
      reason: { type: 'string', required: true, max: 2000 }, suggestion: { type: 'string', max: 2000 },
    });
    if (!body) return;
    const { data: task } = await db.from('tasks').select('*').eq('id', body.task_id).eq('workspace_id', workspaceId).single();
    if (!task || task.assignee_id !== user.id) return res.status(403).json({ error: 'Not your task' });

    const capacity = await assessCapacity(db, workspaceId, user.id);
    if (task.from_user_id) {
      await db.from('daemon_events').insert({
        workspace_id: workspaceId, from_user_id: user.id, to_user_id: task.from_user_id,
        type: 'flag', task_id: task.id,
        payload: { title: task.title, reason: body.reason, suggestion: body.suggestion || null, capacity },
      });
      await db.from('inbox_items').insert({
        workspace_id: workspaceId, user_id: task.from_user_id, type: 'alert', source: 'daemon',
        title: `⚠ ${actorName}'s daemon flagged a capacity risk: ${task.title}`,
        body: body.reason + (body.suggestion ? `\n\nSuggested: ${body.suggestion}` : ''),
        metadata: { task_id: task.id, event_type: 'flag', severity: 'warning' }, read: false,
      });
    }
    return res.status(200).json({ ok: true, capacity });
  }

  // ── broadcast: a senior daemon sends to every daemon (each personalises it) ──
  if (action === 'broadcast') {
    const body = parseBody(res, req.body, { action: { type: 'string' }, message: { type: 'string', required: true, min: 1, max: 2000 } });
    if (!body) return;
    const { data: agent } = await db.from('app_agent_profiles').select('access_level').eq('user_id', user.id).single();
    if (!['executive', 'director'].includes(agent?.access_level))
      return res.status(403).json({ error: 'Only senior roles can broadcast' });

    const { data: members } = await db.from('workspace_members').select('user_id').eq('workspace_id', workspaceId);
    await db.from('daemon_events').insert({
      workspace_id: workspaceId, from_user_id: user.id, to_user_id: null,
      type: 'broadcast', payload: { message: body.message, from: actorName },
    });
    const rows = (members || []).filter(m => m.user_id !== user.id).map(m => ({
      workspace_id: workspaceId, user_id: m.user_id, type: 'update', source: 'daemon',
      title: `Broadcast from ${actorName}`, body: body.message,
      metadata: { event_type: 'broadcast', from: actorName }, read: false,
    }));
    if (rows.length) await db.from('inbox_items').insert(rows);
    return res.status(200).json({ ok: true, delivered: rows.length });
  }

  // ── set_availability: a daemon publishes its owner's capacity signal ─────────
  if (action === 'set_availability') {
    const body = parseBody(res, req.body, {
      action: { type: 'string' }, availability: { type: 'string', required: true, max: 16 },
      reason: { type: 'string', max: 500 }, until: { type: 'string', max: 40 },
    });
    if (!body) return;
    if (!['normal', 'high_load', 'away'].includes(body.availability))
      return res.status(400).json({ error: 'Invalid availability' });
    await db.from('app_agent_profiles').update({
      availability: body.availability,
      availability_reason: body.reason || null,
      availability_until: body.until || null,
      updated_at: new Date().toISOString(),
    }).eq('user_id', user.id);
    await db.from('daemon_events').insert({
      workspace_id: workspaceId, from_user_id: user.id, to_user_id: null,
      type: 'availability', payload: { availability: body.availability, reason: body.reason || null },
    });
    return res.status(200).json({ ok: true });
  }

  // ── resolve_event: dismiss a surfaced daemon event ───────────────────────────
  if (action === 'resolve_event') {
    const body = parseBody(res, req.body, { action: { type: 'string' }, event_id: { type: 'string', required: true, max: 64 } });
    if (!body) return;
    await db.from('daemon_events')
      .update({ status: 'resolved', resolved_at: new Date().toISOString() })
      .eq('id', body.event_id).eq('workspace_id', workspaceId)
      .or(`to_user_id.eq.${user.id},from_user_id.eq.${user.id}`);
    return res.status(200).json({ ok: true });
  }

  return res.status(400).json({ error: 'Unknown action' });
}
