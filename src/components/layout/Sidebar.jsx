import { useState, useEffect } from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import DaemonMark from '../brand/DaemonMark.jsx';
import { useTheme, useViewport } from '../../context/ThemeContext.jsx';
import { useAuth, supabase } from '../../context/AuthContext.jsx';
import { brainApi } from '../../lib/brainApi.js';

// ── SVG icons ─────────────────────────────────────────────────────────────────

const icons = {
  daemon: (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="4" r="2" />
      <path d="M10.5 6C4 7 1 13 1.5 17.5C1.5 20.5 3.5 22.5 6.5 21.5Q9 20.5 10.5 18.5Q12 16.5 13.5 18.5Q15 20.5 17.5 21.5C20.5 22.5 22.5 20.5 22.5 17.5C23 13 20 7 13.5 6" />
    </svg>
  ),
  crew: (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M23 21v-2a4 4 0 00-3-3.87" /><path d="M16 3.13a4 4 0 010 7.75" />
    </svg>
  ),
  skills: (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <path d="M14.7 6.3a1 1 0 000 1.4l1.6 1.6a1 1 0 001.4 0l3.77-3.77a6 6 0 01-7.94 7.94l-6.91 6.91a2.12 2.12 0 01-3-3l6.91-6.91a6 6 0 017.94-7.94l-3.76 3.76z" />
    </svg>
  ),
  bell: (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <path d="M18 8A6 6 0 006 8c0 7-3 9-3 9h18s-3-2-3-9" /><path d="M13.73 21a2 2 0 01-3.46 0" />
    </svg>
  ),
  tasks: (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <path d="M9 11l3 3L22 4" /><path d="M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11" />
    </svg>
  ),
  inbox: (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="22 12 16 12 14 15 10 15 8 12 2 12" /><path d="M5.45 5.11L2 12v6a2 2 0 002 2h16a2 2 0 002-2v-6l-3.45-6.89A2 2 0 0016.76 4H7.24a2 2 0 00-1.79 1.11z" />
    </svg>
  ),
  integrations: (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="18" cy="18" r="3" /><circle cx="6" cy="6" r="3" /><path d="M13 6h3a2 2 0 012 2v7M11 18H8a2 2 0 01-2-2V9" />
    </svg>
  ),
  overview: (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="3" width="7" height="7" rx="1" /><rect x="14" y="3" width="7" height="7" rx="1" /><rect x="3" y="14" width="7" height="7" rx="1" /><rect x="14" y="14" width="7" height="7" rx="1" />
    </svg>
  ),
  team: (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M23 21v-2a4 4 0 00-3-3.87" /><path d="M16 3.13a4 4 0 010 7.75" />
    </svg>
  ),
  audit: (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" /><polyline points="14 2 14 8 20 8" /><line x1="16" y1="13" x2="8" y2="13" /><line x1="16" y1="17" x2="8" y2="17" /><polyline points="10 9 9 9 8 9" />
    </svg>
  ),
  brain: (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <path d="M9.5 2A2.5 2.5 0 007 4.5v0A2.5 2.5 0 004.5 7v0A2.5 2.5 0 002 9.5v5A2.5 2.5 0 004.5 17v0A2.5 2.5 0 007 19.5v0A2.5 2.5 0 009.5 22h5a2.5 2.5 0 002.5-2.5v0a2.5 2.5 0 002.5-2.5v0A2.5 2.5 0 0022 14.5v-5A2.5 2.5 0 0019.5 7v0A2.5 2.5 0 0017 4.5v0A2.5 2.5 0 0014.5 2h-5z" />
      <path d="M9 9h.01M15 9h.01M9 15h.01M15 15h.01M12 12h.01" />
    </svg>
  ),
  calendar: (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="4" width="18" height="18" rx="2" /><line x1="16" y1="2" x2="16" y2="6" /><line x1="8" y1="2" x2="8" y2="6" /><line x1="3" y1="10" x2="21" y2="10" />
    </svg>
  ),
  daemons: (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <rect x="4" y="8" width="16" height="12" rx="2" /><path d="M12 8V4" /><circle cx="12" cy="3" r="1" /><path d="M9 13h.01M15 13h.01" /><path d="M8 20v2M16 20v2" />
    </svg>
  ),
  settings: (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z" />
    </svg>
  ),
  logout: (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4" /><polyline points="16 17 21 12 16 7" /><line x1="21" y1="12" x2="9" y2="12" />
    </svg>
  ),
  close: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
    </svg>
  ),
};

