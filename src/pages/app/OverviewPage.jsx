// Extracted from the former 5,000-line src/pages/Dashboard.jsx (2026-06-10 split).
import { useViewport } from '../../context/ThemeContext.jsx';
import { useAuth } from '../../context/AuthContext.jsx';
import { useC, ACCENT_COLORS } from '../../lib/theme.jsx';
import { useFetch } from '../../lib/hooks.js';
import { SkeletonRow, EmptyState } from '../../components/ui.jsx';
import { BlockAlert } from '../../components/blocks.jsx';

export function OverviewPage() {
  const c = useC();
  const { isMobile } = useViewport();
  const { token } = useAuth();
  const { data, loading, error } = useFetch('/api/overview', token);

  const stats    = data?.stats    || [];
  const team     = data?.team     || [];
  const activity = data?.activity || [];

  return (
    <div style={{ padding: isMobile ? '20px 16px' : '28px 32px', overflowY: 'auto', height: '100%', background: c.bg, transition: 'background 0.2s' }}>
      <div style={{ maxWidth: 860, margin: '0 auto' }}>
        <p className="wd-label-blue" style={{ marginBottom: 8 }}>ADMIN</p>
        <h1 style={{ fontFamily: 'var(--inter)', fontSize: isMobile ? 20 : 22, fontWeight: 600, color: c.text, letterSpacing: '-0.03em', marginBottom: 24 }}>Company Overview</h1>

        {error && <BlockAlert block={{ level: 'danger', content: `Failed to load overview: ${error}` }} />}

        {/* Stats */}
        <div style={{ display: 'grid', gridTemplateColumns: isMobile ? 'repeat(2, 1fr)' : 'repeat(4, 1fr)', gap: 10, marginBottom: 32 }}>
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

        {!loading && stats.length === 0 && !error && (
          <EmptyState icon="◈" title="No overview data" subtitle="Connect your tools to see company-wide stats, team activity, and key metrics." />
        )}

        {!loading && (team.length > 0 || activity.length > 0) && (
          <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr', gap: 24 }}>
            {team.length > 0 && (
              <div>
                <p className="wd-label" style={{ marginBottom: 14 }}>TEAM</p>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
                  {team.map((m, i) => (
                    <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px', background: c.row, border: `1px solid ${c.rowBorder}`, borderRadius: 9 }}>
                      <div style={{ width: 28, height: 28, borderRadius: '50%', background: '#4172f5', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'var(--orbitron)', fontSize: 8, fontWeight: 700, color: '#fff', flexShrink: 0 }}>{m.name?.charAt(0)}</div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontFamily: 'var(--dmsans)', fontSize: 13, fontWeight: 500, color: c.text }}>{m.name}</div>
                        <div style={{ fontFamily: 'var(--dmsans)', fontSize: 11, color: c.text3, marginTop: 1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{m.metric || m.role}</div>
                      </div>
                      <span style={{ width: 7, height: 7, borderRadius: '50%', background: m.status === 'online' ? '#10b981' : '#f59e0b', flexShrink: 0 }} />
                    </div>
                  ))}
                </div>
              </div>
            )}

            {activity.length > 0 && (
              <div>
                <p className="wd-label" style={{ marginBottom: 14 }}>RECENT ACTIVITY</p>
                <div style={{ display: 'flex', flexDirection: 'column' }}>
                  {activity.map((a, i) => (
                    <div key={i} style={{ display: 'flex', gap: 12, paddingBottom: i < activity.length - 1 ? 14 : 0 }}>
                      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', flexShrink: 0 }}>
                        <div style={{ width: 24, height: 24, borderRadius: 7, background: c.subtle, border: `1px solid ${c.subtleBorder}`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'var(--mono)', fontSize: 10, color: c.text3 }}>{a.icon}</div>
                        {i < activity.length - 1 && <div style={{ width: 1, flex: 1, background: c.subtleBorder, marginTop: 4 }} />}
                      </div>
                      <div style={{ paddingBottom: 4 }}>
                        <div style={{ fontFamily: 'var(--dmsans)', fontSize: 13, color: c.text2, lineHeight: 1.45 }}>{a.text}</div>
                        <div style={{ fontFamily: 'var(--mono)', fontSize: 9, color: c.text4, letterSpacing: '0.06em', marginTop: 3 }}>{a.source} · {a.time}</div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// SETTINGS PAGE
// ─────────────────────────────────────────────────────────────────────────────

// ─────────────────────────────────────────────────────────────────────────────
// SETTINGS PAGE — multi-provider BYOK
// ─────────────────────────────────────────────────────────────────────────────

// cost: 'best' = recommended fast+cheap, 'mid' = balanced, 'high' = expensive/powerful

export default OverviewPage;
