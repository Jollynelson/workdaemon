// Extracted from the former 5,000-line src/pages/Dashboard.jsx (2026-06-10 split).
import { useState, useEffect, useCallback } from 'react';
import { useViewport } from '../../context/ThemeContext.jsx';
import { useAuth } from '../../context/AuthContext.jsx';
import { useC, PRIORITY_STYLES } from '../../lib/theme.jsx';
import { SkeletonRow, EmptyState } from '../../components/ui.jsx';
import { BlockAlert } from '../../components/blocks.jsx';

export const LOAD_STYLE = {
  low:    { color: '#10b981', label: 'AVAILABLE' },
  medium: { color: '#f59e0b', label: 'MODERATE LOAD' },
  high:   { color: '#ef4444', label: 'HIGH LOAD' },
};

export function Initial({ name, color = '#4172f5' }) {
  return (
    <div title={name || ''} style={{ width: 20, height: 20, borderRadius: '50%', background: color, display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'var(--orbitron)', fontSize: 7, fontWeight: 700, color: '#fff', flexShrink: 0 }}>
      {(name || '?').charAt(0)}
    </div>
  );
}

export function TaskCard({ task }) {
  const c = useC();
  const ps = PRIORITY_STYLES[task.priority] || PRIORITY_STYLES.P2;
  const assignee = task.assignee?.name || (typeof task.assignee === 'string' ? task.assignee : null);
  const from = task.from_staff?.name;
  return (
    <div style={{ padding: '12px 14px', background: task.blocked ? (c.d ? 'rgba(239,68,68,0.04)' : 'rgba(239,68,68,0.03)') : c.subtle, border: `1px solid ${task.blocked ? 'rgba(239,68,68,0.18)' : task.stale ? 'rgba(245,158,11,0.18)' : c.subtleBorder}`, borderRadius: 9 }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8, marginBottom: 9 }}>
        <span style={{ fontSize: 9, padding: '2px 7px', borderRadius: 5, background: ps.bg, border: `1px solid ${ps.border}`, color: ps.color, fontFamily: 'var(--mono)', letterSpacing: '0.06em', flexShrink: 0, marginTop: 2 }}>{task.priority}</span>
        <span style={{ fontFamily: 'var(--dmsans)', fontSize: 13, color: c.text2, lineHeight: 1.45 }}>{task.title}</span>
      </div>
      {task.routed_by_brain && (
        <div style={{ fontFamily: 'var(--mono)', fontSize: 9, color: '#4172f5', letterSpacing: '0.04em', marginBottom: 8 }}>
          ⤷ ROUTED BY BRAIN · {from || 'Company Brain'} → {assignee || '—'}
        </div>
      )}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
          {(task.blocked || task.stale) && (
            <span style={{ fontFamily: 'var(--mono)', fontSize: 9, color: task.blocked ? '#ef4444' : '#f59e0b', letterSpacing: '0.06em' }}>
              {task.blocked ? '⚠ FLAGGED' : '⏱ STALE'}
            </span>
          )}
          {task.due_date && <span style={{ fontFamily: 'var(--mono)', fontSize: 9, color: c.text4 }}>due {task.due_date}</span>}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          {from && <><Initial name={from} color={c.text4} /><span style={{ color: c.text4, fontSize: 10 }}>→</span></>}
          {assignee && <Initial name={assignee} />}
        </div>
      </div>
    </div>
  );
}

