// Extracted from the former 5,000-line src/pages/Dashboard.jsx (2026-06-10 split).
import { useNavigate } from 'react-router-dom';
import { useViewport } from '../../context/ThemeContext.jsx';
import { useAuth } from '../../context/AuthContext.jsx';
import { useC, ACCENT_COLORS } from '../../lib/theme.jsx';
import { useFetch } from '../../lib/hooks.js';
import { SkeletonRow, EmptyState } from '../../components/ui.jsx';
import { BlockAlert } from '../../components/blocks.jsx';

function timeAgo(iso) {
  if (!iso) return '—';
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

const HEALTH_COLOR = { connected: '#10b981', error: '#ef4444', disconnected: '#f59e0b' };

function fmtTokens(n) {
  if (!n) return '0';
  if (n >= 1e6) return `${(n / 1e6).toFixed(n >= 1e7 ? 0 : 1)}M`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(n >= 1e4 ? 0 : 1)}K`;
  return String(n);
}

export function OverviewPage() {
  const c = useC();
  const navigate = useNavigate();
  const { isMobile } = useViewport();
  const { token } = useAuth();
  const { data, loading, error } = useFetch('/api/overview', token);

  const stats        = data?.stats        || [];
  const team         = data?.team         || [];
  const activity     = data?.activity     || [];
  const integrations = data?.integrations || [];
  const alerts       = data?.alerts       || [];
  const brainLastSync = data?.brainLastSync || null;
  const tokenUsage   = data?.tokenUsage   || null;

  const quickActions = [
    { label: 'Invite team member', icon: '＋', to: '/app/team' },
    { label: 'Connect integration', icon: '⌁', to: '/app/integrations' },
    { label: 'Broadcast to Daemons', icon: '◈', to: '/app/inbox' },
  ];

  return (
    <div style={{ padding: isMobile ? '20px 16px' : '28px 32px', overflowY: 'auto', height: '100%', background: c.bg, transition: 'background 0.2s' }}>
      <div style={{ maxWidth: 860, margin: '0 auto' }}>
        <p className="wd-label-blue" style={{ marginBottom: 8 }}>ADMIN</p>
        <h1 style={{ fontFamily: 'var(--inter)', fontSize: isMobile ? 20 : 24, fontWeight: 700, color: c.text, letterSpacing: '-0.03em', marginBottom: 20 }}>Company Overview</h1>

        {error && <BlockAlert block={{ level: 'danger', content: `Failed to load overview: ${error}` }} />}

        {/* Quick actions */}
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 22 }}>
          {quickActions.map(a => (
            <button key={a.label} type="button" onClick={() => navigate(a.to)}
              style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '9px 14px', background: c.row, border: `1px solid ${c.rowBorder}`, borderRadius: 9, cursor: 'pointer', fontFamily: 'var(--dmsans)', fontSize: 13, fontWeight: 500, color: c.text2, transition: 'all 0.15s' }}
              onMouseEnter={e => { e.currentTarget.style.borderColor = '#3b6ef7'; e.currentTarget.style.color = c.text; }}
              onMouseLeave={e => { e.currentTarget.style.borderColor = c.rowBorder; e.currentTarget.style.color = c.text2; }}>
              <span style={{ color: '#3b6ef7', fontSize: 14 }}>{a.icon}</span>{a.label}
            </button>
          ))}
        </div>

        {/* System alerts */}
        {alerts.length > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 22 }}>
            {alerts.map((al, i) => (
              <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '9px 13px', borderRadius: 9, background: al.level === 'danger' ? 'rgba(239,68,68,0.08)' : 'rgba(245,158,11,0.08)', border: `1px solid ${al.level === 'danger' ? 'rgba(239,68,68,0.25)' : 'rgba(245,158,11,0.25)'}` }}>
                <span style={{ color: al.level === 'danger' ? '#ef4444' : '#f59e0b', fontSize: 13 }}>⚠</span>
                <span style={{ fontFamily: 'var(--dmsans)', fontSize: 12.5, color: c.text2 }}>{al.text}</span>
              </div>
            ))}
          </div>
        )}

        {/* Stats */}
        <div style={{ display: 'grid', gridTemplateColumns: isMobile ? 'repeat(2, 1fr)' : 'repeat(4, 1fr)', gap: 10, marginBottom: 28 }}>
          {loading
            ? Array.from({ length: 4 }).map((_, i) => <SkeletonRow key={i} height={88} />)
            : stats.map((s, i) => (
                <div key={i} style={{ padding: '14px 16px', background: c.stat, border: `1px solid ${c.statBorder}`, borderRadius: 10, boxShadow: c.statShadow }}>
                  <div style={{ fontFamily: 'var(--mono)', fontSize: 10, color: c.text3, letterSpacing: '0.1em', marginBottom: 6 }}>{s.label?.toUpperCase()}</div>
                  <div style={{ fontFamily: 'var(--orbitron)', fontSize: 20, fontWeight: 700, color: ACCENT_COLORS[s.accent] || c.text, marginBottom: 3 }}>{s.value}</div>
                  <div style={{ fontFamily: 'var(--dmsans)', fontSize: 12, color: c.text3 }}>{s.unit}</div>
                </div>
              ))
          }
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr', gap: 24 }}>
          {/* ── Left column: integration health · brain sync · token usage ── */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
            <div>
              <p className="wd-label" style={{ marginBottom: 14 }}>INTEGRATION HEALTH</p>
              {integrations.length === 0
                ? <EmptyState icon="⌁" title="No integrations" subtitle="Connect a tool to start feeding the Company Brain." />
                : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
                    {integrations.map((it, i) => (
                      <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px', background: c.row, border: `1px solid ${c.rowBorder}`, borderRadius: 9 }}>
                        <span style={{ width: 8, height: 8, borderRadius: '50%', background: HEALTH_COLOR[it.status] || '#f59e0b', flexShrink: 0 }} />
                        <div style={{ flex: 1, fontFamily: 'var(--dmsans)', fontSize: 13, fontWeight: 500, color: c.text, textTransform: 'capitalize' }}>{it.provider}</div>
                        <div style={{ fontFamily: 'var(--mono)', fontSize: 10, color: c.text3 }}>{it.lastSync ? `synced ${timeAgo(it.lastSync)}` : it.status}</div>
                      </div>
                    ))}
                  </div>
                )}
              <div style={{ fontFamily: 'var(--mono)', fontSize: 10, color: c.text4, marginTop: 8 }}>
                BRAIN LAST SYNC · {brainLastSync ? timeAgo(brainLastSync) : 'never'}
              </div>
            </div>

            <div>
              <p className="wd-label" style={{ marginBottom: 14 }}>TOKEN USAGE</p>
              <div style={{ padding: '14px 16px', background: c.row, border: `1px solid ${c.rowBorder}`, borderRadius: 9 }}>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: tokenUsage?.byUser?.length ? 12 : 4 }}>
                  <span style={{ fontFamily: 'var(--orbitron)', fontSize: 22, fontWeight: 700, color: c.text }}>{fmtTokens(tokenUsage?.total || 0)}</span>
                  <span style={{ fontFamily: 'var(--dmsans)', fontSize: 12, color: c.text3 }}>tokens · {tokenUsage?.monthLabel || 'this month'}</span>
                </div>
                {tokenUsage?.byUser?.length > 0 && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6, borderTop: `1px solid ${c.subtleBorder}`, paddingTop: 10 }}>
                    {tokenUsage.byUser.map((u, i) => (
                      <div key={i} style={{ display: 'flex', justifyContent: 'space-between', gap: 10, fontFamily: 'var(--dmsans)', fontSize: 12.5 }}>
                        <span style={{ color: c.text2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{u.name}</span>
                        <span style={{ color: c.text3, fontFamily: 'var(--mono)', fontSize: 11, flexShrink: 0 }}>{fmtTokens(u.tokens)}</span>
                      </div>
                    ))}
                  </div>
                )}
                <div style={{ fontFamily: 'var(--dmsans)', fontSize: 11, color: c.text4, marginTop: 10, lineHeight: 1.5 }}>
                  {tokenUsage?.estimated ? 'Includes estimates where a provider reported no usage. ' : 'Metered from actual model usage. '}
                  Budget alerts arrive with billing — usage runs on your BYOK keys (<strong style={{ color: c.text3 }}>Settings → AI &amp; Model</strong>).
                </div>
              </div>
            </div>
          </div>

          {/* ── Right column: activity feed · team ── */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
            <div>
              <p className="wd-label" style={{ marginBottom: 14 }}>RECENT ACTIVITY</p>
              {activity.length === 0
                ? <EmptyState icon="◇" title="No activity yet" subtitle="Daemon actions across the company show up here." />
                : (
                  <div style={{ display: 'flex', flexDirection: 'column' }}>
                    {activity.map((a, i) => (
                      <div key={i} style={{ display: 'flex', gap: 12, paddingBottom: i < activity.length - 1 ? 14 : 0 }}>
                        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', flexShrink: 0 }}>
                          <div style={{ width: 24, height: 24, borderRadius: 7, background: c.subtle, border: `1px solid ${c.subtleBorder}`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'var(--mono)', fontSize: 10, color: c.text3 }}>{a.icon}</div>
                          {i < activity.length - 1 && <div style={{ width: 1, flex: 1, background: c.subtleBorder, marginTop: 4 }} />}
                        </div>
                        <div style={{ paddingBottom: 4 }}>
                          <div style={{ fontFamily: 'var(--dmsans)', fontSize: 13, color: c.text2, lineHeight: 1.45 }}>{a.text}</div>
                          <div style={{ fontFamily: 'var(--mono)', fontSize: 9, color: c.text4, letterSpacing: '0.06em', marginTop: 3 }}>{a.source} · {timeAgo(a.time)}</div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
            </div>

            {team.length > 0 && (
              <div>
                <p className="wd-label" style={{ marginBottom: 14 }}>TEAM</p>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
                  {team.map((m, i) => (
                    <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px', background: c.row, border: `1px solid ${c.rowBorder}`, borderRadius: 9 }}>
                      <div style={{ width: 28, height: 28, borderRadius: '50%', background: '#3b6ef7', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'var(--orbitron)', fontSize: 8, fontWeight: 700, color: '#fff', flexShrink: 0 }}>{m.name?.charAt(0)}</div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontFamily: 'var(--dmsans)', fontSize: 13, fontWeight: 500, color: c.text }}>{m.name}</div>
                        <div style={{ fontFamily: 'var(--dmsans)', fontSize: 11, color: c.text3, marginTop: 1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{m.role}</div>
                      </div>
                      <span style={{ width: 7, height: 7, borderRadius: '50%', background: m.status === 'online' ? '#10b981' : '#f59e0b', flexShrink: 0 }} />
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

export default OverviewPage;
