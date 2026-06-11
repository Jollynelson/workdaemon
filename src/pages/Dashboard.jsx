import { lazy, Suspense, useState } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import Sidebar from '../components/layout/Sidebar.jsx';
import DaemonMark from '../components/brand/DaemonMark.jsx';
import { useTheme, useViewport } from '../context/ThemeContext.jsx';
import { useAuth } from '../context/AuthContext.jsx';
import { useC } from '../lib/theme.jsx';

// Route-level code splitting: each page loads on first visit (this file was a
// single 5,000-line module / one giant chunk before the 2026-06-10 split).
const DaemonPage       = lazy(() => import('./app/DaemonPage.jsx'));
const AutoDaemonsPage  = lazy(() => import('./app/AutoDaemonsPage.jsx'));
const CrewPage         = lazy(() => import('./app/CrewPage.jsx'));
const SkillsPage       = lazy(() => import('./app/SkillsPage.jsx'));
const CalendarPage     = lazy(() => import('./app/CalendarPage.jsx'));
const BrainPage        = lazy(() => import('./app/BrainPage.jsx'));
const TasksPage        = lazy(() => import('./app/TasksPage.jsx'));
const InboxPage        = lazy(() => import('./app/InboxPage.jsx'));
const IntegrationsPage = lazy(() => import('./app/IntegrationsPage.jsx'));
const OverviewPage     = lazy(() => import('./app/OverviewPage.jsx'));
const TeamPage         = lazy(() => import('./app/TeamPage.jsx'));
const AuditPage        = lazy(() => import('./app/AuditPage.jsx'));
const ProfilePage      = lazy(() => import('./app/ProfilePage.jsx'));
const SettingsPage     = lazy(() => import('./app/SettingsPage.jsx'));

function PageFallback() {
  const c = useC();
  return (
    <div style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', background: c.bg }}>
      <div style={{ width: 18, height: 18, border: '2px solid rgba(128,128,128,0.25)', borderTopColor: '#3b6ef7', borderRadius: '50%', animation: 'wd-spin 0.75s linear infinite' }} />
    </div>
  );
}

function AdminRoute({ isAdmin, children }) {
  const c = useC();
  if (isAdmin) return children;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', gap: 16, background: c.bg, transition: 'background 0.2s' }}>
      <div style={{ width: 44, height: 44, borderRadius: 12, background: c.subtle, border: `1px solid ${c.subtleBorder}`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 20 }}>🔒</div>
      <div style={{ textAlign: 'center' }}>
        <p style={{ fontFamily: 'var(--dmsans)', fontSize: 15, fontWeight: 600, color: c.text, marginBottom: 6 }}>Admin access required</p>
        <p style={{ fontFamily: 'var(--dmsans)', fontSize: 13, color: c.text3 }}>Company Brain is restricted to workspace admins.</p>
      </div>
    </div>
  );
}

function MobileTopBar({ onOpen, isLight }) {
  const c = useC();
  const { toggle } = useTheme();
  const iconColor = isLight ? 'rgba(15,20,53,0.5)' : 'rgba(255,255,255,0.45)';
  return (
    <div style={{ height: 52, display: 'flex', alignItems: 'center', padding: '0 14px', gap: 10, background: c.headerBg, borderBottom: `1px solid ${c.headerBorder}`, flexShrink: 0 }}>
      <button type="button" onClick={onOpen} style={{ width: 36, height: 36, borderRadius: 8, background: 'none', border: 'none', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 4, cursor: 'pointer', padding: 0, flexShrink: 0, color: iconColor }}>
        <span style={{ width: 18, height: 1.5, background: 'currentColor', borderRadius: 1, display: 'block' }} />
        <span style={{ width: 18, height: 1.5, background: 'currentColor', borderRadius: 1, display: 'block' }} />
        <span style={{ width: 12, height: 1.5, background: 'currentColor', borderRadius: 1, display: 'block', alignSelf: 'flex-start' }} />
      </button>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flex: 1 }}>
        <DaemonMark size={18} glow={!isLight} />
        <span style={{ fontFamily: 'var(--orbitron)', fontSize: 10, fontWeight: 700, color: '#3b6ef7', letterSpacing: '0.14em' }}>WORKDAEMON</span>
      </div>
      <button type="button" onClick={toggle} style={{ width: 32, height: 32, borderRadius: 8, background: isLight ? 'rgba(0,0,0,0.05)' : 'rgba(255,255,255,0.05)', border: `1px solid ${isLight ? 'rgba(0,0,0,0.09)' : 'rgba(255,255,255,0.08)'}`, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', fontSize: 13, flexShrink: 0 }}>
        {isLight ? '🌙' : '☀️'}
      </button>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// DASHBOARD SHELL
// ─────────────────────────────────────────────────────────────────────────────

export default function Dashboard() {
  const { isMobile } = useViewport();
  const { theme } = useTheme();
  const { profile } = useAuth();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [inChat, setInChat] = useState(false);
  const isLight = theme === 'light';
  const isAdmin = profile?.workspaces?.id
    ? true  // member of a workspace — role check done server-side per route
    : false;
  const openMenu = () => setSidebarOpen(true);

  return (
    <div style={{ display: 'flex', height: '100vh', overflow: 'hidden' }}>
      <Sidebar
        isAdmin={isAdmin}
        isOpen={!isMobile || sidebarOpen}
        onClose={() => setSidebarOpen(false)}
      />

      <div style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
        {isMobile && !inChat && <MobileTopBar onOpen={openMenu} isLight={isLight} />}

        <Suspense fallback={<PageFallback />}>
        <Routes>
          <Route path="/"            element={<Navigate to="daemon" replace />} />
          <Route path="daemon"       element={<DaemonPage onMenu={openMenu} onChatChange={setInChat} />} />
          <Route path="daemons"      element={<AutoDaemonsPage />} />
          <Route path="crew"         element={<CrewPage />} />
          <Route path="skills"       element={<SkillsPage />} />
          <Route path="calendar"     element={<CalendarPage />} />
          <Route path="brain"        element={<AdminRoute isAdmin={isAdmin}><BrainPage /></AdminRoute>} />
          <Route path="tasks"        element={<TasksPage />} />
          <Route path="inbox"        element={<InboxPage />} />
          <Route path="integrations" element={<IntegrationsPage />} />
          <Route path="overview"     element={<AdminRoute isAdmin={isAdmin}><OverviewPage /></AdminRoute>} />
          <Route path="team"         element={<AdminRoute isAdmin={isAdmin}><TeamPage /></AdminRoute>} />
          <Route path="audit"        element={<AdminRoute isAdmin={isAdmin}><AuditPage /></AdminRoute>} />
          <Route path="profile"      element={<ProfilePage />} />
          <Route path="settings"     element={<SettingsPage />} />
        </Routes>
        </Suspense>
      </div>
    </div>
  );
}
