// Extracted from the former 5,000-line src/pages/Dashboard.jsx (2026-06-10 split).
import { useState, useEffect, useCallback } from 'react';
import { useViewport } from '../../context/ThemeContext.jsx';
import { useAuth } from '../../context/AuthContext.jsx';
import { useC } from '../../lib/theme.jsx';
import { SkeletonRow } from '../../components/ui.jsx';
import { LEVEL_SHORT } from './ProfilePage.jsx';

export function TeamPage() {
  const c = useC();
  const { isMobile } = useViewport();
  const { token, profile } = useAuth();
  const [team, setTeam] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(null);
  const [banner, setBanner] = useState(null);
  const inviteCode = profile?.workspaces?.invite_code;

  const load = useCallback(async () => {
    if (!token) return;
    try {
      const r = await fetch('/api/brain?tab=team', { headers: { Authorization: `Bearer ${token}` } });
      const d = await r.json();
      setTeam(d.team || []);
    } catch {}
    setLoading(false);
  }, [token]);
  useEffect(() => { load(); }, [load]);

  const setLevel = async (user_id, level) => {
    setBusy(user_id);
    setTeam(t => t.map(m => m.user_id === user_id ? { ...m, permission_level: level } : m));
    await fetch('/api/brain', {
      method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ action: 'set_permission_level', user_id, permission_level: level }),
    }).catch(() => {});
    setBusy(null);
  };

  const copyInvite = () => {
    if (!inviteCode) return;
    const link = `${window.location.origin}/join/${inviteCode}`;
    navigator.clipboard?.writeText(link);
    setBanner({ ok: true, text: 'Invite link copied to clipboard.' });
  };

  const th = { fontFamily: 'var(--mono)', fontSize: 10, letterSpacing: '0.06em', color: c.text4, textAlign: 'left', padding: '0 12px 8px', fontWeight: 600 };
  const td = { fontFamily: 'var(--dmsans)', fontSize: 13, color: c.text, padding: '12px', borderTop: `1px solid ${c.cardBorder}`, verticalAlign: 'middle' };

  return (
    <div style={{ padding: isMobile ? '20px 16px' : '28px 32px', overflowY: 'auto', height: '100%', background: c.bg, transition: 'background 0.2s' }}>
      <div style={{ maxWidth: 900, margin: '0 auto' }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>
          <div>
            <p className="wd-label-blue" style={{ marginBottom: 6 }}>ADMIN</p>
            <h1 style={{ fontFamily: 'var(--inter)', fontSize: isMobile ? 20 : 24, fontWeight: 700, color: c.text, margin: 0, letterSpacing: '-0.03em' }}>Team</h1>
            <p style={{ fontFamily: 'var(--dmsans)', fontSize: 14, color: c.text3, marginTop: 6 }}>Manage members and their daemon permission levels.</p>
          </div>
          <button type="button" onClick={copyInvite} disabled={!inviteCode}
            style={{ padding: '9px 16px', borderRadius: 9, cursor: inviteCode ? 'pointer' : 'not-allowed', whiteSpace: 'nowrap', flexShrink: 0,
              background: 'rgba(59,110,247,0.1)', border: '1px solid rgba(59,110,247,0.3)', fontFamily: 'var(--dmsans)', fontSize: 13, fontWeight: 600, color: '#3b6ef7', opacity: inviteCode ? 1 : 0.5 }}>
            + Invite member
          </button>
        </div>

        {banner && (
          <div style={{ marginTop: 16, padding: '11px 14px', borderRadius: 9, fontFamily: 'var(--dmsans)', fontSize: 13, background: 'rgba(16,185,129,0.08)', border: '1px solid rgba(16,185,129,0.3)', color: '#10b981' }}>✓ {banner.text}</div>
        )}

        <div style={{ marginTop: 20, background: c.card, border: `1px solid ${c.cardBorder}`, borderRadius: 12, padding: '14px 8px', overflowX: 'auto' }}>
          {loading ? (
            Array.from({ length: 4 }).map((_, i) => <SkeletonRow key={i} height={48} />)
          ) : (
            <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 560 }}>
              <thead><tr><th style={th}>MEMBER</th><th style={th}>ROLE</th><th style={th}>DAEMON LEVEL</th><th style={th}>STATUS</th><th style={th}>ACTIVITY</th></tr></thead>
              <tbody>
                {team.map(m => (
                  <tr key={m.user_id}>
                    <td style={td}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                        <div style={{ width: 28, height: 28, borderRadius: 8, background: '#3b6ef7', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'var(--orbitron)', fontSize: 11, fontWeight: 700, color: '#fff', flexShrink: 0 }}>{m.name.charAt(0).toUpperCase()}</div>
                        <span style={{ fontWeight: 600 }}>{m.name}</span>
                        {m.workspace_role === 'admin' && <span style={{ fontFamily: 'var(--mono)', fontSize: 8.5, color: '#3b6ef7', border: '1px solid rgba(59,110,247,0.3)', borderRadius: 4, padding: '1px 5px' }}>ADMIN</span>}
                      </div>
                    </td>
                    <td style={{ ...td, color: c.text3 }}>{m.title || '—'}</td>
                    <td style={td}>
                      <select value={m.permission_level} disabled={busy === m.user_id} onChange={e => setLevel(m.user_id, Number(e.target.value))}
                        style={{ padding: '6px 10px', borderRadius: 7, background: c.subtle, border: `1px solid ${c.subtleBorder}`, color: c.text, fontFamily: 'var(--dmsans)', fontSize: 12.5, cursor: 'pointer', outline: 'none' }}>
                        <option value={1}>{LEVEL_SHORT[1]}</option><option value={2}>{LEVEL_SHORT[2]}</option><option value={3}>{LEVEL_SHORT[3]}</option>
                      </select>
                    </td>
                    <td style={td}>
                      <span style={{ fontFamily: 'var(--mono)', fontSize: 10, letterSpacing: '0.04em', color: m.status === 'active' ? '#10b981' : '#f59e0b' }}>{m.status.toUpperCase()}</span>
                    </td>
                    <td style={{ ...td, color: c.text4, fontFamily: 'var(--mono)', fontSize: 11 }}>{m.interaction_count > 0 ? `${m.interaction_count} turns` : '—'}</td>
                  </tr>
                ))}
                {team.length === 0 && <tr><td style={{ ...td, color: c.text4 }} colSpan={5}>No members yet.</td></tr>}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// AUDIT LOG — company-wide daemon actions (admin, IA §6.4)
// ─────────────────────────────────────────────────────────────────────────────

export default TeamPage;
