import { NavLink, useNavigate } from 'react-router-dom';
import DaemonMark from '../brand/DaemonMark.jsx';
import { useTheme, useViewport } from '../../context/ThemeContext.jsx';
import { useAuth } from '../../context/AuthContext.jsx';

// ── SVG icons ─────────────────────────────────────────────────────────────────

const icons = {
  daemon: (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="4" r="2" />
      <path d="M10.5 6C4 7 1 13 1.5 17.5C1.5 20.5 3.5 22.5 6.5 21.5Q9 20.5 10.5 18.5Q12 16.5 13.5 18.5Q15 20.5 17.5 21.5C20.5 22.5 22.5 20.5 22.5 17.5C23 13 20 7 13.5 6" />
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
  const { user, profile, logout } = useAuth();
  const isLight = theme === 'light';

  const displayName = profile?.name || user?.email?.split('@')[0] || '—';
  const displayRole = [profile?.title, profile?.workspaces?.name].filter(Boolean).join(' · ') || 'Workspace member';

  // On mobile: hidden unless isOpen, shown as fixed overlay
  if (isMobile && !isOpen) return null;

  const handleNavClick = () => { if (isMobile && onClose) onClose(); };

  return (
    <>
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
        background: isLight ? '#f5f5f5' : '#1e1e1e',
        borderRight: `1px solid ${isLight ? 'rgba(0,0,0,0.08)' : 'rgba(255,255,255,0.06)'}`,
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
            <DaemonMark size={28} color="#4172f5" glow={!isLight} />
            <div style={{ flex: 1 }}>
              <div style={{ fontFamily: 'var(--orbitron)', fontSize: 11, fontWeight: 700, color: '#4172f5', letterSpacing: '0.14em', lineHeight: 1 }}>WORKDAEMON</div>
              <div style={{ fontFamily: 'var(--dmsans)', fontSize: 10, color: isLight ? 'rgba(26,26,26,0.3)' : 'rgba(255,255,255,0.2)', letterSpacing: '0.02em', marginTop: 4 }}>Your company, queryable.</div>
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
        <div style={{ height: 1, background: isLight ? 'rgba(0,0,0,0.07)' : 'rgba(255,255,255,0.06)', flexShrink: 0, margin: '0 12px' }} />

        {/* Nav */}
        <nav style={{ flex: 1, overflowY: 'auto', padding: '10px 8px' }}>

          {/* Main nav */}
          <div style={{ marginBottom: 24 }}>
            <p className="wd-label" style={{ padding: '0 12px', marginBottom: 8 }}>WORKSPACE</p>
            <NavItem to="/app/daemon"       icon={icons.daemon}       label="My Daemon"    onClick={handleNavClick} />
            <NavItem to="/app/tasks"        icon={icons.tasks}        label="Tasks"        badge={3} onClick={handleNavClick} />
            <NavItem to="/app/inbox"        icon={icons.inbox}        label="Inbox"        badge={7} onClick={handleNavClick} />
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
        <div style={{ height: 1, background: isLight ? 'rgba(0,0,0,0.07)' : 'rgba(255,255,255,0.06)', flexShrink: 0, margin: '0 12px' }} />

        {/* User footer */}
        <div style={{ padding: '10px 10px 14px', flexShrink: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '8px 8px', borderRadius: 7, transition: 'background 0.12s' }}
            onMouseEnter={e => { e.currentTarget.style.background = isLight ? 'rgba(0,0,0,0.04)' : 'rgba(255,255,255,0.04)'; }}
            onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; }}>
            <div style={{
              width: 28, height: 28,
              borderRadius: 7,
              background: '#4172f5',
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
              <div style={{ fontFamily: 'var(--dmsans)', fontSize: 13, fontWeight: 500, color: isLight ? '#1a1a1a' : '#e8e8e8', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{displayName}</div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginTop: 2 }}>
                <span style={{ width: 5, height: 5, borderRadius: '50%', background: '#10b981', flexShrink: 0 }} />
                <span style={{ fontFamily: 'var(--dmsans)', fontSize: 11, color: isLight ? 'rgba(26,26,26,0.4)' : 'rgba(232,232,232,0.35)' }}>{displayRole}</span>
              </div>
            </div>
            <button
              type="button"
              onClick={async () => { await logout(); navigate('/login'); }}
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
