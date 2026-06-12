// Extracted from the former 5,000-line src/pages/Dashboard.jsx (2026-06-10 split).
import { useState, useEffect, useCallback } from 'react';
import { useViewport } from '../../context/ThemeContext.jsx';
import { useAuth } from '../../context/AuthContext.jsx';
import { useC, mkGhostBtn } from '../../lib/theme.jsx';
import { SkeletonRow } from '../../components/ui.jsx';
import { ProviderIcon } from '../../components/brand/ProviderIcons.jsx';

export const INTEGRATION_ROADMAP = [
  'Gmail', 'Google Drive', 'Google Calendar', 'Notion', 'Microsoft Teams',
  'Outlook', 'OneDrive', 'GitHub', 'Jira', 'HubSpot', 'Salesforce',
];

// ── Seed/readiness helpers (brain + daemon tracks) ───────────────────────────
const SEEDING = ['pending', 'seeding'];
const seedActive = (s) => !!s && (SEEDING.includes(s.brain_status) || SEEDING.includes(s.daemon_status));
const seedIssue  = (s) => !!s && (s.brain_status === 'error' || ['needs_reconnect', 'error'].includes(s.daemon_status));
const seedShow   = (s) => seedActive(s) || seedIssue(s);
const trackPct = (status, done, total) =>
  (status === 'ready' || status === 'needs_reconnect' || status === 'error') ? 100
  : total > 0 ? Math.min(98, Math.round((done / total) * 100))
  : status === 'seeding' ? 6 : 0;
const trackColor = (status) =>
  status === 'ready' ? '#10b981' : status === 'needs_reconnect' ? '#f59e0b' : status === 'error' ? '#ef4444' : '#3b6ef7';

export function IntegrationsPage() {
  const c = useC();
  const { isMobile } = useViewport();
  const { token } = useAuth();
  const [providers, setProviders] = useState([]);
  const [loading, setLoading]     = useState(true);
  const [busy, setBusy]           = useState(null);
  const [banner, setBanner]       = useState(null);
  const [pendingSeed, setPendingSeed] = useState(null);

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

  // Kick off Brain ingest + Daemon catch-up for a freshly connected provider.
  const seedProvider = useCallback(async (id) => {
    try {
      await fetch('/api/workspace/settings', {
        method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ action: 'seed_integration', provider: id }),
      });
    } catch {}
    load();
  }, [token, load]);

  // One-time banner from the OAuth redirect (?connected= / ?error=). On a fresh
  // connect, queue a seed so the Brain + Daemon start filling immediately.
  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    const connected = q.get('connected');
    if (connected) { setBanner({ ok: true, text: `Connected ${connected} — getting your daemon ready.` }); setPendingSeed(connected); }
    else if (q.get('error')) setBanner({ ok: false, text: `Couldn't connect (${q.get('error')}).` });
    if (connected || q.get('error')) window.history.replaceState({}, '', '/app/integrations');
  }, []);

  // Fire the queued seed once the auth token is available.
  useEffect(() => {
    if (pendingSeed && token) { seedProvider(pendingSeed); setPendingSeed(null); }
  }, [pendingSeed, token, seedProvider]);

  // Poll while any integration is mid-seed, so the progress bars advance live.
  useEffect(() => {
    const seeding = providers.some(p => seedActive(p.seed));
    if (!seeding) return;
    const t = setTimeout(load, 2500);
    return () => clearTimeout(t);
  }, [providers, load]);

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
              const seed = p.seed;
              return (
                <div key={p.id} style={{ display: 'flex', flexDirection: 'column', padding: '14px 16px', background: c.card, border: `1px solid ${c.cardBorder}`, borderRadius: 11 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
                    <div style={{ width: 36, height: 36, borderRadius: 9, background: c.subtle, border: `1px solid ${c.subtleBorder}`, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, overflow: 'hidden' }}>
                      <ProviderIcon id={p.id} label={p.label} size={22} fallbackColor={c.text3} />
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontFamily: 'var(--dmsans)', fontSize: 14, fontWeight: 600, color: c.text }}>{p.label}</div>
                      <div style={{ fontFamily: 'var(--mono)', fontSize: 10, letterSpacing: '0.04em', color: connected ? (conn.needsReconnect ? '#f59e0b' : '#10b981') : c.text4, marginTop: 3 }}>
                        {connected
                          ? `CONNECTED${conn.external_account ? ` · ${conn.external_account}` : ''}${conn.needsReconnect ? ' · RECONNECT NEEDED' : (seed?.brain_status === 'ready' && seed.doc_count ? ` · ${seed.doc_count} synced` : '')}`
                          : p.configured ? 'NOT CONNECTED' : 'AWAITING SETUP'}
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

                  {connected && seedShow(seed) && (
                    <div style={{ marginTop: 12, paddingTop: 12, borderTop: `1px solid ${c.cardBorder}`, display: 'flex', flexDirection: 'column', gap: 9 }}>
                      {[
                        { icon: '🧠', name: 'Brain', status: seed.brain_status, stage: seed.brain_stage, done: seed.brain_done, total: seed.brain_total, doneText: seed.doc_count ? `${seed.doc_count} synced` : 'synced' },
                        { icon: '🤖', name: 'Daemon', status: seed.daemon_status, stage: seed.daemon_stage, done: seed.daemon_done, total: seed.daemon_total, doneText: 'ready · acts as you' },
                      ].map((tr, i) => {
                        const pct = trackPct(tr.status, tr.done, tr.total);
                        const col = trackColor(tr.status);
                        const right = tr.status === 'ready' ? '✓' : tr.status === 'needs_reconnect' ? 'reconnect' : tr.status === 'error' ? 'failed' : `${pct}%`;
                        const sub = tr.status === 'ready' ? tr.doneText
                          : tr.status === 'needs_reconnect' ? (tr.stage || 'reconnect to finish')
                          : tr.status === 'error' ? (tr.stage || 'something went wrong')
                          : tr.status === 'seeding' ? `${tr.stage || 'working'}${tr.total > 0 ? ` · ${tr.done}/${tr.total}` : ''}`
                          : 'queued';
                        return (
                          <div key={i}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 4, gap: 8 }}>
                              <span style={{ fontFamily: 'var(--dmsans)', fontSize: 12, color: c.text, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                <span style={{ marginRight: 6 }}>{tr.icon}</span>{tr.name}
                                <span style={{ color: c.text4, marginLeft: 7, fontSize: 11 }}>{sub}</span>
                              </span>
                              <span style={{ fontFamily: 'var(--mono)', fontSize: 11, color: col, flexShrink: 0 }}>{right}</span>
                            </div>
                            <div style={{ height: 4, borderRadius: 3, background: c.subtle, overflow: 'hidden' }}>
                              <div style={{ height: '100%', width: `${pct}%`, background: col, borderRadius: 3, transition: 'width 0.4s ease' }} />
                            </div>
                            {tr.status === 'needs_reconnect' && (
                              <button type="button" onClick={() => connect(p.id)} disabled={busy === p.id}
                                style={{ marginTop: 6, padding: '4px 11px', borderRadius: 6, cursor: 'pointer',
                                  background: 'rgba(245,158,11,0.14)', border: '1px solid rgba(245,158,11,0.4)',
                                  fontFamily: 'var(--dmsans)', fontSize: 11, fontWeight: 600, color: '#f59e0b' }}>
                                {busy === p.id ? '…' : 'Reconnect to finish'}
                              </button>
                            )}
                          </div>
                        );
                      })}
                    </div>
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
