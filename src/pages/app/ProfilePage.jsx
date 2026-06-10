// Extracted from the former 5,000-line src/pages/Dashboard.jsx (2026-06-10 split).
import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useViewport } from '../../context/ThemeContext.jsx';
import { useAuth, supabase } from '../../context/AuthContext.jsx';
import { useC, mkGhostBtn } from '../../lib/theme.jsx';

export const PERM_LABELS = { 1: 'Copilot — reads, summarises, suggests', 2: 'Assistant — drafts actions for your approval', 3: 'Autonomous — executes and reports back' };
export const ROLE_TYPES = ['CEO/Founder', 'PM', 'Developer', 'Designer', 'HR', 'Finance', 'Sales', 'Other'];
export const ALERT_TYPES = [
  ['task_assigned', 'Task assigned to me'],
  ['action_done', 'Daemon action completed'],
  ['broadcast', 'Broadcast received'],
  ['approval', 'Approval needed'],
  ['proactive', 'Proactive alert flagged'],
];

export function ProfileField({ label, children }) {
  const c = useC();
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
      <label style={{ fontFamily: 'var(--dmsans)', fontSize: 12, fontWeight: 600, color: c.text3 }}>{label}</label>
      {children}
    </div>
  );
}

export function ProfilePage() {
  const c = useC();
  const { isMobile } = useViewport();
  const navigate = useNavigate();
  const { user, profile, token, refreshProfile } = useAuth();

  const inputSt = { padding: '10px 12px', borderRadius: 8, background: c.subtle, border: `1px solid ${c.subtleBorder}`, color: c.text, fontFamily: 'var(--dmsans)', fontSize: 14, outline: 'none', width: '100%', boxSizing: 'border-box' };
  const cardSt  = { background: c.card, border: `1px solid ${c.cardBorder}`, borderRadius: 12, padding: isMobile ? 16 : 20, display: 'flex', flexDirection: 'column', gap: 14, marginTop: 14 };
  const sectionLabel = (t) => <p className="wd-label-blue" style={{ margin: '26px 0 0' }}>{t}</p>;

  const [form, setForm] = useState({ name: '', title: '', role: '', daemon_name: '', context_brief: '' });
  const [prefs, setPrefs] = useState({});
  const [busy, setBusy] = useState(false);
  const [banner, setBanner] = useState(null);

  useEffect(() => {
    if (!profile) return;
    setForm({
      name: profile.name || '', title: profile.title || '', role: profile.role || '',
      daemon_name: profile.daemon_name || '', context_brief: profile.context_brief || '',
    });
    setPrefs(profile.notif_prefs || { email: true, task_assigned: true, approval: true });
  }, [profile]);

  const permLevel = profile?.permission_level ?? 2;
  const company   = profile?.workspaces?.name || '—';
  const initial   = (form.name || user?.email || '?').charAt(0).toUpperCase();

  const save = async (extra = {}) => {
    setBusy(true);
    try {
      const r = await fetch('/api/auth/me', {
        method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ ...form, notif_prefs: prefs, ...extra }),
      });
      if (r.ok) { setBanner({ ok: true, text: 'Saved.' }); await refreshProfile?.(); }
      else { const d = await r.json().catch(() => ({})); setBanner({ ok: false, text: d.error || 'Could not save.' }); }
    } catch { setBanner({ ok: false, text: 'Network error.' }); }
    setBusy(false);
  };

  const sendReset = async () => {
    if (!user?.email) return;
    setBusy(true);
    const { error } = await supabase.auth.resetPasswordForEmail(user.email, { redirectTo: `${window.location.origin}/login` });
    setBanner(error ? { ok: false, text: error.message } : { ok: true, text: `Password reset link sent to ${user.email}.` });
    setBusy(false);
  };

  const togglePref = (k) => setPrefs(p => ({ ...p, [k]: !p[k] }));

  return (
    <div style={{ padding: isMobile ? '20px 16px' : '28px 32px', overflowY: 'auto', height: '100%', background: c.bg, transition: 'background 0.2s' }}>
      <div style={{ maxWidth: 680, margin: '0 auto' }}>
        <p className="wd-label-blue" style={{ marginBottom: 6 }}>PROFILE</p>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          <div style={{ width: 52, height: 52, borderRadius: 14, background: '#4172f5', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'var(--orbitron)', fontSize: 20, fontWeight: 700, color: '#fff', flexShrink: 0 }}>{initial}</div>
          <div>
            <h1 style={{ fontFamily: 'var(--inter)', fontSize: isMobile ? 19 : 23, fontWeight: 700, color: c.text, margin: 0, letterSpacing: '-0.03em' }}>{form.name || 'Your profile'}</h1>
            <p style={{ fontFamily: 'var(--dmsans)', fontSize: 13, color: c.text3, marginTop: 3 }}>{[form.title, company].filter(Boolean).join(' · ')}</p>
          </div>
        </div>

        {banner && (
          <div style={{ marginTop: 16, padding: '11px 14px', borderRadius: 9, fontFamily: 'var(--dmsans)', fontSize: 13,
            background: banner.ok ? 'rgba(16,185,129,0.08)' : 'rgba(239,68,68,0.08)',
            border: `1px solid ${banner.ok ? 'rgba(16,185,129,0.3)' : 'rgba(239,68,68,0.3)'}`,
            color: banner.ok ? '#10b981' : '#ef4444' }}>{banner.ok ? '✓ ' : '✗ '}{banner.text}</div>
        )}

        {/* Identity */}
        {sectionLabel('IDENTITY')}
        <div style={cardSt}>
          <ProfileField label="Full name"><input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} style={inputSt} /></ProfileField>
          <ProfileField label="Role title"><input value={form.title} onChange={e => setForm(f => ({ ...f, title: e.target.value }))} placeholder="e.g. CEO & Founder" style={inputSt} /></ProfileField>
          <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr', gap: 14 }}>
            <ProfileField label="Email (read-only)"><input value={user?.email || ''} readOnly style={{ ...inputSt, opacity: 0.6, cursor: 'not-allowed' }} /></ProfileField>
            <ProfileField label="Company (read-only)"><input value={company} readOnly style={{ ...inputSt, opacity: 0.6, cursor: 'not-allowed' }} /></ProfileField>
          </div>
        </div>

        {/* Daemon configuration */}
        {sectionLabel('DAEMON CONFIGURATION')}
        <div style={cardSt}>
          <ProfileField label="Daemon display name"><input value={form.daemon_name} onChange={e => setForm(f => ({ ...f, daemon_name: e.target.value }))} placeholder={`${(form.name || 'Your').split(' ')[0]}'s Daemon`} style={inputSt} /></ProfileField>
          <ProfileField label="Role type — shapes your daemon's focus">
            <select value={ROLE_TYPES.includes(form.role) ? form.role : 'Other'} onChange={e => setForm(f => ({ ...f, role: e.target.value }))} style={{ ...inputSt, cursor: 'pointer' }}>
              {ROLE_TYPES.map(r => <option key={r} value={r}>{r}</option>)}
            </select>
          </ProfileField>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, padding: '11px 13px', background: c.subtle, border: `1px solid ${c.subtleBorder}`, borderRadius: 9 }}>
            <div>
              <div style={{ fontFamily: 'var(--dmsans)', fontSize: 13, fontWeight: 600, color: c.text }}>Permission level {permLevel}</div>
              <div style={{ fontFamily: 'var(--dmsans)', fontSize: 12, color: c.text3, marginTop: 2 }}>{PERM_LABELS[permLevel]}</div>
            </div>
            {permLevel < 3 && (
              <button type="button" onClick={() => setBanner({ ok: true, text: 'Upgrade request noted — an admin will review it in Team settings.' })}
                style={{ ...mkGhostBtn(c, { color: '#4172f5', borderColor: 'rgba(65,114,245,0.3)' }), padding: '7px 12px', fontSize: 12, whiteSpace: 'nowrap' }}>Request upgrade</button>
            )}
          </div>
          <ProfileField label="Daemon context brief — read at the start of every session">
            <textarea value={form.context_brief} onChange={e => setForm(f => ({ ...f, context_brief: e.target.value }))} rows={3}
              placeholder="e.g. I'm leading the Q3 launch. Prefer concise updates. Flag only blockers, not status."
              style={{ ...inputSt, resize: 'vertical' }} />
          </ProfileField>
          <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
            <button type="button" onClick={() => save()} disabled={busy}
              style={{ padding: '9px 20px', borderRadius: 8, cursor: busy ? 'default' : 'pointer', background: '#4172f5', border: '1px solid #4172f5', color: '#fff', fontFamily: 'var(--dmsans)', fontSize: 13, fontWeight: 600, opacity: busy ? 0.6 : 1 }}>
              {busy ? 'Saving…' : 'Save changes'}
            </button>
          </div>
        </div>

        {/* Notifications */}
        {sectionLabel('NOTIFICATIONS')}
        <div style={cardSt}>
          {[['email', 'Email notifications'], ...ALERT_TYPES].map(([k, label]) => (
            <div key={k} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
              <span style={{ fontFamily: 'var(--dmsans)', fontSize: 13.5, color: c.text }}>{label}</span>
              <button type="button" onClick={() => togglePref(k)}
                style={{ width: 40, height: 23, borderRadius: 12, border: 'none', cursor: 'pointer', flexShrink: 0, position: 'relative', transition: 'background 0.15s', background: prefs[k] ? '#4172f5' : c.subtleBorder }}>
                <span style={{ position: 'absolute', top: 2, left: prefs[k] ? 19 : 2, width: 19, height: 19, borderRadius: '50%', background: '#fff', transition: 'left 0.15s' }} />
              </button>
            </div>
          ))}
          <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
            <button type="button" onClick={() => save()} disabled={busy} style={{ ...mkGhostBtn(c), padding: '8px 16px', fontSize: 13 }}>Save notifications</button>
          </div>
        </div>

        {/* Personal integrations */}
        {sectionLabel('PERSONAL INTEGRATIONS')}
        <div style={{ ...cardSt, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
          <span style={{ fontFamily: 'var(--dmsans)', fontSize: 13.5, color: c.text3 }}>Connect tools so your daemon can act on your behalf.</span>
          <button type="button" onClick={() => navigate('/app/integrations')} style={{ ...mkGhostBtn(c, { color: '#4172f5', borderColor: 'rgba(65,114,245,0.3)' }), padding: '8px 14px', fontSize: 13, whiteSpace: 'nowrap' }}>Manage →</button>
        </div>

        {/* Security */}
        {sectionLabel('SECURITY')}
        <div style={{ ...cardSt, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 30 }}>
          <div>
            <div style={{ fontFamily: 'var(--dmsans)', fontSize: 13.5, fontWeight: 600, color: c.text }}>Password</div>
            <div style={{ fontFamily: 'var(--dmsans)', fontSize: 12, color: c.text3, marginTop: 2 }}>We'll email you a secure reset link.</div>
          </div>
          <button type="button" onClick={sendReset} disabled={busy} style={{ ...mkGhostBtn(c), padding: '8px 14px', fontSize: 13, whiteSpace: 'nowrap' }}>Reset password</button>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// TEAM — members + daemon permission levels (admin, IA §6.2)
// ─────────────────────────────────────────────────────────────────────────────
export const LEVEL_SHORT = { 1: 'L1 · Copilot', 2: 'L2 · Assistant', 3: 'L3 · Autonomous' };


export default ProfilePage;