// List view for Tasks (IA §5.5) — flat sortable rows with all fields visible.
export function TaskListView({ tasks }) {
  const c = useC();
  const STATUS_LABEL = { todo: 'To Do', pending: 'To Do', delivered: 'To Do', accepted: 'In Progress', in_progress: 'In Progress', flagged: 'Blocked', blocked: 'Blocked', handed_off: 'In Review', completed: 'Done', done: 'Done' };
  const th = { fontFamily: 'var(--mono)', fontSize: 10, letterSpacing: '0.06em', color: c.text4, textAlign: 'left', padding: '0 12px 8px', fontWeight: 600 };
  const td = { fontFamily: 'var(--dmsans)', fontSize: 13, color: c.text, padding: '11px 12px', borderTop: `1px solid ${c.cardBorder}`, verticalAlign: 'middle' };
  return (
    <div style={{ background: c.card, border: `1px solid ${c.cardBorder}`, borderRadius: 12, padding: '14px 8px', overflowX: 'auto' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 640 }}>
        <thead><tr><th style={th}>TASK</th><th style={th}>STATUS</th><th style={th}>PRIORITY</th><th style={th}>DUE</th><th style={th}>SOURCE</th><th style={th}>ASSIGNED BY</th></tr></thead>
        <tbody>
          {tasks.map((t, i) => {
            const ps = PRIORITY_STYLES[t.priority] || PRIORITY_STYLES.P2;
            return (
              <tr key={t.id || i}>
                <td style={{ ...td, color: c.text2 }}>{t.title}</td>
                <td style={td}><span style={{ fontFamily: 'var(--mono)', fontSize: 10, letterSpacing: '0.04em', color: t.blocked ? '#ef4444' : c.text3 }}>{(STATUS_LABEL[t.status] || t.status || '—').toUpperCase()}</span></td>
                <td style={td}><span style={{ fontSize: 9, padding: '2px 7px', borderRadius: 5, background: ps.bg, border: `1px solid ${ps.border}`, color: ps.color, fontFamily: 'var(--mono)', letterSpacing: '0.06em' }}>{t.priority}</span></td>
                <td style={{ ...td, color: t.due_date ? c.text3 : c.text4, fontFamily: 'var(--mono)', fontSize: 11 }}>{t.due_date || '—'}</td>
                <td style={{ ...td, color: c.text3, fontFamily: 'var(--mono)', fontSize: 11 }}>{t.source || '—'}</td>
                <td style={{ ...td, color: c.text3 }}>{t.from_staff?.name || (t.routed_by_brain ? 'Company Brain' : '—')}</td>
              </tr>
            );
          })}
          {tasks.length === 0 && <tr><td style={{ ...td, color: c.text4 }} colSpan={6}>No tasks match this filter.</td></tr>}
        </tbody>
      </table>
    </div>
  );
}

