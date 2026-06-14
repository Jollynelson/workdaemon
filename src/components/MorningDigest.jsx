// Morning digest — a once-a-day "here's what's up" briefing rendered as cards
// at the top of the daemon page. DETERMINISTIC: it fetches /api/overview?view=
// digest (pure aggregation, NO LLM) so opening the daemon never "starts
// spinning". Gated to show once per day, on first login after 6am local time,
// and is dismissible. Renders nothing on a quiet day (server returns no cards).
import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useC } from '../lib/theme.jsx';
import { useAuth } from '../context/AuthContext.jsx';
import { useViewport } from '../context/ThemeContext.jsx';

const SEV_DOT = { critical: '#ef4444', high: '#ef4444', warning: '#f59e0b', medium: '#f59e0b', info: '#3b6ef7' };

// localStorage key for "already shown today" — per user, per local calendar day.
function dayKey(userId) {
  const n = new Date();
  const ymd = `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, '0')}-${String(n.getDate()).padStart(2, '0')}`;
  return `wd_digest:${userId || 'me'}:${ymd}`;
}

export default function MorningDigest({ onAsk }) {
  const c = useC();
  const { isMobile } = useViewport();
  const { token, profile } = useAuth();
  const navigate = useNavigate();
  const [data, setData] = useState(null); // { name, cards } once it should render

  useEffect(() => {
    if (!token) return;
    const now = new Date();
    if (now.getHours() < 6) return;               // before 6am → no digest yet
    const key = dayKey(profile?.id);
    if (localStorage.getItem(key)) return;        // already shown (or dismissed) today
    let alive = true;
    fetch('/api/overview?view=digest', { headers: { Authorization: `Bearer ${token}` } })
      .then(r => (r.ok ? r.json() : null))
      .then(d => {
        if (!alive) return;
        if (!d || !Array.isArray(d.cards) || !d.cards.length) return; // quiet day → show nothing
        localStorage.setItem(key, '1');           // once per day, even across navigations
        setData(d);
      })
      .catch(() => {});
    return () => { alive = false; };
  }, [token, profile?.id]);

  if (!data) return null;

  const dismiss = () => {
    localStorage.setItem(dayKey(profile?.id), '1');
    setData(null);
  };
  const act = (target) => {
    if (target?.ask) { onAsk?.(target.ask); dismiss(); } // engaged → briefing done
    else if (target?.to) navigate(target.to);
  };

  const hr = new Date().getHours();
  const greeting = hr < 12 ? 'Good morning' : hr < 18 ? 'Good afternoon' : 'Good evening';
  const dateLabel = new Date().toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });

  return (
    <div style={{
      flexShrink: 0, borderBottom: `1px solid ${c.headerBorder}`, background: c.surface,
      padding: isMobile ? '14px 14px 16px' : '18px 28px 20px', transition: 'background 0.2s, border-color 0.2s',
    }}>
      <div style={{ maxWidth: 780, margin: '0 auto' }}>
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, marginBottom: 12 }}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, minWidth: 0 }}>
            <span style={{ fontFamily: 'var(--inter)', fontSize: isMobile ? 14 : 15, fontWeight: 600, color: c.text, letterSpacing: '-0.02em', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {greeting}{data.name ? `, ${data.name}` : ''}
            </span>
            <span style={{ fontFamily: 'var(--mono)', fontSize: 10, color: c.text4, letterSpacing: '0.08em', flexShrink: 0 }}>{dateLabel.toUpperCase()}</span>
          </div>
          <button type="button" onClick={dismiss} title="Dismiss for today"
            style={{ fontFamily: 'var(--mono)', fontSize: 10, letterSpacing: '0.08em', color: c.text3, background: 'none', border: 'none', cursor: 'pointer', padding: '4px 6px', flexShrink: 0 }}
            onMouseEnter={e => { e.currentTarget.style.color = c.text; }}
            onMouseLeave={e => { e.currentTarget.style.color = c.text3; }}>
            DISMISS ✕
          </button>
        </div>

        {/* Cards */}
        <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : 'repeat(auto-fill, minmax(232px, 1fr))', gap: 10 }}>
          {data.cards.map(card => (
            <div key={card.id} style={{
              background: c.card, border: `1px solid ${c.cardBorder}`, borderRadius: 12,
              padding: 14, display: 'flex', flexDirection: 'column', gap: 10, boxShadow: c.cardShadow,
            }}>
              {/* Card header */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ fontFamily: 'var(--mono)', fontSize: 13, color: c.text3 }}>{card.icon}</span>
                <span style={{ fontFamily: 'var(--inter)', fontSize: 12.5, fontWeight: 600, color: c.text, letterSpacing: '-0.01em', flex: 1, minWidth: 0 }}>{card.title}</span>
                {card.count != null && (
                  <span style={{ fontFamily: 'var(--mono)', fontSize: 10, color: c.text3, background: c.surface2, border: `1px solid ${c.hairline}`, borderRadius: 6, padding: '1px 6px', flexShrink: 0 }}>{card.count}</span>
                )}
              </div>

              {/* Items */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {(card.items || []).map((it, idx) => {
                  const clickable = Boolean(it.ask || it.to);
                  return (
                    <div key={idx}
                      onClick={clickable ? () => act(it) : undefined}
                      style={{ display: 'flex', gap: 8, alignItems: 'flex-start', cursor: clickable ? 'pointer' : 'default' }}>
                      <span style={{ width: 5, height: 5, borderRadius: '50%', marginTop: 6, flexShrink: 0, background: SEV_DOT[it.severity] || c.text4 }} />
                      <div style={{ minWidth: 0, flex: 1 }}>
                        <div style={{ fontFamily: 'var(--dmsans)', fontSize: 13, color: c.text2, lineHeight: 1.4 }}>{it.text}</div>
                        {it.sub && <div style={{ fontFamily: 'var(--dmsans)', fontSize: 11.5, color: c.text3, lineHeight: 1.4, marginTop: 2 }}>{it.sub}</div>}
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* CTA */}
              {card.cta && (
                <button type="button" onClick={() => act(card.cta)}
                  style={{ alignSelf: 'flex-start', marginTop: 2, fontFamily: 'var(--mono)', fontSize: 10, letterSpacing: '0.06em', color: '#3b6ef7', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}
                  onMouseEnter={e => { e.currentTarget.style.textDecoration = 'underline'; }}
                  onMouseLeave={e => { e.currentTarget.style.textDecoration = 'none'; }}>
                  {card.cta.label} →
                </button>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
