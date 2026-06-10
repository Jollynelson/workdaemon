// Extracted from the former 5,000-line src/pages/Dashboard.jsx (2026-06-10 split).
import { useState, useEffect, useCallback } from 'react';
import { useViewport } from '../../context/ThemeContext.jsx';
import { useAuth } from '../../context/AuthContext.jsx';
import { useC } from '../../lib/theme.jsx';
import { SkeletonRow, EmptyState } from '../../components/ui.jsx';

export const DAEMON_SCHEDULES = [
  { label: 'Every hour',     cron: '0 * * * *' },
  { label: 'Every 6 hours',  cron: '0 */6 * * *' },
  { label: 'Daily (8am)',    cron: '0 8 * * *' },
  { label: 'Weekly (Mon)',   cron: '0 8 * * 1' },
];

export function AutoDaemonsPage() {
  const c = useC();
  const { isMobile } = useViewport();
  const { token } = useAuth();
  const [agents, setAgents] = useState([]);
  const [members, setMembers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [selected, setSelected] = useState(null);   // detail payload
  const [form, setForm] = useState({ name: '', objective: '', schedule: '0 8 * * *' });
  const [daemonTab, setDaemonTab] = useState('mine'); // mine | team (IA §5.2)
  const [shareFor, setShareFor] = useState(null);     // agent being shared

  const api = useCallback(async (body) => {
    const r = await fetch('/api/agents', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify(body) });
    return r.json().catch(() => ({}));
  }, [token]);

  const load = useCallback(async () => {
    try {
      const r = await fetch('/api/agents', { headers: { Authorization: `Bearer ${token}` } });
      const d = await r.json().catch(() => ({}));
      setAgents(d.agents || []);
      setMembers(d.members || []);
    } finally { setLoading(false); }
  }, [token]);
  useEffect(() => { if (token) load(); }, [token, load]);

  const openDetail = async (id) => {
    const r = await fetch(`/api/agents?id=${id}`, { headers: { Authorization: `Bearer ${token}` } });
    setSelected(await r.json().catch(() => null));
  };

  const create = async () => {
    if (!form.name.trim() || !form.objective.trim()) return;
    setBusy(true);
    await api({ action: 'create', kind: 'knowledge', name: form.name.trim(), objective: form.objective.trim(), schedule: form.schedule });
    setForm({ name: '', objective: '', schedule: '0 8 * * *' }); setShowCreate(false);
    await load(); setBusy(false);
  };
  const runNow = async (id) => { setBusy(true); await api({ action: 'run', id }); await load(); if (selected?.agent?.id === id) await openDetail(id); setBusy(false); };
  const toggle = async (a) => { setBusy(true); await api({ action: a.status === 'active' ? 'pause' : 'resume', id: a.id }); await load(); setBusy(false); };
  const decide = async (action, actionId) => { setBusy(true); await api({ action, actionId }); if (selected?.agent?.id) await openDetail(selected.agent.id); setBusy(false); };

  const proposed = (selected?.actions || []).filter(a => a.status === 'proposed');
  const history  = (selected?.actions || []).filter(a => a.status !== 'proposed');

  return (
    <div style={{ padding: isMobile ? '20px 16px' : '28px 32px', overflowY: 'auto', height: '100%', background: c.bg }}>
      <div style={{ maxWidth: 860, margin: '0 auto' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', marginBottom: 8 }}>
          <div>
            <p className="wd-label-blue" style={{ marginBottom: 6 }}>AUTONOMOUS</p>
            <h1 style={{ fontFamily: 'var(--inter)', fontSize: isMobile ? 20 : 22, fontWeight: 600, color: c.text, letterSpacing: '-0.03em' }}>Daemons</h1>
          </div>
          <button type="button" onClick={() => { setShowCreate(s => !s); setSelected(null); }}
            style={{ padding: '9px 16px', borderRadius: 9, background: '#4172f5', border: 'none', color: '#fff', fontFamily: 'var(--inter)', fontSize: 13, fontWeight: 500, cursor: 'pointer' }}>
            {showCreate ? 'Cancel' : '+ New daemon'}
          </button>
        </div>
        <p style={{ fontFamily: 'var(--inter)', fontSize: 13, color: c.text3, marginBottom: 22, maxWidth: 560 }}>
          Autonomous workers that run on a schedule, read your Company Brain, and propose actions for you to approve — like an automation builder, but grounded in what your company already knows.
        </p>

        {/* Create form */}
        {showCreate && (
          <div style={{ background: c.card, border: `1px solid ${c.cardBorder}`, borderRadius: 12, padding: 18, marginBottom: 24 }}>
            <label style={{ fontFamily: 'var(--mono)', fontSize: 10, color: c.text3, letterSpacing: '0.1em' }}>NAME</label>
            <input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder="e.g. Outreach Daemon, Competitor Watch"
              style={{ width: '100%', margin: '6px 0 14px', padding: '10px 12px', borderRadius: 8, background: c.inputBg, border: `1px solid ${c.inputBorder}`, color: c.text, fontFamily: 'var(--inter)', fontSize: 14, boxSizing: 'border-box' }} />
            <label style={{ fontFamily: 'var(--mono)', fontSize: 10, color: c.text3, letterSpacing: '0.1em' }}>MISSION — what should it do, on its own?</label>
            <textarea value={form.objective} onChange={e => setForm(f => ({ ...f, objective: e.target.value }))} rows={3}
              placeholder="e.g. Find mid-market finance teams evaluating Ramp and draft a tailored intro for each."
              style={{ width: '100%', margin: '6px 0 14px', padding: '10px 12px', borderRadius: 8, background: c.inputBg, border: `1px solid ${c.inputBorder}`, color: c.text, fontFamily: 'var(--inter)', fontSize: 14, resize: 'vertical', boxSizing: 'border-box' }} />
            <label style={{ fontFamily: 'var(--mono)', fontSize: 10, color: c.text3, letterSpacing: '0.1em' }}>SCHEDULE</label>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', margin: '8px 0 16px' }}>
              {DAEMON_SCHEDULES.map(s => (
                <button key={s.cron} type="button" onClick={() => setForm(f => ({ ...f, schedule: s.cron }))}
                  style={{ padding: '7px 12px', borderRadius: 8, fontFamily: 'var(--inter)', fontSize: 13, cursor: 'pointer',
                    background: form.schedule === s.cron ? 'rgba(65,114,245,0.12)' : c.stat,
                    border: `1px solid ${form.schedule === s.cron ? '#4172f5' : c.cardBorder}`, color: form.schedule === s.cron ? '#4172f5' : c.text2 }}>
                  {s.label}
                </button>
              ))}
            </div>
            <button type="button" disabled={busy || !form.name.trim() || !form.objective.trim()} onClick={create}
              style={{ padding: '10px 18px', borderRadius: 9, background: '#4172f5', border: 'none', color: '#fff', fontFamily: 'var(--inter)', fontSize: 14, fontWeight: 500, cursor: 'pointer', opacity: (busy || !form.name.trim() || !form.objective.trim()) ? 0.5 : 1 }}>
              {busy ? 'Creating…' : 'Create daemon'}
            </button>
          </div>
        )}

        {/* Detail view */}
        {selected?.agent && (
          <div style={{ background: c.card, border: `1px solid ${c.cardBorder}`, borderRadius: 12, padding: 18, marginBottom: 24 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 6 }}>
              <h2 style={{ fontFamily: 'var(--inter)', fontSize: 17, fontWeight: 600, color: c.text }}>{selected.agent.name}</h2>
              <button type="button" onClick={() => setSelected(null)} style={{ background: 'none', border: 'none', color: c.text3, cursor: 'pointer', fontSize: 18 }}>×</button>
            </div>
            <p style={{ fontFamily: 'var(--inter)', fontSize: 13, color: c.text2, marginBottom: 14 }}>{selected.agent.objective}</p>
            {selected.my_access && selected.my_access !== 'owner' && (
              <p style={{ fontFamily: 'var(--mono)', fontSize: 9, color: '#4172f5', letterSpacing: '0.06em', marginBottom: 12 }}>SHARED WITH YOU · {selected.my_access.toUpperCase()} ACCESS</p>
            )}

            {proposed.length > 0 ? (
              <>
                <p style={{ fontFamily: 'var(--mono)', fontSize: 10, color: c.text3, letterSpacing: '0.12em', marginBottom: 10 }}>PROPOSED ACTIONS — APPROVE TO EXECUTE</p>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
                  {proposed.map(act => (
                    <div key={act.id} style={{ padding: '12px 14px', background: c.stat, border: `1px solid ${c.cardBorder}`, borderRadius: 9 }}>
                      <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 5 }}>
                        <span style={{ fontFamily: 'var(--mono)', fontSize: 8, letterSpacing: '0.08em', color: '#4172f5', textTransform: 'uppercase', border: '1px solid rgba(65,114,245,0.3)', borderRadius: 4, padding: '1px 5px' }}>{act.type}</span>
                        <span style={{ fontFamily: 'var(--inter)', fontSize: 14, fontWeight: 500, color: c.text }}>{act.title}</span>
                      </div>
                      {act.body && <p style={{ fontFamily: 'var(--inter)', fontSize: 13, color: c.text2, margin: '0 0 6px', whiteSpace: 'pre-wrap' }}>{act.body}</p>}
                      {act.rationale && <p style={{ fontFamily: 'var(--inter)', fontSize: 12, color: c.text3, fontStyle: 'italic', margin: '0 0 8px' }}>Why: {act.rationale}</p>}
                      {['user', 'editor', 'owner'].includes(selected.my_access) ? (
                      <div style={{ display: 'flex', gap: 8 }}>
                        <button type="button" disabled={busy} onClick={() => decide('approve_action', act.id)}
                          style={{ padding: '6px 14px', borderRadius: 7, background: '#10b981', border: 'none', color: '#fff', fontFamily: 'var(--inter)', fontSize: 13, cursor: 'pointer' }}>Approve</button>
                        <button type="button" disabled={busy} onClick={() => decide('reject_action', act.id)}
                          style={{ padding: '6px 14px', borderRadius: 7, background: 'transparent', border: `1px solid ${c.cardBorder}`, color: c.text2, fontFamily: 'var(--inter)', fontSize: 13, cursor: 'pointer' }}>Dismiss</button>
                      </div>
                      ) : (
                        <p style={{ fontFamily: 'var(--inter)', fontSize: 12, color: c.text4, margin: 0 }}>Viewer access — approvals go to the daemon's owner.</p>
                      )}
                    </div>
                  ))}
                </div>
              </>
            ) : (
              <p style={{ fontFamily: 'var(--inter)', fontSize: 13, color: c.text3 }}>No actions awaiting approval. Run the daemon to generate proposals.</p>
            )}

            {history.length > 0 && (
              <details style={{ marginTop: 16 }}>
                <summary style={{ fontFamily: 'var(--mono)', fontSize: 10, color: c.text3, letterSpacing: '0.12em', cursor: 'pointer' }}>HISTORY ({history.length})</summary>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 10 }}>
                  {history.map(a => (
                    <div key={a.id} style={{ display: 'flex', gap: 8, alignItems: 'center', fontFamily: 'var(--inter)', fontSize: 13, color: c.text2 }}>
                      <span style={{ color: a.status === 'done' ? '#10b981' : a.status === 'rejected' ? c.text3 : '#ef4444' }}>{a.status === 'done' ? '✓' : a.status === 'rejected' ? '–' : '×'}</span>
                      <span style={{ flex: 1, minWidth: 0, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{a.title}</span>
                      <span style={{ fontFamily: 'var(--mono)', fontSize: 9, color: c.text3 }}>{a.status}</span>
                    </div>
                  ))}
                </div>
              </details>
            )}
          </div>
        )}

        {/* Tabs: My Daemons / Team Daemons (IA §5.2) */}
        <div style={{ display: 'flex', gap: 4, borderBottom: `1px solid ${c.cardBorder}`, marginBottom: 18 }}>
          {[['mine', 'My Daemons'], ['team', 'Team Daemons']].map(([k, label]) => (
            <button key={k} type="button" onClick={() => { setDaemonTab(k); setSelected(null); }}
              style={{ padding: '9px 13px', background: 'none', border: 'none', borderBottom: `2px solid ${daemonTab === k ? '#4172f5' : 'transparent'}`, marginBottom: -1, cursor: 'pointer', fontFamily: 'var(--dmsans)', fontSize: 13, fontWeight: 600, color: daemonTab === k ? '#4172f5' : c.text3 }}>{label}</button>
          ))}
        </div>

        {/* List */}
        {loading ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>{Array.from({ length: 3 }).map((_, i) => <SkeletonRow key={i} height={64} />)}</div>
        ) : (() => {
          const list = agents.filter(a => daemonTab === 'mine' ? a.mine : !a.mine);
          if (list.length === 0) {
            return daemonTab === 'mine'
              ? (!showCreate && <EmptyState icon="◎" title="No daemons yet" subtitle="Create your first autonomous daemon — give it a mission and a schedule, and it will propose brain-grounded actions for you to approve." cta="+ New daemon" onCta={() => setShowCreate(true)} />)
              : <EmptyState icon="◎" title="No team daemons yet" subtitle="When a teammate shares a daemon with you, it will appear here." />;
          }
          return (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {list.map(a => (
              <div key={a.id} style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '14px 16px', background: c.card, border: `1px solid ${selected?.agent?.id === a.id ? '#4172f5' : c.cardBorder}`, borderRadius: 11, cursor: 'pointer' }}
                onClick={() => openDetail(a.id)}>
                <span style={{ width: 9, height: 9, borderRadius: '50%', flexShrink: 0, background: a.status === 'active' ? '#10b981' : c.text4 }} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontFamily: 'var(--inter)', fontSize: 15, fontWeight: 500, color: c.text }}>{a.name}
                    <span style={{ fontFamily: 'var(--mono)', fontSize: 8, color: c.text3, marginLeft: 8, letterSpacing: '0.06em' }}>{a.kind === 'knowledge' ? 'KNOWLEDGE' : 'OUTREACH'}</span>
                    {!a.mine && <span style={{ fontFamily: 'var(--mono)', fontSize: 8, color: '#4172f5', marginLeft: 6, letterSpacing: '0.06em', border: '1px solid rgba(65,114,245,0.3)', borderRadius: 4, padding: '1px 5px' }}>{(a.my_access || 'viewer').toUpperCase()}</span>}
                    {a.mine && a.shares?.length > 0 && <span style={{ fontFamily: 'var(--mono)', fontSize: 8, color: '#10b981', marginLeft: 6, letterSpacing: '0.06em', border: '1px solid rgba(16,185,129,0.3)', borderRadius: 4, padding: '1px 5px' }}>SHARED</span>}
                  </div>
                  <div style={{ fontFamily: 'var(--inter)', fontSize: 12, color: c.text3, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', marginTop: 2 }}>{a.objective}</div>
                </div>
                {a.mine && (
                  <button type="button" onClick={e => { e.stopPropagation(); setShareFor(a); }}
                    style={{ padding: '6px 12px', borderRadius: 7, background: 'rgba(65,114,245,0.08)', border: '1px solid rgba(65,114,245,0.25)', color: '#4172f5', fontFamily: 'var(--inter)', fontSize: 12, cursor: 'pointer', flexShrink: 0 }}>Share</button>
                )}
                {/* User-level access (and above) may trigger a run; viewers cannot. */}
                {(a.mine || ['user', 'editor', 'owner'].includes(a.my_access)) && (
                  <button type="button" disabled={busy} onClick={e => { e.stopPropagation(); runNow(a.id); }}
                    style={{ padding: '6px 12px', borderRadius: 7, background: c.stat, border: `1px solid ${c.cardBorder}`, color: c.text2, fontFamily: 'var(--inter)', fontSize: 12, cursor: 'pointer', flexShrink: 0 }}>Run now</button>
                )}
                {(a.mine || ['editor', 'owner'].includes(a.my_access)) && (
                  <button type="button" disabled={busy} onClick={e => { e.stopPropagation(); toggle(a); }}
                    style={{ padding: '6px 12px', borderRadius: 7, background: 'transparent', border: `1px solid ${c.cardBorder}`, color: c.text3, fontFamily: 'var(--inter)', fontSize: 12, cursor: 'pointer', flexShrink: 0 }}>{a.status === 'active' ? 'Pause' : 'Resume'}</button>
                )}
              </div>
            ))}
          </div>
          );
        })()}
      </div>
      {shareFor && <ShareDaemonDialog c={c} agent={shareFor} members={members} api={api} onClose={() => setShareFor(null)} onChanged={load} />}
    </div>
  );
}