export function KanbanColumn({ title, tasks }) {
  const c = useC();
  return (
    <div style={{ flex: 1, minWidth: 0 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
        <span style={{ fontFamily: 'var(--mono)', fontSize: 10, color: c.text3, letterSpacing: '0.12em' }}>{title}</span>
        <span style={{ fontFamily: 'var(--mono)', fontSize: 10, color: c.text4, background: c.subtle, border: `1px solid ${c.subtleBorder}`, borderRadius: 5, padding: '1px 7px' }}>{tasks.length}</span>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
        {tasks.map((t, i) => <TaskCard key={t.id || i} task={t} />)}
      </div>
    </div>
  );
}

// ── Cross-daemon: a single pending event tagged to this user ──────────────────
export function DaemonEventCard({ ev, onAccept, onFlag, onResolve, busy }) {
  const c = useC();
  const [flagging, setFlagging] = useState(false);
  const [reason, setReason] = useState('');
  const [suggestion, setSuggestion] = useState('');
  const p = ev.payload || {};
  const who = p.source === 'brain' ? 'The Company Brain' : (ev.from_staff?.name || 'A teammate');
  const META = {
    assignment: { accent: '#4172f5', tag: 'ASSIGNMENT', title: `${who} assigned you "${p.title}"`, body: p.brief },
    flag:       { accent: '#ef4444', tag: 'CAPACITY FLAG', title: `${who}'s daemon flagged a capacity risk: "${p.title}"`, body: [p.reason, p.suggestion && `Suggested: ${p.suggestion}`].filter(Boolean).join('\n\n') },
    handoff:    { accent: '#8b5cf6', tag: 'HANDOFF', title: `${who} handed off: "${p.title}"`, body: p.output },
    accepted:   { accent: '#10b981', tag: 'ACCEPTED', title: `${who}'s daemon accepted "${p.title}"`, body: null },
    broadcast:  { accent: '#f59e0b', tag: 'BROADCAST', title: `Company broadcast from ${who}`, body: p.message },
    availability:{ accent: c.text4, tag: 'AVAILABILITY', title: `${who} is now ${p.availability}`, body: p.reason },
  };
  const m = META[ev.type] || { accent: c.text4, tag: ev.type?.toUpperCase(), title: ev.type, body: null };

  return (
    <div style={{ padding: '13px 15px', background: c.subtle, border: `1px solid ${c.subtleBorder}`, borderLeft: `2px solid ${m.accent}`, borderRadius: 9 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
        <span style={{ fontFamily: 'var(--mono)', fontSize: 9, color: m.accent, letterSpacing: '0.1em' }}>{m.tag}</span>
        {ev.payload?.priority && <span style={{ fontFamily: 'var(--mono)', fontSize: 9, color: c.text4 }}>{ev.payload.priority}</span>}
      </div>
      <div style={{ fontFamily: 'var(--dmsans)', fontSize: 13, fontWeight: 500, color: c.text, marginBottom: m.body ? 5 : 0 }}>{m.title}</div>
      {m.body && <div style={{ fontFamily: 'var(--dmsans)', fontSize: 12.5, color: c.text3, lineHeight: 1.5, whiteSpace: 'pre-wrap' }}>{m.body}</div>}

      {ev.type === 'assignment' && !flagging && (
        <div style={{ display: 'flex', gap: 8, marginTop: 11 }}>
          <button disabled={busy} onClick={() => onAccept(ev.task_id)} style={{ padding: '7px 16px', background: '#4172f5', border: 'none', borderRadius: 7, color: '#fff', fontFamily: 'var(--dmsans)', fontSize: 12.5, fontWeight: 500, cursor: busy ? 'default' : 'pointer' }}>Accept</button>
          <button disabled={busy} onClick={() => setFlagging(true)} style={{ padding: '7px 16px', background: 'none', border: `1px solid ${c.subtleBorder}`, borderRadius: 7, color: c.text2, fontFamily: 'var(--dmsans)', fontSize: 12.5, cursor: 'pointer' }}>Flag a capacity risk</button>
          <button disabled={busy} onClick={() => onResolve(ev.id)} style={{ marginLeft: 'auto', padding: '7px 10px', background: 'none', border: 'none', color: c.text4, fontFamily: 'var(--dmsans)', fontSize: 12, cursor: 'pointer' }}>Dismiss</button>
        </div>
      )}
      {ev.type === 'assignment' && flagging && (
        <div style={{ marginTop: 11, display: 'flex', flexDirection: 'column', gap: 8 }}>
          <textarea value={reason} onChange={e => setReason(e.target.value)} placeholder="Why is this a capacity risk? (your daemon sends this back)" rows={2} style={{ width: '100%', padding: '9px 11px', background: c.bg, border: `1px solid ${c.subtleBorder}`, borderRadius: 7, color: c.text, fontFamily: 'var(--dmsans)', fontSize: 12.5, resize: 'vertical', boxSizing: 'border-box' }} />
          <input value={suggestion} onChange={e => setSuggestion(e.target.value)} placeholder="Suggested alternative (optional)" style={{ width: '100%', padding: '9px 11px', background: c.bg, border: `1px solid ${c.subtleBorder}`, borderRadius: 7, color: c.text, fontFamily: 'var(--dmsans)', fontSize: 12.5, boxSizing: 'border-box' }} />
          <div style={{ display: 'flex', gap: 8 }}>
            <button disabled={busy || !reason.trim()} onClick={() => onFlag(ev.task_id, reason, suggestion)} style={{ padding: '7px 16px', background: reason.trim() ? '#ef4444' : c.subtle, border: 'none', borderRadius: 7, color: reason.trim() ? '#fff' : c.text4, fontFamily: 'var(--dmsans)', fontSize: 12.5, fontWeight: 500, cursor: reason.trim() ? 'pointer' : 'default' }}>Send capacity flag</button>
            <button onClick={() => setFlagging(false)} style={{ padding: '7px 12px', background: 'none', border: 'none', color: c.text4, fontFamily: 'var(--dmsans)', fontSize: 12, cursor: 'pointer' }}>Cancel</button>
          </div>
        </div>
      )}
      {ev.type !== 'assignment' && (
        <button disabled={busy} onClick={() => onResolve(ev.id)} style={{ marginTop: 10, padding: '5px 12px', background: 'none', border: `1px solid ${c.subtleBorder}`, borderRadius: 7, color: c.text3, fontFamily: 'var(--dmsans)', fontSize: 12, cursor: 'pointer' }}>Got it</button>
      )}
    </div>
  );
}

// ── Cross-daemon: assign work; surfaces the capacity-risk decision (Scenario 2) ─
export function AssignComposer({ members, token, onDone }) {
  const c = useC();
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState('');
  const [brief, setBrief] = useState('');
  const [assignee, setAssignee] = useState('');
  const [priority, setPriority] = useState('P2');
  const [risk, setRisk] = useState(null);   // {capacity, alternatives}
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  const reset = () => { setTitle(''); setBrief(''); setAssignee(''); setPriority('P2'); setRisk(null); setErr(''); };

  const submit = async (toId, force) => {
    setBusy(true); setErr('');
    try {
      const r = await fetch('/api/tasks', {
        method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ action: 'assign', to_user_id: toId, title, brief, priority, force: !!force }),
      });
      const d = await r.json();
      if (!r.ok) { setErr(d.error || 'Could not assign'); return; }
      if (d.outcome === 'risk') { setRisk(d); return; }   // surface decision
      reset(); setOpen(false); onDone();
    } catch { setErr('Network error'); } finally { setBusy(false); }
  };

  if (!open) {
    return (
      <button onClick={() => setOpen(true)} style={{ padding: '8px 16px', background: '#4172f5', border: 'none', borderRadius: 8, color: '#fff', fontFamily: 'var(--dmsans)', fontSize: 13, fontWeight: 500, cursor: 'pointer' }}>
        + Assign via daemon
      </button>
    );
  }

  const canSubmit = title.trim() && assignee && !busy;

  return (
    <div style={{ width: '100%', padding: 16, background: c.subtle, border: `1px solid ${c.subtleBorder}`, borderRadius: 11, marginBottom: 20 }}>
      <div style={{ fontFamily: 'var(--dmsans)', fontSize: 13, fontWeight: 600, color: c.text, marginBottom: 12 }}>Assign work — your daemon checks their capacity first</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
        <input value={title} onChange={e => setTitle(e.target.value)} placeholder="Task title" style={{ padding: '10px 12px', background: c.bg, border: `1px solid ${c.subtleBorder}`, borderRadius: 8, color: c.text, fontFamily: 'var(--dmsans)', fontSize: 13, boxSizing: 'border-box' }} />
        <textarea value={brief} onChange={e => setBrief(e.target.value)} placeholder="Brief / context (becomes the assignee's daemon context)" rows={2} style={{ padding: '10px 12px', background: c.bg, border: `1px solid ${c.subtleBorder}`, borderRadius: 8, color: c.text, fontFamily: 'var(--dmsans)', fontSize: 13, resize: 'vertical', boxSizing: 'border-box' }} />
        <div style={{ display: 'flex', gap: 9 }}>
          <select value={assignee} onChange={e => setAssignee(e.target.value)} style={{ flex: 1, padding: '10px 12px', background: c.bg, border: `1px solid ${c.subtleBorder}`, borderRadius: 8, color: assignee ? c.text : c.text4, fontFamily: 'var(--dmsans)', fontSize: 13 }}>
            <option value="">Assign to…</option>
            {members.map(m => <option key={m.id} value={m.id}>{m.name || m.title || 'Teammate'}</option>)}
          </select>
          <select value={priority} onChange={e => setPriority(e.target.value)} style={{ width: 90, padding: '10px 12px', background: c.bg, border: `1px solid ${c.subtleBorder}`, borderRadius: 8, color: c.text, fontFamily: 'var(--mono)', fontSize: 12 }}>
            {['P0','P1','P2','P3'].map(p => <option key={p} value={p}>{p}</option>)}
          </select>
        </div>
      </div>

      {err && <div style={{ marginTop: 10, fontFamily: 'var(--dmsans)', fontSize: 12.5, color: '#ef4444' }}>{err}</div>}

      {/* Capacity-risk decision surfaced by the assignee's daemon (Scenario 2) */}
      {risk && (
        <div style={{ marginTop: 13, padding: 13, background: 'rgba(239,68,68,0.05)', border: '1px solid rgba(239,68,68,0.25)', borderRadius: 9 }}>
          <div style={{ fontFamily: 'var(--mono)', fontSize: 9, color: '#ef4444', letterSpacing: '0.1em', marginBottom: 6 }}>⚠ ASSIGNMENT RISK DETECTED</div>
          <div style={{ fontFamily: 'var(--dmsans)', fontSize: 12.5, color: c.text2, lineHeight: 1.5, marginBottom: 11 }}>
            {(members.find(m => m.id === assignee)?.name) || 'They'} is at <strong style={{ color: '#ef4444' }}>high load</strong> — {risk.capacity?.reason}. Assigning now risks the deadline. Options:
          </div>
          <button disabled={busy} onClick={() => submit(assignee, true)} style={{ width: '100%', textAlign: 'left', padding: '9px 12px', marginBottom: 7, background: c.bg, border: `1px solid ${c.subtleBorder}`, borderRadius: 7, color: c.text2, fontFamily: 'var(--dmsans)', fontSize: 12.5, cursor: 'pointer' }}>
            Assign anyway — their daemon will flag the overload
          </button>
          {(risk.alternatives || []).filter(a => a.load !== 'high').slice(0, 3).map(a => (
            <button key={a.user_id} disabled={busy} onClick={() => { setAssignee(a.user_id); submit(a.user_id, false); }} style={{ width: '100%', textAlign: 'left', padding: '9px 12px', marginBottom: 7, background: c.bg, border: `1px solid ${c.subtleBorder}`, borderRadius: 7, color: c.text2, fontFamily: 'var(--dmsans)', fontSize: 12.5, cursor: 'pointer' }}>
              Reassign to <strong>{a.name}</strong> <span style={{ color: LOAD_STYLE[a.load]?.color }}>({a.openCount} open · {LOAD_STYLE[a.load]?.label.toLowerCase()})</span>
            </button>
          ))}
        </div>
      )}

      <div style={{ display: 'flex', gap: 8, marginTop: 13 }}>
        {!risk && (
          <button disabled={!canSubmit} onClick={() => submit(assignee, false)} style={{ padding: '8px 18px', background: canSubmit ? '#4172f5' : c.subtle, border: 'none', borderRadius: 8, color: canSubmit ? '#fff' : c.text4, fontFamily: 'var(--dmsans)', fontSize: 13, fontWeight: 500, cursor: canSubmit ? 'pointer' : 'default' }}>
            {busy ? 'Checking capacity…' : 'Assign'}
          </button>
        )}
        <button onClick={() => { reset(); setOpen(false); }} style={{ padding: '8px 14px', background: 'none', border: 'none', color: c.text4, fontFamily: 'var(--dmsans)', fontSize: 13, cursor: 'pointer' }}>Cancel</button>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// CALENDAR — unified Google + Microsoft + Notion-database view
// ─────────────────────────────────────────────────────────────────────────────


export function TasksPage() {
  const c = useC();
  const { isMobile } = useViewport();
  const { token } = useAuth();
  const [data, setData]     = useState(null);
  const [events, setEvents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError]   = useState(null);
  const [busy, setBusy]     = useState(false);
  const [view, setView]     = useState('kanban'); // kanban | list (IA §5.5)
  const [pri, setPri]       = useState('all');

  const load = useCallback(async () => {
    try {
      const [tRes, eRes] = await Promise.all([
        fetch('/api/tasks', { headers: { Authorization: `Bearer ${token}` } }),
        fetch('/api/tasks?events=1', { headers: { Authorization: `Bearer ${token}` } }),
      ]);
      if (!tRes.ok) throw new Error((await tRes.json().catch(() => ({}))).error || 'Failed to load');
      setData(await tRes.json());
      setEvents((await eRes.json().catch(() => ({}))).events || []);
      setError(null);
    } catch (e) { setError(e.message); } finally { setLoading(false); }
  }, [token]);

  useEffect(() => { if (token) load(); }, [token, load]);

  const act = async (body, optimistic) => {
    setBusy(true);
    optimistic?.();
    try {
      await fetch('/api/tasks', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify(body) });
      await load();
    } catch {} finally { setBusy(false); }
  };
  const accept      = (taskId)      => act({ action: 'accept', task_id: taskId });
  const flag        = (taskId, reason, suggestion) => act({ action: 'flag', task_id: taskId, reason, suggestion });
  const resolveEv   = (id)          => act({ action: 'resolve_event', event_id: id }, () => setEvents(prev => prev.filter(e => e.id !== id)));

  const tasks   = data?.tasks || [];
  const members = data?.members || [];
  const cols = { todo: [], inProgress: [], review: [], done: [] };
  const bucket = { todo: 'todo', pending: 'todo', delivered: 'todo', accepted: 'inProgress', in_progress: 'inProgress', flagged: 'review', handed_off: 'review', completed: 'done', done: 'done', blocked: 'review' };
  const normTasks = tasks
    .map(t => ({ ...t, priority: t.priority?.toUpperCase?.() || 'P2', blocked: t.status === 'blocked' || t.status === 'flagged' }))
    .filter(t => pri === 'all' || t.priority === pri);
  for (const t of normTasks) (cols[bucket[t.status] || 'todo']).push(t);
  const total = tasks.length;
  const done  = cols.done.length;
  const pct   = total > 0 ? Math.round((done / total) * 100) : 0;

  return (
    <div style={{ padding: isMobile ? '20px 16px' : '28px 32px', overflowY: 'auto', height: '100%', background: c.bg, transition: 'background 0.2s' }}>
      <div style={{ maxWidth: 1020, margin: '0 auto' }}>
        <div style={{ display: 'flex', alignItems: isMobile ? 'flex-start' : 'flex-end', flexDirection: isMobile ? 'column' : 'row', justifyContent: 'space-between', marginBottom: 20, gap: isMobile ? 12 : 0 }}>
          <div>
            <p className="wd-label-blue" style={{ marginBottom: 6 }}>CROSS-DAEMON TASKS</p>
            <h1 style={{ fontFamily: 'var(--inter)', fontSize: isMobile ? 20 : 22, fontWeight: 600, color: c.text, letterSpacing: '-0.03em' }}>Tasks</h1>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            {/* View toggle (Kanban / List) + priority filter — IA §5.5 */}
            <div style={{ display: 'flex', background: c.subtle, border: `1px solid ${c.subtleBorder}`, borderRadius: 8, padding: 2 }}>
              {['kanban', 'list'].map(v => (
                <button key={v} type="button" onClick={() => setView(v)}
                  style={{ padding: '5px 12px', borderRadius: 6, border: 'none', cursor: 'pointer', fontFamily: 'var(--dmsans)', fontSize: 12, fontWeight: 600, textTransform: 'capitalize',
                    background: view === v ? '#4172f5' : 'transparent', color: view === v ? '#fff' : c.text3 }}>{v}</button>
              ))}
            </div>
            <select value={pri} onChange={e => setPri(e.target.value)}
              style={{ padding: '7px 10px', borderRadius: 8, background: c.subtle, border: `1px solid ${c.subtleBorder}`, color: c.text, fontFamily: 'var(--dmsans)', fontSize: 12.5, cursor: 'pointer', outline: 'none' }}>
              <option value="all">All priorities</option><option value="P0">P0</option><option value="P1">P1</option><option value="P2">P2</option><option value="P3">P3</option>
            </select>
            {total > 0 && (
              <div style={{ padding: '7px 14px', background: c.stat, border: `1px solid ${c.statBorder}`, borderRadius: 9 }}>
                <span style={{ fontFamily: 'var(--mono)', fontSize: 10, color: '#f59e0b', letterSpacing: '0.08em' }}>{done}/{total} · {pct}%</span>
              </div>
            )}
          </div>
        </div>

        {!loading && !error && members.length > 0 && (
          <AssignComposer members={members} token={token} onDone={load} />
        )}

        {/* Cross-daemon events tagged to this user */}
        {events.length > 0 && (
          <div style={{ marginBottom: 28 }}>
            <p style={{ fontFamily: 'var(--mono)', fontSize: 10, color: c.text3, letterSpacing: '0.12em', marginBottom: 11 }}>FROM YOUR TEAM'S DAEMONS</p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
              {events.map(ev => (
                <DaemonEventCard key={ev.id} ev={ev} busy={busy} onAccept={accept} onFlag={flag} onResolve={resolveEv} />
              ))}
            </div>
          </div>
        )}

        {total > 0 && (
          <div style={{ height: 3, background: c.d ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.08)', borderRadius: 2, overflow: 'hidden', marginBottom: 28 }}>
            <div style={{ height: '100%', width: `${pct}%`, background: '#4172f5', borderRadius: 2, transition: 'width 0.6s ease' }} />
          </div>
        )}

        {loading ? (
          <div style={{ display: 'flex', gap: 16 }}>
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 8 }}>
                <SkeletonRow height={18} radius={4} />
                {Array.from({ length: 2 + i % 2 }).map((_, j) => <SkeletonRow key={j} height={72} />)}
              </div>
            ))}
          </div>
        ) : error ? (
          <BlockAlert block={{ level: 'danger', content: `Failed to load tasks: ${error}` }} />
        ) : total === 0 ? (
          <EmptyState icon="✓" title="No tasks yet" subtitle="Assign work via your daemon above, or connect Jira/Linear." />
        ) : view === 'list' ? (
          <TaskListView tasks={normTasks} />
        ) : (
          <div style={{ display: 'flex', gap: 16, overflowX: isMobile ? 'auto' : 'visible', paddingBottom: isMobile ? 16 : 0 }}>
            {[
              { title: 'TO DO',       tasks: cols.todo },
              { title: 'IN PROGRESS', tasks: cols.inProgress },
              { title: 'IN REVIEW',   tasks: cols.review },
              { title: 'DONE',        tasks: cols.done },
            ].map(col => (
              <div key={col.title} style={{ flex: isMobile ? '0 0 260px' : 1, minWidth: isMobile ? 260 : 0 }}>
                <KanbanColumn title={col.title} tasks={col.tasks} />
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// INBOX
// ─────────────────────────────────────────────────────────────────────────────


export default TasksPage;
