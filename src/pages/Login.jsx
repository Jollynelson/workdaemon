import { useState, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import DaemonMark from '../components/brand/DaemonMark.jsx';
import { useViewport } from '../context/ThemeContext.jsx';

// ── Sub-components ────────────────────────────────────────────────────────
function PulsingDot({ color = '#3b6ef7', size = 6 }) {
  return (
    <span
      className="wd-dot"
      style={{ width: size, height: size, background: color }}
    />
  );
}

function Spinner() {
  return (
    <span style={{
      width: 16, height: 16, display: 'inline-block',
      border: '2px solid rgba(255,255,255,0.25)',
      borderTopColor: '#fff',
      borderRadius: '50%',
      animation: 'wd-spin 0.75s linear infinite',
    }} />
  );
}

// ── Login Page ─────────────────────────────────────────────────────────────
export default function Login() {
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [ready, setReady] = useState(false);

  useEffect(() => { const t = setTimeout(() => setReady(true), 60); return () => clearTimeout(t); }, []);

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });

      if (res.ok) {
        navigate('/app');
        return;
      }

      const body = await res.json().catch(() => ({}));
      setError(body.error || 'Invalid credentials. Please try again.');
    } catch {
      setError('Unable to reach the server. Check your connection and try again.');
    } finally {
      setLoading(false);
    }
  }

  const canSubmit = email.length > 0 && password.length > 0 && !loading;
  const { isMobile } = useViewport();

  return (
    <div style={{ height: '100vh', display: 'flex', overflow: 'hidden', background: '#191919' }}>

      {/* ────────────────── Left brand panel ────────────────── */}
      {!isMobile && <div
        className="wd-brand-panel"
        style={{
          width: '40%',
          position: 'relative',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          overflow: 'hidden',
          flexShrink: 0,
          borderRight: '1px solid rgba(255,255,255,0.06)',
        }}
      >
        {/* Main brand content */}
        <div style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          textAlign: 'center',
          padding: '0 52px',
          opacity: ready ? 1 : 0,
          transform: ready ? 'translateY(0)' : 'translateY(24px)',
          transition: 'opacity 0.6s ease, transform 0.6s ease',
        }}>
          {/* Daemon mark */}
          <div className="wd-float" style={{ marginBottom: 28 }}>
            <DaemonMark size={88} color="#4172f5" glow={true} />
          </div>

          {/* Wordmark */}
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 0, marginBottom: 10 }}>
            <span style={{ fontFamily: 'var(--orbitron)', fontSize: 20, fontWeight: 400, color: 'rgba(255,255,255,0.7)', letterSpacing: '0.14em' }}>
              WORK
            </span>
            <span style={{ fontFamily: 'var(--orbitron)', fontSize: 20, fontWeight: 700, color: '#4172f5', letterSpacing: '0.14em' }}>
              DAEMON
            </span>
          </div>

          {/* Tagline */}
          <p style={{
            fontFamily: 'var(--dmsans)',
            fontSize: 12,
            color: 'rgba(255,255,255,0.28)',
            marginBottom: 52,
            letterSpacing: '0.01em',
          }}>
            Your company, queryable.
          </p>

          {/* Divider */}
          <div style={{
            width: 180, height: 1,
            background: 'rgba(255,255,255,0.07)',
            marginBottom: 28,
          }} />

          {/* Status */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
              <span style={{ width: 5, height: 5, borderRadius: '50%', background: '#10b981', display: 'inline-block' }} />
              <span style={{ fontFamily: 'var(--dmsans)', fontSize: 11, color: 'rgba(255,255,255,0.28)' }}>
                Brain online
              </span>
            </div>
            <span style={{ color: 'rgba(255,255,255,0.1)' }}>·</span>
            <span style={{ fontFamily: 'var(--dmsans)', fontSize: 11, color: 'rgba(255,255,255,0.2)' }}>
              AES-256 encrypted
            </span>
          </div>
        </div>

        {/* Bottom label */}
        <p style={{
          position: 'absolute', bottom: 24,
          fontFamily: 'var(--dmsans)', fontSize: 11,
          color: 'rgba(255,255,255,0.1)',
          textAlign: 'center', left: 0, right: 0,
        }}>
          workdaemon.com
        </p>
      </div>}

      {/* ────────────────── Right form panel ────────────────── */}
      <div style={{
        flex: 1,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: isMobile ? '32px 24px' : '40px 48px',
        background: '#191919',
        overflow: 'auto',
      }}>
        <div style={{
          width: '100%',
          maxWidth: 380,
          opacity: ready ? 1 : 0,
          transform: ready ? 'translateY(0)' : 'translateY(20px)',
          transition: 'opacity 0.55s ease 0.12s, transform 0.55s ease 0.12s',
        }}>

          {/* Mobile logo */}
          {isMobile && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 36 }}>
              <DaemonMark size={30} color="#4172f5" glow={true} />
              <span style={{ fontFamily: 'var(--orbitron)', fontSize: 12, fontWeight: 700, color: '#4172f5', letterSpacing: '0.14em' }}>WORKDAEMON</span>
            </div>
          )}

          {/* Header */}
          <div style={{ marginBottom: 40 }}>
            <h1 style={{
              fontFamily: 'var(--dmsans)',
              fontSize: 28,
              fontWeight: 600,
              color: '#e8e8e8',
              letterSpacing: '-0.02em',
              lineHeight: 1.2,
              marginBottom: 8,
            }}>
              Welcome back.
            </h1>
            <p style={{ fontFamily: 'var(--dmsans)', fontSize: 15, color: 'rgba(232,232,232,0.38)', lineHeight: 1.5 }}>
              Sign in to your workspace.
            </p>
          </div>

          {/* Form */}
          <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>

            {/* Email field */}
            <div style={{ marginBottom: 20 }}>
              <label className="wd-label" style={{ display: 'block', marginBottom: 9 }}>
                Email Address
              </label>
              <input
                type="email"
                required
                autoComplete="email"
                placeholder="you@company.com"
                value={email}
                onChange={e => setEmail(e.target.value)}
                className="wd-input"
              />
            </div>

            {/* Password field */}
            <div style={{ marginBottom: 32 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 9 }}>
                <label className="wd-label">Password</label>
                <a
                  href="#"
                  style={{ fontFamily: 'var(--dmsans)', fontSize: 12, color: 'rgba(232,232,232,0.35)', letterSpacing: '0' }}
                  onClick={e => e.preventDefault()}
                >
                  Forgot password?
                </a>
              </div>
              <input
                type="password"
                required
                autoComplete="current-password"
                placeholder="••••••••••••"
                value={password}
                onChange={e => setPassword(e.target.value)}
                className="wd-input"
              />
            </div>

            {/* Error */}
            {error && (
              <div style={{
                marginBottom: 20,
                padding: '11px 14px',
                background: 'rgba(239,68,68,0.07)',
                border: '1px solid rgba(239,68,68,0.22)',
                borderRadius: 9,
                fontFamily: 'var(--dmsans)',
                fontSize: 13,
                color: '#ef4444',
                lineHeight: 1.5,
              }}>
                {error}
              </div>
            )}

            {/* Submit */}
            <button
              type="submit"
              disabled={!canSubmit}
              className="wd-btn"
            >
              {loading ? <Spinner /> : 'SIGN IN  →'}
            </button>
          </form>

          {/* Divider */}
          <div style={{
            display: 'flex', alignItems: 'center', gap: 12, margin: '24px 0',
          }}>
            <div style={{ flex: 1, height: 1, background: 'rgba(255,255,255,0.07)' }} />
            <span style={{ fontFamily: 'var(--dmsans)', fontSize: 12, color: 'rgba(232,232,232,0.25)' }}>or</span>
            <div style={{ flex: 1, height: 1, background: 'rgba(255,255,255,0.07)' }} />
          </div>

          {/* Google SSO button */}
          <button
            type="button"
            onClick={() => setError('SSO coming soon — use email/password for now.')}
            style={{
              width: '100%',
              height: 44,
              background: 'rgba(255,255,255,0.05)',
              border: '1px solid rgba(255,255,255,0.09)',
              borderRadius: 8,
              color: 'rgba(232,232,232,0.55)',
              fontFamily: 'var(--dmsans)',
              fontSize: 14,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 10,
              transition: 'all 0.15s',
            }}
            onMouseEnter={e => { e.currentTarget.style.background = 'rgba(255,255,255,0.08)'; e.currentTarget.style.borderColor = 'rgba(255,255,255,0.15)'; e.currentTarget.style.color = 'rgba(232,232,232,0.8)'; }}
            onMouseLeave={e => { e.currentTarget.style.background = 'rgba(255,255,255,0.05)'; e.currentTarget.style.borderColor = 'rgba(255,255,255,0.09)'; e.currentTarget.style.color = 'rgba(232,232,232,0.55)'; }}
          >
            <svg width="17" height="17" viewBox="0 0 24 24" fill="none">
              <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
              <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
              <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z" fill="#FBBC05"/>
              <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
            </svg>
            Continue with Google
          </button>

          {/* Footer */}
          <p style={{
            marginTop: 28,
            textAlign: 'center',
            fontFamily: 'var(--dmsans)',
            fontSize: 14,
            color: 'rgba(232,232,232,0.28)',
          }}>
            No account?{' '}
            <Link
              to="/signup"
              style={{ color: '#4172f5', fontWeight: 500, transition: 'opacity 0.15s' }}
              onMouseEnter={e => { e.currentTarget.style.opacity = '0.75'; }}
              onMouseLeave={e => { e.currentTarget.style.opacity = '1'; }}
            >
              Create one
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}