// Share dialog for Team Daemons (IA §5.2.3): add people or company-wide at an
// access level (Viewer/User/Editor/Owner), and revoke existing shares.
export function ShareDaemonDialog({ c, agent, members, api, onClose, onChanged }) {
  const [who, setWho] = useState('');         // user_id or 'company'
  const [level, setLevel] = useState('viewer');
  const [busy, setBusy] = useState(false);
  const shares = agent.shares || [];
  const LEVELS = [['viewer', 'Viewer — see it & its output'], ['user', 'User — also run it'], ['editor', 'Editor — also edit config'], ['owner', 'Owner — full control']];
  const add = async () => {
    if (!who) return;
    setBusy(true);
    await api({ action: 'share', id: agent.id, ...(who === 'company' ? { company_wide: true } : { user_id: who }), access_level: level });
    setBusy(false); setWho(''); onChanged?.();
  };
  const revoke = async (s) => {
    setBusy(true);
    await api({ action: 'unshare', id: agent.id, ...(s.company_wide ? { company_wide: true } : { user_id: s.shared_with }) });
    setBusy(false); onChanged?.();
  };
  const ip = { padding: '9px 11px', borderRadius: 8, background: c.subtle, border: `1px solid ${c.subtleBorder}`, color: c.text, fontFamily: 'var(--dmsans)', fontSize: 13, outline: 'none' };
  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 200, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
      <div onClick={e => e.stopPropagation()} style={{ width: 440, maxWidth: '100%', background: c.card, border: `1px solid ${c.cardBorder}`, borderRadius: 14, padding: 20 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
          <h3 style={{ fontFamily: 'var(--inter)', fontSize: 16, fontWeight: 600, color: c.text, margin: 0 }}>Share “{agent.name}”</h3>
          <button type="button" onClick={onClose} style={{ background: 'none', border: 'none', color: c.text3, cursor: 'pointer', fontSize: 20 }}>×</button>
        </div>
        <p style={{ fontFamily: 'var(--dmsans)', fontSize: 12.5, color: c.text3, margin: '0 0 14px' }}>Give people access like a shared doc. You stay the owner.</p>
        <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
          <select value={who} onChange={e => setWho(e.target.value)} style={{ ...ip, flex: 1, cursor: 'pointer' }}>
            <option value="">Add a person…</option>
            <option value="company">Everyone at the company</option>
            {members.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
          </select>
        </div>
        <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
          <select value={level} onChange={e => setLevel(e.target.value)} style={{ ...ip, flex: 1, cursor: 'pointer' }}>
            {LEVELS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
          <button type="button" onClick={add} disabled={busy || !who} style={{ padding: '9px 18px', borderRadius: 8, background: '#4172f5', border: 'none', color: '#fff', fontFamily: 'var(--dmsans)', fontSize: 13, fontWeight: 600, cursor: 'pointer', opacity: busy || !who ? 0.6 : 1 }}>Add</button>
        </div>
        {shares.length > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <p style={{ fontFamily: 'var(--mono)', fontSize: 9.5, letterSpacing: '0.1em', color: c.text4, margin: 0 }}>SHARED WITH</p>
            {shares.map((s, i) => (
              <div key={i} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 11px', background: c.subtle, border: `1px solid ${c.subtleBorder}`, borderRadius: 8 }}>
                <span style={{ fontFamily: 'var(--dmsans)', fontSize: 13, color: c.text }}>{s.name} <span style={{ fontFamily: 'var(--mono)', fontSize: 9, color: c.text4, marginLeft: 4 }}>{s.access_level.toUpperCase()}</span></span>
                <button type="button" onClick={() => revoke(s)} style={{ background: 'none', border: 'none', color: '#ef4444', fontFamily: 'var(--dmsans)', fontSize: 12, cursor: 'pointer' }}>Remove</button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}


export default AutoDaemonsPage;
