// Extracted from the former 5,000-line src/pages/Dashboard.jsx (2026-06-10 split).
import { useState, useEffect, useCallback } from 'react';
import { useViewport } from '../../context/ThemeContext.jsx';
import { useAuth } from '../../context/AuthContext.jsx';
import { useC, mkGhostBtn } from '../../lib/theme.jsx';
import { SkeletonRow } from '../../components/ui.jsx';

export const INTEGRATION_ROADMAP = [
  'Gmail', 'Google Drive', 'Google Calendar', 'Notion', 'Microsoft Teams',
  'Outlook', 'OneDrive', 'GitHub', 'Jira', 'HubSpot', 'Salesforce',
];

export function IntegrationsPage() {
  const c = useC();
  const { isMobile } = useViewport();
  const { token } = useAuth();
  const [providers, setProviders] = useState([]);
  const [loading, setLoading]     = useState(true);
  const [busy, setBusy]           = useState(null);
  const [banner, setBanner]       = useState(null);

  const load = useCallback(async () => {
    if (!token) return;
    try {
      const r = await fetch('/api/workspace/settings?integrations=true', { headers: { Authorization: `Bearer ${token}` } });
      const d = await r.json();
      setProviders(d.providers || []);
    } catch {}
    setLoading(false);
  }, [token]);

  useEffect(() => { load(); }, [load]);

  // One-time banner from the OAuth redirect (?connected= / ?error=).
  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    if (q.get('connected')) setBanner({ ok: true, text: `Connected ${q.get('connected')}.` });
    else if (q.get('error')) setBanner({ ok: false, text: `Couldn't connect (${q.get('error')}).` });
    if (q.get('connected') || q.get('error')) window.history.replaceState({}, '', '/app/integrations');
  }, []);

  const connect = async (id) => {
    setBusy(id);
    try {
      const r = await fetch('/api/workspace/settings', {
        method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ action: 'oauth_start', provider: id }),
      });
      const d = await r.json();
      if (d.url) { window.location.href = d.url; return; }
      setBanner({ ok: false, text: d.error || 'Could not start connection.' });
    } catch { setBanner({ ok: false, text: 'Network error.' }); }
    setBusy(null);
  };

  const disconnect = async (id) => {
    if (!window.confirm(`Disconnect ${id}? The daemon will lose access to its data.`)) return;
    setBusy(id);
    await fetch('/api/workspace/settings', {
      method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ action: 'oauth_disconnect', provider: id }),
    }).catch(() => {});
    setBusy(null); load();
  };

  const liveLabels = new Set(providers.map(p => p.label));
  const roadmap = INTEGRATION_ROADMAP.filter(l => !liveLabels.has(l));
  const reconnectNeeded = providers.filter(p => p.connection?.needsReconnect);

  return (
    <div style={{ padding: isMobile ? '20px 16px' : '28px 32px', overflowY: 'auto', height: '100%', background: c.bg, transition: 'background 0.2s' }}>
      <div style={{ maxWidth: 760, margin: '0 auto' }}>
        <p className="wd-label-blue" style={{ marginBottom: 6 }}>INTEGRATIONS</p>
        <h1 style={{ fontFamily: 'var(--inter)', fontSize: isMobile ? 20 : 24, fontWeight: 700, color: c.text, margin: 0, letterSpacing: '-0.03em' }}>Connect your tools</h1>
        <p style={{ fontFamily: 'var(--dmsans)', fontSize: 14, color: c.text3, marginTop: 6, lineHeight: 1.6 }}>
          Connect your company's apps so your daemon can read (and, at higher permission, act on) real data. More apps roll out continuously.
        </p>

        {banner && (
          <div style={{ marginTop: 16, padding: '11px 14px', borderRadius: 9, fontFamily: 'var(--dmsans)', fontSize: 13,
            background: banner.ok ? 'rgba(16,185,129,0.08)' : 'rgba(239,68,68,0.08)',
            border: `1px solid ${banner.ok ? 'rgba(16,185,129,0.3)' : 'rgba(239,68,68,0.3)'}`,
            color: banner.ok ? '#10b981' : '#ef4444' }}>
            {banner.ok ? '✓ ' : '✗ '}{banner.text}
          </div>
        )}

        {reconnectNeeded.length > 0 && (
          <div style={{ marginTop: 16, padding: '12px 14px', borderRadius: 9, fontFamily: 'var(--dmsans)',
            background: 'rgba(245,158,11,0.08)', border: '1px solid rgba(245,158,11,0.32)',
            display: 'flex', alignItems: 'flex-start', gap: 10 }}>
            <span style={{ color: '#f59e0b', fontSize: 14, lineHeight: '20px', flexShrink: 0 }}>⚠</span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: c.text }}>
                {reconnectNeeded.length === 1 ? `${reconnectNeeded[0].label} needs a quick reconnect` : 'Some tools need a quick reconnect'}
              </div>
              <div style={{ fontSize: 13, color: c.text3, lineHeight: 1.55, marginTop: 2 }}>
                New permissions are ready so your daemon can act as you — read your DMs and send on your behalf. Reconnecting just re-grants access; nothing else changes.
              </div>
            </div>
            <div style={{ display: 'flex', gap: 6, flexShrink: 0, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
              {reconnectNeeded.map(p => (
                <button key={p.id} type="button" onClick={() => connect(p.id)} disabled={busy === p.id}
                  style={{ padding: '6px 13px', borderRadius: 7, cursor: 'pointer', whiteSpace: 'nowrap',
                    background: 'rgba(245,158,11,0.14)', border: '1px solid rgba(245,158,11,0.4)',
                    fontFamily: 'var(--dmsans)', fontSize: 12, fontWeight: 600, color: '#f59e0b', opacity: busy === p.id ? 0.6 : 1 }}>
                  {busy === p.id ? '…' : (reconnectNeeded.length > 1 ? `Reconnect ${p.label}` : 'Reconnect')}
                </button>
              ))}
            </div>
          </div>
        )}

        <div style={{ marginTop: 22, display: 'flex', flexDirection: 'column', gap: 8 }}>
          {loading ? (
            Array.from({ length: 3 }).map((_, i) => <SkeletonRow key={i} height={64} />)
          ) : (
            providers.map(p => {
              const conn = p.connection;
              const connected = conn?.status === 'connected';
              return (
                <div key={p.id} style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '14px 16px', background: c.card, border: `1px solid ${c.cardBorder}`, borderRadius: 11 }}>
                  <div style={{ width: 34, height: 34, borderRadius: 9, background: connected ? 'rgba(16,185,129,0.12)' : c.subtle, border: `1px solid ${connected ? 'rgba(16,185,129,0.3)' : c.subtleBorder}`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'var(--orbitron)', fontSize: 13, fontWeight: 700, color: connected ? '#10b981' : c.text3, flexShrink: 0 }}>{p.label[0]}</div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontFamily: 'var(--dmsans)', fontSize: 14, fontWeight: 600, color: c.text }}>{p.label}</div>
                    <div style={{ fontFamily: 'var(--mono)', fontSize: 10, letterSpacing: '0.04em', color: connected ? (conn.needsReconnect ? '#f59e0b' : '#10b981') : c.text4, marginTop: 3 }}>
                      {connected ? `CONNECTED${conn.external_account ? ` · ${conn.external_account}` : ''}${conn.needsReconnect ? ' · RECONNECT NEEDED' : ''}` : p.configured ? 'NOT CONNECTED' : 'AWAITING SETUP'}
                    </div>
                  </div>
                  {connected ? (
                    <button type="button" onClick={() => disconnect(p.id)} disabled={busy === p.id}
                      style={{ ...mkGhostBtn(c, { color: '#ef4444', borderColor: 'rgba(239,68,68,0.25)' }), padding: '7px 14px', fontSize: 12 }}>
                      {busy === p.id ? '…' : 'Disconnect'}
                    </button>
                  ) : (
                    <button type="button" onClick={() => connect(p.id)} disabled={!p.configured || busy === p.id} title={p.configured ? '' : 'Add app credentials to enable'}
                      style={{ padding: '7px 16px', borderRadius: 8, cursor: p.configured ? 'pointer' : 'not-allowed',
                        background: p.configured ? 'rgba(59,110,247,0.1)' : c.subtle, border: `1px solid ${p.configured ? 'rgba(59,110,247,0.3)' : c.subtleBorder}`,
                        fontFamily: 'var(--dmsans)', fontSize: 13, fontWeight: 600, color: p.configured ? '#3b6ef7' : c.text4, opacity: busy === p.id ? 0.6 : 1 }}>
                      {busy === p.id ? '…' : 'Connect'}
                    </button>
                  )}
                </div>
              );
            })
          )}
        </div>

        {roadmap.length > 0 && (
          <>
            <p className="wd-label-blue" style={{ marginTop: 30, marginBottom: 10 }}>ROLLING OUT NEXT</p>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 7 }}>
              {roadmap.map(l => (
                <span key={l} style={{ fontFamily: 'var(--dmsans)', fontSize: 12, color: c.text3, background: c.subtle, border: `1px solid ${c.subtleBorder}`, borderRadius: 7, padding: '5px 11px' }}>{l}</span>
              ))}
            </div>
            <p style={{ fontFamily: 'var(--dmsans)', fontSize: 12, color: c.text4, marginTop: 12 }}>
              Want a specific tool prioritized? Tell your daemon — it logs the request.
            </p>
          </>
        )}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// SKILLS — capability library (IA §5.3). Attachable to every Daemon.
// ─────────────────────────────────────────────────────────────────────────────

export default IntegrationsPage;
