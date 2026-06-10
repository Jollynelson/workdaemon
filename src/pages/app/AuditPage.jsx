// Extracted from the former 5,000-line src/pages/Dashboard.jsx (2026-06-10 split).
import { useState, useEffect } from 'react';
import { useViewport } from '../../context/ThemeContext.jsx';
import { useAuth } from '../../context/AuthContext.jsx';
import { useC, mkGhostBtn } from '../../lib/theme.jsx';
import { SkeletonRow } from '../../components/ui.jsx';

export function AuditPage() {
  const c = useC();
  const { isMobile } = useViewport();
  const { token } = useAuth();
  const [log, setLog] = useState([]);
  const [loading, setLoading] = useState(true);
  const [resultFilter, setResultFilter] = useState('all');
  const [expanded, setExpanded] = useState(null);

  useEffect(() => {
    if (!token) return;
    (async () => {
      try {
        const r = await fetch('/api/brain?tab=audit', { headers: { Authorization: `Bearer ${token}` } });
        const d = await r.json();
        setLog(d.log || []);
      } catch {}
      setLoading(false);
    })();
  }, [token]);

  const rows = resultFilter === 'all' ? log : log.filter(r => r.result === resultFilter);
  const fmt = (t) => t ? new Date(t).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—';
  const resColor = (r) => r === 'done' || r === 'approved' ? '#10b981' : r === 'failed' || r === 'rejected' ? '#ef4444' : c.text3;

  const exportCsv = () => {
    const head = ['timestamp', 'member', 'daemon', 'action', 'tool', 'result', 'latency_ms'];
    const lines = [head.join(',')].concat(rows.map(r =>
      [r.created_at, r.member || '', r.daemon || '', r.action || '', r.tool || '', r.result || '', r.latency_ms ?? ''].map(v => `"${String(v).replace(/"/g, '""')}"`).join(',')));
    const blob = new Blob([lines.join('\n')], { type: 'text/csv' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'workdaemon-audit.csv'; a.click();
  };

  const th = { fontFamily: 'var(--mono)', fontSize: 10, letterSpacing: '0.06em', color: c.text4, textAlign: 'left', padding: '0 12px 8px', fontWeight: 600 };
  const td = { fontFamily: 'var(--dmsans)', fontSize: 13, color: c.text, padding: '11px 12px', borderTop: `1px solid ${c.cardBorder}`, verticalAlign: 'top' };

  return (
    <div style={{ padding: isMobile ? '20px 16px' : '28px 32px', overflowY: 'auto', height: '100%', background: c.bg, transition: 'background 0.2s' }}>
      <div style={{ maxWidth: 980, margin: '0 auto' }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
          <div>
            <p className="wd-label-blue" style={{ marginBottom: 6 }}>ADMIN</p>
            <h1 style={{ fontFamily: 'var(--inter)', fontSize: isMobile ? 20 : 24, fontWeight: 700, color: c.text, margin: 0, letterSpacing: '-0.03em' }}>Audit Log</h1>
            <p style={{ fontFamily: 'var(--dmsans)', fontSize: 14, color: c.text3, marginTop: 6 }}>Every daemon action across the company, newest first.</p>
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <select value={resultFilter} onChange={e => setResultFilter(e.target.value)}
              style={{ padding: '8px 12px', borderRadius: 8, background: c.subtle, border: `1px solid ${c.subtleBorder}`, color: c.text, fontFamily: 'var(--dmsans)', fontSize: 13, cursor: 'pointer', outline: 'none' }}>
              <option value="all">All results</option><option value="done">Done</option><option value="approved">Approved</option><option value="proposed">Proposed</option><option value="rejected">Rejected</option><option value="failed">Failed</option>
            </select>
            <button type="button" onClick={exportCsv} style={{ ...mkGhostBtn(c), padding: '8px 14px', fontSize: 13 }}>Export CSV</button>
          </div>
        </div>

        <div style={{ marginTop: 20, background: c.card, border: `1px solid ${c.cardBorder}`, borderRadius: 12, padding: '14px 8px', overflowX: 'auto' }}>
          {loading ? (
            Array.from({ length: 6 }).map((_, i) => <SkeletonRow key={i} height={40} />)
          ) : (
            <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 620 }}>
              <thead><tr><th style={th}>WHEN</th><th style={th}>MEMBER · DAEMON</th><th style={th}>ACTION</th><th style={th}>TOOL</th><th style={th}>RESULT</th><th style={th}>LATENCY</th></tr></thead>
              <tbody>
                {rows.map(r => (
                  <tr key={r.id} onClick={() => setExpanded(expanded === r.id ? null : r.id)} style={{ cursor: r.rationale ? 'pointer' : 'default' }}>
                    <td style={{ ...td, color: c.text3, fontFamily: 'var(--mono)', fontSize: 11, whiteSpace: 'nowrap' }}>{fmt(r.created_at)}</td>
                    <td style={{ ...td, color: c.text3 }}>{[r.member, r.daemon].filter(Boolean).join(' · ') || '—'}</td>
                    <td style={td}>
                      {r.action}
                      {expanded === r.id && r.rationale && <div style={{ marginTop: 6, fontSize: 12, color: c.text3, lineHeight: 1.5, fontStyle: 'italic' }}>{r.rationale}</div>}
                    </td>
                    <td style={{ ...td, color: c.text3, fontFamily: 'var(--mono)', fontSize: 11 }}>{r.tool || r.type || '—'}</td>
                    <td style={td}><span style={{ fontFamily: 'var(--mono)', fontSize: 10, letterSpacing: '0.04em', color: resColor(r.result) }}>{String(r.result || '').toUpperCase()}</span></td>
                    <td style={{ ...td, color: c.text4, fontFamily: 'var(--mono)', fontSize: 11 }}>{r.latency_ms != null ? `${r.latency_ms}ms` : '—'}</td>
                  </tr>
                ))}
                {rows.length === 0 && <tr><td style={{ ...td, color: c.text4 }} colSpan={6}>No daemon actions logged yet.</td></tr>}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// SHELL COMPONENTS
// ─────────────────────────────────────────────────────────────────────────────


export default AuditPage;