// ── Nav item ──────────────────────────────────────────────────────────────────

function NavItem({ to, icon, label, badge, onClick }) {
  return (
    <NavLink
      to={to}
      onClick={onClick}
      className={({ isActive }) => `wd-nav${isActive ? ' active' : ''}`}
    >
      <span style={{ opacity: 0.7, display: 'flex', flexShrink: 0 }}>{icon}</span>
      <span style={{ flex: 1, fontSize: 13 }}>{label}</span>
      {badge != null && (
        <span style={{
          minWidth: 18, height: 18, borderRadius: 9,
          background: 'rgba(59,110,247,0.2)',
          border: '1px solid rgba(59,110,247,0.3)',
          color: '#3b6ef7',
          fontFamily: 'var(--mono)',
          fontSize: 8,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          padding: '0 5px',
          letterSpacing: '0.05em',
        }}>{badge}</span>
      )}
    </NavLink>
  );
}

// ── Sidebar ───────────────────────────────────────────────────────────────────

export default function Sidebar({
  isAdmin = true,
  isOpen = true,
  onClose,
}) {
  const navigate = useNavigate();
  const { theme, toggle } = useTheme();
  const { isMobile } = useViewport();
  const { user, profile, logout, token } = useAuth();
  const isLight = theme === 'light';

  // Live nav badges — open tasks + pending inbox pushes. Hidden when zero.
  const [taskCount, setTaskCount] = useState(0);
  const [inboxCount, setInboxCount] = useState(0);
  const [inboxRecent, setInboxRecent] = useState([]); // last 5 items for the bell dropdown
  const [bellOpen, setBellOpen] = useState(false);
  useEffect(() => {
    if (!token) { setTaskCount(0); setInboxCount(0); setInboxRecent([]); return; }
    let alive = true;
    Promise.allSettled([
      brainApi.tasks({ token }),
      fetch('/api/inbox', { headers: { Authorization: `Bearer ${token}` } }).then(r => r.json()),
    ]).then(([t, p]) => {
      if (!alive) return;
      if (t.status === 'fulfilled') {
        const open = (t.value.tasks || []).filter(x => !['done', 'completed', 'cancelled'].includes(x.status));
        setTaskCount(open.length);
      }
      // Initial unread count + recent items from the real inbox (realtime bumps below).
      if (p.status === 'fulfilled') {
        const its = p.value.items || [];
        setInboxCount(its.filter(i => i.unread).length);
        setInboxRecent(its.slice(0, 5));
      }
    });
    return () => { alive = false; };
  }, [token]);

  // Realtime: bump the Inbox badge AND surface a toast the instant a new item
  // lands (a daemon assignment/flag/broadcast or a brain-routed task) — no polling.
  // RLS scopes the stream to this user; the websocket is authed with their JWT.
  // Graceful: if realtime fails the badge still works from the fetch above.
  const [toast, setToast] = useState(null);
  useEffect(() => {
    if (!token || !user?.id) return;
    let channel, timer;
    try {
      supabase.realtime.setAuth(token);
      channel = supabase
        .channel(`inbox:${user.id}`)
        .on('postgres_changes',
          { event: 'INSERT', schema: 'public', table: 'inbox_items', filter: `user_id=eq.${user.id}` },
          (payload) => {
            setInboxCount(c => c + 1);
            const t = payload?.new?.title;
            if (t) { setToast(t); clearTimeout(timer); timer = setTimeout(() => setToast(null), 6000); }
          })
        .subscribe();
    } catch { /* realtime unavailable — polling/fetch still covers it */ }
    return () => { clearTimeout(timer); try { if (channel) supabase.removeChannel(channel); } catch {} };
  }, [token, user?.id]);

  const displayName = profile?.name || user?.email?.split('@')[0] || '—';
  const displayRole = [profile?.title, profile?.workspaces?.name].filter(Boolean).join(' · ') || 'Workspace member';

  // On mobile: hidden unless isOpen, shown as fixed overlay
  if (isMobile && !isOpen) return null;

  const handleNavClick = () => { if (isMobile && onClose) onClose(); };

  return (
    <>
      {/* Realtime toast — a daemon just signalled this user (Brain push / assignment) */}
      {toast && (
        <div
          onClick={() => { setToast(null); navigate('/app/inbox'); }}
          style={{
            position: 'fixed', bottom: 20, right: 20, zIndex: 200, maxWidth: 320, cursor: 'pointer',
            background: isLight ? '#fff' : '#16161c', border: `1px solid ${isLight ? '#e5e3df' : '#2a2a36'}`,
            borderLeft: '3px solid #3b6ef7', borderRadius: 10, padding: '12px 14px',
            boxShadow: '0 8px 28px rgba(0,0,0,0.35)', animation: 'wd-progress 0.25s ease both',
          }}>
          <div style={{ fontFamily: 'var(--mono)', fontSize: 9, letterSpacing: '0.1em', color: '#3b6ef7', marginBottom: 4 }}>● DAEMON · LIVE</div>
          <div style={{ fontFamily: 'var(--dmsans)', fontSize: 13, color: isLight ? '#1a1a1a' : '#e8e8e8', lineHeight: 1.4 }}>{toast}</div>
        </div>
      )}

      {/* Mobile backdrop */}
      {isMobile && isOpen && (
        <div
          onClick={onClose}
          style={{
            position: 'fixed', inset: 0,
            background: 'rgba(0,0,0,0.55)',
            backdropFilter: 'blur(4px)',
            zIndex: 99,
          }}
        />
      )}

      <div style={{
        width: 240,
        height: '100vh',
        display: 'flex',
        flexDirection: 'column',
        background: isLight ? '#f6f5f4' : '#121214',
        borderRight: `1px solid ${isLight ? '#e5e3df' : '#232327'}`,
        flexShrink: 0,
        overflow: 'hidden',
        transition: 'background 0.2s, border-color 0.2s',
        ...(isMobile ? {
          position: 'fixed',
          top: 0, left: 0, bottom: 0,
          zIndex: 100,
          boxShadow: '8px 0 40px rgba(0,0,0,0.6)',
        } : {}),
      }}>

        {/* Logo */}
        <div style={{ padding: '18px 16px 14px', flexShrink: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <DaemonMark size={28} color="#3b6ef7" glow={!isLight} />
            <div style={{ flex: 1 }}>
              <div style={{ fontFamily: 'var(--orbitron)', fontSize: 11, fontWeight: 700, color: '#3b6ef7', letterSpacing: '0.14em', lineHeight: 1 }}>WORKDAEMON</div>
              <div style={{ fontFamily: 'var(--inter)', fontSize: 10, color: isLight ? '#a4a097' : '#6e6e78', letterSpacing: '0.02em', marginTop: 4 }}>Your company, queryable.</div>
            </div>
            {/* Notification bell (IA §9.1) — badge = unread; click = quick-view */}
            <div style={{ position: 'relative', flexShrink: 0 }}>
              <button type="button" onClick={() => setBellOpen(o => !o)} title="Notifications"
                style={{ width: 28, height: 28, borderRadius: 7, background: isLight ? 'rgba(59,110,247,0.08)' : 'rgba(255,255,255,0.06)', border: `1px solid ${isLight ? 'rgba(59,110,247,0.18)' : 'rgba(255,255,255,0.1)'}`, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', color: isLight ? 'rgba(15,20,53,0.5)' : 'rgba(255,255,255,0.45)', position: 'relative' }}>
                {icons.bell}
                {inboxCount > 0 && <span style={{ position: 'absolute', top: -3, right: -3, minWidth: 14, height: 14, padding: '0 3px', borderRadius: 7, background: '#ef4444', color: '#fff', fontFamily: 'var(--mono)', fontSize: 8.5, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>{inboxCount > 9 ? '9+' : inboxCount}</span>}
              </button>
              {bellOpen && (
                <>
                  <div onClick={() => setBellOpen(false)} style={{ position: 'fixed', inset: 0, zIndex: 60 }} />
                  <div style={{ position: 'absolute', top: 34, right: 0, width: 268, zIndex: 61, background: isLight ? '#fff' : '#15151b', border: `1px solid ${isLight ? '#e5e3df' : '#26262e'}`, borderRadius: 11, boxShadow: '0 12px 32px rgba(0,0,0,0.3)', overflow: 'hidden' }}>
                    <div style={{ padding: '10px 13px', borderBottom: `1px solid ${isLight ? '#eee' : '#222'}`, fontFamily: 'var(--mono)', fontSize: 9.5, letterSpacing: '0.1em', color: isLight ? '#a4a097' : '#6e6e78' }}>NOTIFICATIONS</div>
                    {inboxRecent.length === 0 ? (
                      <div style={{ padding: '16px 13px', fontFamily: 'var(--inter)', fontSize: 12.5, color: isLight ? '#a4a097' : '#6e6e78' }}>Nothing new.</div>
                    ) : inboxRecent.map(it => (
                      <div key={it.id} onClick={() => { setBellOpen(false); navigate('/app/inbox'); handleNavClick?.(); }}
                        style={{ padding: '10px 13px', borderBottom: `1px solid ${isLight ? '#f2f1ee' : '#1c1c22'}`, cursor: 'pointer', display: 'flex', gap: 8, alignItems: 'flex-start' }}
                        onMouseEnter={e => { e.currentTarget.style.background = isLight ? 'rgba(0,0,0,0.03)' : 'rgba(255,255,255,0.03)'; }}
                        onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; }}>
                        {it.unread && <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#3b6ef7', marginTop: 5, flexShrink: 0 }} />}
                        <div style={{ minWidth: 0 }}>
                          <div style={{ fontFamily: 'var(--inter)', fontSize: 12.5, fontWeight: 500, color: isLight ? '#1a1a1a' : '#ededef', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{it.title}</div>
                          <div style={{ fontFamily: 'var(--inter)', fontSize: 10.5, color: isLight ? '#a4a097' : '#6e6e78', marginTop: 1 }}>{it.source}{it.time ? ` · ${it.time}` : ''}</div>
                        </div>
                      </div>
                    ))}
                    <div onClick={() => { setBellOpen(false); navigate('/app/inbox'); handleNavClick?.(); }}
                      style={{ padding: '9px 13px', textAlign: 'center', cursor: 'pointer', fontFamily: 'var(--inter)', fontSize: 12, fontWeight: 600, color: '#3b6ef7' }}>View all →</div>
                  </div>
                </>
              )}
            </div>

            {/* Theme toggle / close button */}
            {isMobile ? (
              <button
                type="button"
                onClick={onClose}
                style={{
                  width: 28, height: 28,
                  borderRadius: 7,
                  background: isLight ? 'rgba(59,110,247,0.08)' : 'rgba(255,255,255,0.06)',
                  border: `1px solid ${isLight ? 'rgba(59,110,247,0.18)' : 'rgba(255,255,255,0.1)'}`,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  cursor: 'pointer', flexShrink: 0, color: isLight ? 'rgba(15,20,53,0.5)' : 'rgba(255,255,255,0.4)',
                }}
              >
                {icons.close}
              </button>
            ) : (
              <button
                type="button"
                onClick={toggle}
                title={isLight ? 'Switch to dark mode' : 'Switch to light mode'}
                style={{
                  width: 28, height: 28,
                  borderRadius: 7,
                  background: isLight ? 'rgba(59,110,247,0.08)' : 'rgba(255,255,255,0.06)',
                  border: `1px solid ${isLight ? 'rgba(59,110,247,0.18)' : 'rgba(255,255,255,0.1)'}`,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  cursor: 'pointer',
                  fontSize: 13,
                  transition: 'all 0.15s',
                  flexShrink: 0,
                }}
                onMouseEnter={e => { e.currentTarget.style.background = isLight ? 'rgba(59,110,247,0.14)' : 'rgba(255,255,255,0.1)'; }}
                onMouseLeave={e => { e.currentTarget.style.background = isLight ? 'rgba(59,110,247,0.08)' : 'rgba(255,255,255,0.06)'; }}
              >
                {isLight ? '🌙' : '☀️'}
              </button>
            )}
          </div>
        </div>

        {/* Divider */}
        <div style={{ height: 1, background: isLight ? '#e5e3df' : '#232327', flexShrink: 0, margin: '0 12px' }} />

        {/* Nav */}
        <nav style={{ flex: 1, overflowY: 'auto', padding: '10px 8px' }}>

          {/* Main nav */}
          <div style={{ marginBottom: 24 }}>
            <p className="wd-label" style={{ padding: '0 12px', marginBottom: 8 }}>WORKSPACE</p>
            <NavItem to="/app/daemon"       icon={icons.daemon}       label="My Daemon"    onClick={handleNavClick} />
            <NavItem to="/app/daemons"      icon={icons.daemons}      label="Daemons"      onClick={handleNavClick} />
            <NavItem to="/app/crew"         icon={icons.crew}         label="Crew"         onClick={handleNavClick} />
            <NavItem to="/app/skills"       icon={icons.skills}       label="Skills"       onClick={handleNavClick} />
            <NavItem to="/app/calendar"     icon={icons.calendar}     label="Calendar"     onClick={handleNavClick} />
            <NavItem to="/app/tasks"        icon={icons.tasks}        label="Tasks"        badge={taskCount || null} onClick={handleNavClick} />
            <NavItem to="/app/inbox"        icon={icons.inbox}        label="Inbox"        badge={inboxCount || null} onClick={handleNavClick} />
            <NavItem to="/app/integrations" icon={icons.integrations} label="Integrations" onClick={handleNavClick} />
          </div>

          {/* Admin nav */}
          {isAdmin && (
            <div style={{ marginBottom: 24 }}>
              <p className="wd-label" style={{ padding: '0 12px', marginBottom: 8 }}>ADMIN</p>
              <NavItem to="/app/overview" icon={icons.overview} label="Overview"      onClick={handleNavClick} />
              <NavItem to="/app/team"     icon={icons.team}     label="Team"          onClick={handleNavClick} />
              <NavItem to="/app/brain"    icon={icons.brain}    label="Company Brain" onClick={handleNavClick} />
              <NavItem to="/app/audit"    icon={icons.audit}    label="Audit Log"     onClick={handleNavClick} />
            </div>
          )}

          {/* Settings */}
          <NavItem to="/app/settings" icon={icons.settings} label="Settings" onClick={handleNavClick} />
        </nav>

        {/* Divider */}
        <div style={{ height: 1, background: isLight ? '#e5e3df' : '#232327', flexShrink: 0, margin: '0 12px' }} />

        {/* User footer */}
        <div style={{ padding: '10px 10px 14px', flexShrink: 0, background: isLight ? 'transparent' : '#121214' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '8px 8px', borderRadius: 7, transition: 'background 0.12s', cursor: 'pointer' }}
            title="Open profile"
            onClick={() => { navigate('/app/profile'); handleNavClick?.(); }}
            onMouseEnter={e => { e.currentTarget.style.background = isLight ? 'rgba(0,0,0,0.04)' : 'rgba(255,255,255,0.04)'; }}
            onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; }}>
            <div style={{
              width: 28, height: 28,
              borderRadius: 7,
              background: '#3b6ef7',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontFamily: 'var(--orbitron)',
              fontSize: 10,
              fontWeight: 700,
              color: '#fff',
              flexShrink: 0,
            }}>
              {displayName.charAt(0).toUpperCase()}
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontFamily: 'var(--inter)', fontSize: 13, fontWeight: 500, color: isLight ? '#1a1a1a' : '#ededef', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', letterSpacing: '-0.01em' }}>{displayName}</div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginTop: 2 }}>
                <span style={{ width: 5, height: 5, borderRadius: '50%', background: '#10b981', flexShrink: 0 }} />
                <span style={{ fontFamily: 'var(--inter)', fontSize: 11, color: isLight ? '#a4a097' : '#6e6e78' }}>{displayRole}</span>
              </div>
            </div>
            <button
              type="button"
              onClick={async (e) => { e.stopPropagation(); await logout(); navigate('/login'); }}
              title="Sign out"
              style={{
                background: 'none', border: 'none',
                color: isLight ? 'rgba(26,26,26,0.22)' : 'rgba(255,255,255,0.2)',
                cursor: 'pointer',
                padding: '4px',
                display: 'flex',
                borderRadius: 5,
                transition: 'color 0.15s',
                flexShrink: 0,
              }}
              onMouseEnter={e => { e.currentTarget.style.color = isLight ? 'rgba(26,26,26,0.55)' : 'rgba(255,255,255,0.5)'; }}
              onMouseLeave={e => { e.currentTarget.style.color = isLight ? 'rgba(26,26,26,0.22)' : 'rgba(255,255,255,0.2)'; }}
            >
              {icons.logout}
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
