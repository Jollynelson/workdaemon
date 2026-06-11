// Crew — the team directory / social layer (IA spec §4). Teammates and their
// Daemons: live status, what they're working on, and Daemon→Daemon requests.
import { useState } from 'react';
import { useViewport } from '../../context/ThemeContext.jsx';
import { useAuth } from '../../context/AuthContext.jsx';
import { useC } from '../../lib/theme.jsx';
import { useFetch } from '../../lib/hooks.js';
import { SkeletonRow, EmptyState } from '../../components/ui.jsx';

const LEVEL = { 1: 'L1 · Copilot', 2: 'L2 · Assistant', 3: 'L3 · Autonomous' };
const LEVEL_COLOR = { 1: '#8a8f98', 2: '#3b6ef7', 3: '#10b981' };

function fmtJoined(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', year: 'numeric' });
}

export function CrewPage() {
  const c = useC();
  const { isMobile } = useViewport();
  const { token } = useAuth();
  const { data, loading, error } = useFetch('/api/overview?view=crew', token);

  const crew = data?.crew || [];
  const me = data?.me;

  const [q, setQ] = useState('');
  const [statusF, setStatusF] = useState('all');   // all | online | away
  const [levelF, setLevelF] = useState('all');     // all | 1 | 2 | 3
  const [selected, setSelected] = useState(null);
  const [message, setMessage] = useState('');
  const [sending, setSending] = useState(false);
  const [toast, setToast] = useState(null);

  const filtered = crew.filter(m => {
    if (statusF !== 'all' && m.status !== statusF) return false;
    if (levelF !== 'all' && String(m.level) !== levelF) return false;
    if (q.trim()) {
      const s = q.toLowerCase();
      if (!(m.name.toLowerCase().includes(s) || (m.role || '').toLowerCase().includes(s))) return false;
    }
    return true;
  });

  const open = (m) => { setSelected(m); setMessage(''); setToast(null); };

  const sendRequest = async () => {
    if (!message.trim() || !selected) return;
    setSending(true); setToast(null);
    try {
      const r = await fetch('/api/tasks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ action: 'assign', to_user_id: selected.id, title: message.trim().slice(0, 200), brief: message.trim(), force: true }),
      });
      const d = await r.json().catch(() => ({}));
      if (r.ok && d.outcome !== 'risk') { setToast({ ok: true, text: `Request sent to ${selected.name}.` }); setMessage(''); }
      else setToast({ ok: false, text: d.error || 'Could not send the request.' });
    } catch { setToast({ ok: false, text: 'Network error.' }); }
    setSending(false);
  };

  const chip = (active) => ({
    padding: '5px 11px', borderRadius: 100, cursor: 'pointer', fontFamily: 'var(--dmsans)', fontSize: 12, fontWeight: 500,
    background: active ? 'rgba(59,110,247,0.12)' : c.row, color: active ? '#3b6ef7' : c.text3,
    border: `1px solid ${active ? 'rgba(59,110,247,0.3)' : c.rowBorder}`, whiteSpace: 'nowrap',
  });

  return (
    <div style={{ padding: isMobile ? '20px 16px' : '28px 32px', overflowY: 'auto', height: '100%', background: c.bg, transition: 'background 0.2s' }}>
      <div style={{ maxWidth: 920, margin: '0 auto' }}>
        <p className="wd-label-blue" style={{ marginBottom: 8 }}>WORKSPACE</p>
        <h1 style={{ fontFamily: 'var(--inter)', fontSize: isMobile ? 20 : 24, fontWeight: 700, color: c.text, letterSpacing: '-0.03em', marginBottom: 4 }}>Crew</h1>
        <p style={{ fontFamily: 'var(--dmsans)', fontSize: 13.5, color: c.text3, marginBottom: 22 }}>Your teammates and their Daemons — who's around and what they're working on.</p>

        {/* Toolbar */}
        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8, marginBottom: 18 }}>
          <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search name or role…"
            style={{ flex: '1 1 200px', minWidth: 160, padding: '8px 12px', borderRadius: 9, background: c.subtle, border: `1px solid ${c.subtleBorder}`, color: c.text, fontFamily: 'var(--dmsans)', fontSize: 13, outline: 'none' }} />
          <div style={{ display: 'flex', gap: 5 }}>
            {['all', 'online', 'away'].map(s => <button key={s} type="button" onClick={() => setStatusF(s)} style={chip(statusF === s)}>{s === 'all' ? 'All' : s[0].toUpperCase() + s.slice(1)}</button>)}
          </div>
          <div style={{ display: 'flex', gap: 5 }}>
            {['all', '1', '2', '3'].map(l => <button key={l} type="button" onClick={() => setLevelF(l)} style={chip(levelF === l)}>{l === 'all' ? 'All levels' : `L${l}`}</button>)}
          </div>
        </div>

        {error && <EmptyState icon="⚠" title="Couldn't load the crew" subtitle={String(error)} />}

        {loading
          ? <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : 'repeat(auto-fill, minmax(240px, 1fr))', gap: 10 }}>{Array.from({ length: 6 }).map((_, i) => <SkeletonRow key={i} height={96} />)}</div>
          : filtered.length === 0
            ? <EmptyState icon="◇" title="No teammates match" subtitle="Try clearing the search or filters." />
            : (
              <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : 'repeat(auto-fill, minmax(240px, 1fr))', gap: 10 }}>
                {filtered.map(m => (
                  <button key={m.id} type="button" onClick={() => open(m)}
                    style={{ textAlign: 'left', padding: '14px 15px', background: c.card, border: `1px solid ${c.cardBorder}`, borderRadius: 12, cursor: 'pointer', transition: 'border-color 0.15s', display: 'flex', flexDirection: 'column', gap: 10 }}
                    onMouseEnter={e => { e.currentTarget.style.borderColor = '#3b6ef7'; }}
                    onMouseLeave={e => { e.currentTarget.style.borderColor = c.cardBorder; }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 11 }}>
                      <div style={{ position: 'relative', flexShrink: 0 }}>
                        <div style={{ width: 38, height: 38, borderRadius: '50%', background: '#3b6ef7', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'var(--orbitron)', fontSize: 13, fontWeight: 700, color: '#fff' }}>{m.name.charAt(0).toUpperCase()}</div>
                        <span style={{ position: 'absolute', bottom: 0, right: 0, width: 11, height: 11, borderRadius: '50%', border: `2px solid ${c.card}`, background: m.status === 'online' ? '#10b981' : '#f59e0b' }} />
                      </div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontFamily: 'var(--dmsans)', fontSize: 14, fontWeight: 600, color: c.text, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{m.name}{m.id === me && <span style={{ color: c.text4, fontWeight: 400 }}> · you</span>}</div>
                        <div style={{ fontFamily: 'var(--dmsans)', fontSize: 12, color: c.text3, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{m.role}</div>
                      </div>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                      <span style={{ fontFamily: 'var(--mono)', fontSize: 9.5, fontWeight: 600, letterSpacing: '0.04em', color: LEVEL_COLOR[m.level] || c.text3, border: `1px solid ${(LEVEL_COLOR[m.level] || '#888')}44`, borderRadius: 5, padding: '2px 7px' }}>{LEVEL[m.level] || `L${m.level}`}</span>
                      {m.id !== me && <span style={{ fontFamily: 'var(--dmsans)', fontSize: 12, color: '#3b6ef7', fontWeight: 500 }}>Send request →</span>}
                    </div>
                    <div style={{ fontFamily: 'var(--dmsans)', fontSize: 12, color: c.text3, lineHeight: 1.45, borderTop: `1px solid ${c.subtleBorder}`, paddingTop: 9 }}>
                      {m.activity || 'No recent activity'}
                    </div>
                  </button>
                ))}
              </div>
            )}
      </div>

      {/* Slide-out detail + compose */}
      {selected && (
        <>
          <div onClick={() => setSelected(null)} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', zIndex: 60 }} />
          <div style={{ position: 'fixed', top: 0, right: 0, bottom: 0, width: isMobile ? '100%' : 380, background: c.bg, borderLeft: `1px solid ${c.cardBorder}`, zIndex: 61, padding: 24, overflowY: 'auto', boxShadow: '-12px 0 40px rgba(0,0,0,0.4)' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
              <span className="wd-label">CREW MEMBER</span>
              <button type="button" onClick={() => setSelected(null)} style={{ background: 'none', border: 'none', color: c.text3, cursor: 'pointer', fontSize: 18 }}>✕</button>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 13, marginBottom: 20 }}>
              <div style={{ width: 48, height: 48, borderRadius: '50%', background: '#3b6ef7', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'var(--orbitron)', fontSize: 17, fontWeight: 700, color: '#fff', flexShrink: 0 }}>{selected.name.charAt(0).toUpperCase()}</div>
              <div>
                <div style={{ fontFamily: 'var(--inter)', fontSize: 17, fontWeight: 700, color: c.text }}>{selected.name}</div>
                <div style={{ fontFamily: 'var(--dmsans)', fontSize: 13, color: c.text3 }}>{selected.role}</div>
              </div>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 22 }}>
              {[['Daemon level', LEVEL[selected.level] || `L${selected.level}`], ['Status', selected.status === 'online' ? 'Online' : 'Away'], ['Joined', fmtJoined(selected.joinedAt)], ['Currently', selected.activity || 'No recent activity']].map(([k, v]) => (
                <div key={k} style={{ display: 'flex', justifyContent: 'space-between', gap: 12, fontFamily: 'var(--dmsans)', fontSize: 13 }}>
                  <span style={{ color: c.text3 }}>{k}</span>
                  <span style={{ color: c.text2, textAlign: 'right' }}>{v}</span>
                </div>
              ))}
            </div>

            {selected.id === me ? (
              <div style={{ padding: '12px 14px', background: c.subtle, border: `1px solid ${c.subtleBorder}`, borderRadius: 9, fontFamily: 'var(--dmsans)', fontSize: 13, color: c.text3 }}>This is you.</div>
            ) : (
              <>
                <p className="wd-label" style={{ marginBottom: 8 }}>SEND REQUEST</p>
                <p style={{ fontFamily: 'var(--dmsans)', fontSize: 12, color: c.text3, marginBottom: 8, lineHeight: 1.5 }}>Your Daemon routes this to {selected.name.split(' ')[0]}'s — it lands as a task in their queue.</p>
                <textarea value={message} onChange={e => setMessage(e.target.value)} rows={4} placeholder={`e.g. Can you review the Q3 pricing deck before Friday?`}
                  style={{ width: '100%', boxSizing: 'border-box', padding: '11px 13px', borderRadius: 9, background: c.subtle, border: `1px solid ${c.subtleBorder}`, color: c.text, fontFamily: 'var(--dmsans)', fontSize: 13.5, outline: 'none', resize: 'vertical', lineHeight: 1.5 }} />
                {toast && (
                  <div style={{ marginTop: 10, padding: '9px 12px', borderRadius: 8, fontFamily: 'var(--dmsans)', fontSize: 12.5, background: toast.ok ? 'rgba(16,185,129,0.08)' : 'rgba(239,68,68,0.08)', border: `1px solid ${toast.ok ? 'rgba(16,185,129,0.3)' : 'rgba(239,68,68,0.3)'}`, color: toast.ok ? '#10b981' : '#ef4444' }}>{toast.ok ? '✓ ' : '✗ '}{toast.text}</div>
                )}
                <button type="button" onClick={sendRequest} disabled={sending || !message.trim()}
                  style={{ marginTop: 12, width: '100%', padding: '11px', borderRadius: 9, border: 'none', background: message.trim() && !sending ? '#3b6ef7' : c.subtleBorder, color: message.trim() && !sending ? '#fff' : c.text3, fontFamily: 'var(--dmsans)', fontSize: 14, fontWeight: 600, cursor: message.trim() && !sending ? 'pointer' : 'not-allowed' }}>
                  {sending ? 'Sending…' : 'Send request'}
                </button>
              </>
            )}
          </div>
        </>
      )}
    </div>
  );
}

export default CrewPage;
