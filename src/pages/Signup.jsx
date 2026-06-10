import { useState, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import DaemonMark from '../components/brand/DaemonMark.jsx';
import { useViewport } from '../context/ThemeContext.jsx';
import { useAuth } from '../context/AuthContext.jsx';

function pwStrength(pw) {
  if (!pw) return null;
  let s = 0;
  if (pw.length >= 8)  s++;
  if (pw.length >= 12) s++;
  if (/[A-Z]/.test(pw)) s++;
  if (/[0-9]/.test(pw)) s++;
  if (/[^A-Za-z0-9]/.test(pw)) s++;
  if (s <= 1) return { label: 'Weak',   color: '#ef4444', w: '25%' };
  if (s <= 2) return { label: 'Fair',   color: '#f59e0b', w: '55%' };
  if (s <= 3) return { label: 'Good',   color: '#3b6ef7', w: '78%' };
  return             { label: 'Strong', color: '#10b981', w: '100%' };
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

const STEPS = ['Account', 'Profile', 'Workspace', 'Role', 'Industry', 'Invite Team', 'Connect Tools'];

export default function Signup() {
  const navigate = useNavigate();
  const { signup, loginWithGoogle } = useAuth();
  const [email, setEmail]       = useState('');
  const [password, setPassword] = useState('');
  const [emailErr, setEmailErr] = useState('');
  const [serverErr, setServerErr] = useState('');
  const [confirmSent, setConfirmSent] = useState(false);
  const [loading, setLoading]   = useState(false);
  const [ready, setReady]       = useState(false);

  useEffect(() => { const t = setTimeout(() => setReady(true), 60); return () => clearTimeout(t); }, []);

  const validEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
  const strength   = pwStrength(password);
  const canSubmit  = validEmail && password.length >= 8 && !loading;

  function onEmailBlur() {
    if (email && !validEmail) setEmailErr('Enter a valid email address.');
  }

  async function handleSubmit(e) {
    e.preventDefault();
    if (!canSubmit) return;
    setServerErr('');
    setLoading(true);
    try {
      await signup(email, password);
      navigate('/onboarding');
    } catch (err) {
      if (err.message === '__confirm__') {
        setConfirmSent(true);
      } else {
        setServerErr(err.message || 'Could not create account. Please try again.');
      }
    } finally {
      setLoading(false);
    }
  }

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
          <div className="wd-float" style={{ marginBottom: 28 }}>
            <DaemonMark size={88} color="#3b6ef7" glow={true} />
          </div>

          <div style={{ marginBottom: 10 }}>
            <span style={{ fontFamily: 'var(--orbitron)', fontSize: 19, fontWeight: 400, color: 'rgba(255,255,255,0.7)', letterSpacing: '0.14em' }}>WORK</span>
            <span style={{ fontFamily: 'var(--orbitron)', fontSize: 19, fontWeight: 700, color: '#3b6ef7', letterSpacing: '0.14em' }}>DAEMON</span>
          </div>
          <p style={{
            fontFamily: 'var(--dmsans)', fontSize: 12,
            color: 'rgba(255,255,255,0.28)', marginBottom: 44,
          }}>
            Your company, queryable.
          </p>

          {/* Setup steps preview */}
          <div style={{ width: '100%', maxWidth: 230 }}>
            <p style={{ fontFamily: 'var(--dmsans)', fontSize: 11, fontWeight: 600, color: 'rgba(255,255,255,0.22)', letterSpacing: '0.06em', textTransform: 'uppercase', marginBottom: 14, textAlign: 'left' }}>Setup — 7 steps</p>
            {STEPS.map((step, i) => (
              <div key={step} style={{
                display: 'flex', alignItems: 'center', gap: 10,
                marginBottom: i < STEPS.length - 1 ? 10 : 0,
                opacity: i === 0 ? 1 : 0.32,
              }}>
                <div style={{
                  width: 20, height: 20, borderRadius: 5, flexShrink: 0,
                  background: i === 0 ? '#3b6ef7' : 'rgba(255,255,255,0.05)',
                  border: `1px solid ${i === 0 ? '#3b6ef7' : 'rgba(255,255,255,0.08)'}`,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontFamily: 'var(--mono)', fontSize: 9, color: '#fff',
                }}>
                  {i + 1}
                </div>
                <span style={{
                  fontFamily: 'var(--dmsans)', fontSize: 13,
                  color: i === 0 ? '#e8e8e8' : 'rgba(255,255,255,0.35)',
                  fontWeight: i === 0 ? 500 : 400,
                }}>
                  {step}
                </span>
                {i === 0 && (
                  <span style={{
                    marginLeft: 'auto',
                    fontFamily: 'var(--dmsans)', fontSize: 10, fontWeight: 500,
                    color: '#3b6ef7',
                  }}>
                    Now
                  </span>
                )}
              </div>
            ))}
          </div>
        </div>

        <p style={{
          position: 'absolute', bottom: 24,
          fontFamily: 'var(--dmsans)', fontSize: 11,
          color: 'rgba(255,255,255,0.12)',
          textAlign: 'center', left: 0, right: 0,
        }}>
          WORKDAEMON.COM
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
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 32 }}>
              <DaemonMark size={30} color="#3b6ef7" glow={true} />
              <span style={{ fontFamily: 'var(--orbitron)', fontSize: 12, fontWeight: 700, color: '#3b6ef7', letterSpacing: '0.14em' }}>WORKDAEMON</span>
            </div>
          )}

          {/* Step indicator */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 28 }}>
            <span style={{ width: 5, height: 5, borderRadius: '50%', background: '#3b6ef7', display: 'inline-block' }} />
            <span style={{ fontFamily: 'var(--dmsans)', fontSize: 12, color: 'rgba(232,232,232,0.35)' }}>
              Step 1 of 7 — Create account
            </span>
          </div>

          {/* Header */}
          <div style={{ marginBottom: 36 }}>
            <h1 style={{
              fontFamily: 'var(--dmsans)',
              fontSize: 28,
              fontWeight: 600,
              color: '#e8e8e8',
              letterSpacing: '-0.02em',
              lineHeight: 1.2,
              marginBottom: 8,
            }}>
              Join WorkDaemon.
            </h1>
            <p style={{ fontFamily: 'var(--dmsans)', fontSize: 14, color: 'rgba(232,232,232,0.38)', lineHeight: 1.55 }}>
              Your company's AI operating system. Use your work email.
            </p>
          </div>

          {/* Form */}
          <form onSubmit={handleSubmit}>

            {/* Email */}
            <div style={{ marginBottom: 20 }}>
              <label className="wd-label" style={{ display: 'block', marginBottom: 9 }}>Work Email</label>
              <div style={{ position: 'relative' }}>
                <input
                  type="email"
                  required
                  autoComplete="email"
                  placeholder="you@company.com"
                  value={email}
                  onChange={e => { setEmail(e.target.value); setEmailErr(''); setServerErr(''); }}
                  onBlur={onEmailBlur}
                  className={`wd-input${emailErr ? ' error' : ''}`}
                  style={{ paddingRight: validEmail ? 42 : 16 }}
                />
                {validEmail && (
                  <span style={{
                    position: 'absolute', right: 14, top: '50%',
                    transform: 'translateY(-50%)',
                    color: '#10b981', fontSize: 16, lineHeight: 1,
                  }}>
                    ✓
                  </span>
                )}
              </div>
              {emailErr && (
                <p style={{ fontFamily: 'var(--dmsans)', fontSize: 12, color: '#ef4444', marginTop: 6 }}>{emailErr}</p>
              )}
            </div>

            {/* Password */}
            <div style={{ marginBottom: 32 }}>
              <label className="wd-label" style={{ display: 'block', marginBottom: 9 }}>Password</label>
              <input
                type="password"
                required
                minLength={8}
                autoComplete="new-password"
                placeholder="Minimum 8 characters"
                value={password}
                onChange={e => setPassword(e.target.value)}
                className="wd-input"
              />

              {/* Strength bar */}
              {password.length > 0 && strength && (
                <div style={{ marginTop: 10 }}>
                  <div style={{
                    height: 3,
                    background: 'rgba(255,255,255,0.07)',
                    borderRadius: 2,
                    overflow: 'hidden',
                    marginBottom: 6,
                  }}>
                    <div style={{
                      height: '100%',
                      width: strength.w,
                      background: strength.color,
                      borderRadius: 2,
                      transition: 'width 0.35s, background 0.35s',
                      animation: 'wd-progress 0.35s ease both',
                    }} />
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span style={{ fontFamily: 'var(--mono)', fontSize: 8, color: strength.color, letterSpacing: '0.1em' }}>
                      {strength.label.toUpperCase()}
                    </span>
                    {password.length < 8 && (
                      <span style={{ fontFamily: 'var(--dmsans)', fontSize: 11, color: 'rgba(255,255,255,0.3)' }}>
                        {8 - password.length} more {8 - password.length === 1 ? 'character' : 'characters'}
                      </span>
                    )}
                  </div>
                </div>
              )}
            </div>

            {/* Confirmation sent */}
            {confirmSent && (
              <div style={{
                marginBottom: 20, padding: '11px 14px',
                background: 'rgba(16,185,129,0.07)', border: '1px solid rgba(16,185,129,0.22)',
                borderRadius: 9, fontFamily: 'var(--dmsans)', fontSize: 13, color: '#10b981', lineHeight: 1.5,
              }}>
                Check your email — we sent you a confirmation link to activate your account.
              </div>
            )}

            {/* Server error */}
            {serverErr && (
              <div style={{
                marginBottom: 20,
                padding: '11px 14px',
                background: 'rgba(239,68,68,0.07)',
                border: '1px solid rgba(239,68,68,0.22)',
                borderRadius: 9,
                fontFamily: 'var(--dmsans)', fontSize: 13, color: '#ef4444', lineHeight: 1.5,
              }}>
                {serverErr}
              </div>
            )}

            {/* Submit */}
            <button type="submit" disabled={!canSubmit} className="wd-btn">
              {loading ? <Spinner /> : 'CREATE ACCOUNT  →'}
            </button>
          </form>

          {/* Terms */}
          <p style={{
            marginTop: 14,
            textAlign: 'center',
            fontFamily: 'var(--dmsans)',
            fontSize: 12,
            color: 'rgba(232,232,232,0.22)',
            lineHeight: 1.6,
          }}>
            By continuing you agree to our{' '}
            <a href="#" style={{ color: 'rgba(232,232,232,0.42)' }} onClick={e => e.preventDefault()}>Terms</a>
            {' '}and{' '}
            <a href="#" style={{ color: 'rgba(232,232,232,0.42)' }} onClick={e => e.preventDefault()}>Privacy Policy</a>
          </p>

          {/* Divider */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, margin: '24px 0' }}>
            <div style={{ flex: 1, height: 1, background: 'rgba(255,255,255,0.07)' }} />
            <span style={{ fontFamily: 'var(--dmsans)', fontSize: 12, color: 'rgba(232,232,232,0.25)' }}>or</span>
            <div style={{ flex: 1, height: 1, background: 'rgba(255,255,255,0.07)' }} />
          </div>

          {/* Google SSO */}
          <button
            type="button"
            onClick={loginWithGoogle}
            style={{
              width: '100%', height: 44,
              background: 'rgba(255,255,255,0.05)',
              border: '1px solid rgba(255,255,255,0.09)',
              borderRadius: 8,
              color: 'rgba(232,232,232,0.55)',
              fontFamily: 'var(--dmsans)', fontSize: 14,
              cursor: 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10,
              transition: 'all 0.15s',
            }}
            onMouseEnter={e => { e.currentTarget.style.background = 'rgba(255,255,255,0.08)'; e.currentTarget.style.color = 'rgba(232,232,232,0.8)'; }}
            onMouseLeave={e => { e.currentTarget.style.background = 'rgba(255,255,255,0.05)'; e.currentTarget.style.color = 'rgba(232,232,232,0.55)'; }}
          >
            <svg width="17" height="17" viewBox="0 0 24 24" fill="none">
              <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
              <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
              <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z" fill="#FBBC05"/>
              <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
            </svg>
            Sign up with Google
          </button>

          {/* Footer */}
          <p style={{
            marginTop: 24, textAlign: 'center',
            fontFamily: 'var(--dmsans)', fontSize: 14, color: 'rgba(232,232,232,0.28)',
          }}>
            Already have an account?{' '}
            <Link to="/login" style={{ color: '#3b6ef7', fontWeight: 500 }}>
              Sign in
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}
