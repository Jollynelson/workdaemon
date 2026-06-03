import { Routes, Route, Navigate } from 'react-router-dom';
import { useAuth } from './context/AuthContext.jsx';
import Login from './pages/Login.jsx';
import Signup from './pages/Signup.jsx';
import Onboarding from './pages/Onboarding.jsx';
import Dashboard from './pages/Dashboard.jsx';

function RequireAuth({ children }) {
  const { token, loading } = useAuth();
  if (loading) return null;
  if (!token) return <Navigate to="/login" replace />;
  return children;
}

function RequireGuest({ children }) {
  const { token, loading } = useAuth();
  if (loading) return null;
  if (token) return <Navigate to="/app" replace />;
  return children;
}

// Guards the /app route: requires auth AND a completed onboarding.
// New users (no profile or profile.onboarded=false with no workspace) are
// redirected to /onboarding so they complete setup before hitting the daemon.
function RequireOnboarded({ children }) {
  const { token, loading, profile, profileReady } = useAuth();
  if (loading || !profileReady) return null;
  if (!token) return <Navigate to="/login" replace />;
  const onboarded = !!(profile?.onboarded || profile?.workspace_id || profile?.workspaces?.id);
  if (!onboarded) return <Navigate to="/onboarding" replace />;
  return children;
}

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Navigate to="/login" replace />} />
      <Route path="/login"        element={<RequireGuest><Login /></RequireGuest>} />
      <Route path="/signup"       element={<RequireGuest><Signup /></RequireGuest>} />
      <Route path="/onboarding/*" element={<RequireAuth><Onboarding /></RequireAuth>} />
      <Route path="/app/*"        element={<RequireOnboarded><Dashboard /></RequireOnboarded>} />
    </Routes>
  );
}
