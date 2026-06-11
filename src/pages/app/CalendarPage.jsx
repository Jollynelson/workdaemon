// Extracted from the former 5,000-line src/pages/Dashboard.jsx (2026-06-10 split).
import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useViewport } from '../../context/ThemeContext.jsx';
import { useAuth } from '../../context/AuthContext.jsx';
import { useC, mkGhostBtn } from '../../lib/theme.jsx';
import { SkeletonRow, EmptyState } from '../../components/ui.jsx';
import { BlockAlert } from '../../components/blocks.jsx';

export const CAL_PROVIDERS = [
  { id: 'google',    label: 'Google Calendar', color: '#1a73e8' },
  { id: 'microsoft', label: 'Microsoft 365',   color: '#0078d4' },
  { id: 'notion',    label: 'Notion (database)', color: '#191919' },
];

export async function startOAuth(token, provider) {
  const r = await fetch('/api/workspace/settings', {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ action: 'oauth_start', provider }),
  });
  const d = await r.json().catch(() => ({}));
  if (d.url) window.location.href = d.url;
  else alert(d.error || `${provider} is not configured yet (missing client credentials).`);
}

export function CalendarPage() {
  const c = useC();
  const { isMobile } = useViewport();
  const { token } = useAuth();
  const navigate = useNavigate();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [view, setView] = useState('agenda'); // month | week | agenda (IA §5.4)
  const [nl, setNl] = useState('');

  // "Prepare me" + NL create both route through My Daemon (the brief/created event
  // appears as a daemon message — IA §5.4). Seeds the chat, then navigates.
  const seedDaemon = (text) => { sessionStorage.setItem('wd_daemon_seed', text); navigate('/app/daemon'); };
  const prepareMe = (ev) => seedDaemon(`Prepare me for my meeting "${ev.title}"${ev.start ? ` on ${new Date(ev.start).toLocaleString()}` : ''}. Pull who's attending and their recent activity, relevant docs/decisions from the Company Brain, open action items with them, and suggested agenda points.`);
  const createNl = () => { const t = nl.trim(); if (!t) return; setNl(''); seedDaemon(`Create a calendar event: ${t}. Confirm the details with me before sending the invite.`); };

  const load = useCallback(async () => {
    try {
      const r = await fetch('/api/brain?tab=calendar', { headers: { Authorization: `Bearer ${token}` } });
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || 'Failed to load');
      setData(await r.json()); setError(null);
    } catch (e) { setError(e.message); } finally { setLoading(false); }
  }, [token]);
  useEffect(() => { if (token) load(); }, [token, load]);

  const connected = new Set(data?.connected || []);
  const events = data?.events || [];
  const groups = [];
  let lastDay = null;
  for (const ev of events) {
    const day = new Date(ev.start).toDateString();
    if (day !== lastDay) { groups.push({ day, events: [] }); lastDay = day; }
    groups[groups.length - 1].events.push(ev);
  }
  const fmtTime = (ev) => ev.allDay ? 'All day'
    : new Date(ev.start).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  const fmtDay = (s) => new Date(s).toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' });
  const provColor = (p) => (CAL_PROVIDERS.find(x => x.id === p) || {}).color || '#3b6ef7';

  return (
    <div style={{ padding: isMobile ? '20px 16px' : '28px 32px', overflowY: 'auto', height: '100%', background: c.bg }}>
      <div style={{ maxWidth: 760, margin: '0 auto' }}>
        <p className="wd-label-blue" style={{ marginBottom: 6 }}>SCHEDULING</p>
        <h1 style={{ fontFamily: 'var(--inter)', fontSize: isMobile ? 20 : 24, fontWeight: 700, color: c.text, letterSpacing: '-0.03em', marginBottom: 18 }}>Calendar</h1>

        {/* Connect row */}
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 24 }}>
          {CAL_PROVIDERS.map(p => {
            const on = connected.has(p.id);
            return (
              <button key={p.id} type="button" disabled={on} onClick={() => startOAuth(token, p.id)}
                style={{
                  display: 'flex', alignItems: 'center', gap: 8, padding: '9px 14px', borderRadius: 9,
                  background: on ? c.stat : c.card, border: `1px solid ${on ? '#10b981' : c.cardBorder}`,
                  cursor: on ? 'default' : 'pointer', color: c.text, fontFamily: 'var(--inter)', fontSize: 13,
                }}>
                <span style={{ width: 8, height: 8, borderRadius: '50%', background: on ? '#10b981' : provColor(p.id) }} />
                {on ? `${p.label} · connected` : `Connect ${p.label}`}
              </button>
            );
          })}
        </div>

        {data?.errors && Object.keys(data.errors).length > 0 && (
          <div style={{ marginBottom: 16 }}>
            <BlockAlert block={{ level: 'warning', content: 'Some calendars could not be read: ' + Object.entries(data.errors).map(([k, v]) => `${k} (${v})`).join(', ') }} />
          </div>
        )}

        {/* NL create + view toggle (IA §5.4) */}
        {connected.size > 0 && (
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center', marginBottom: 20 }}>
            <div style={{ display: 'flex', flex: 1, minWidth: 220, gap: 8 }}>
              <input value={nl} onChange={e => setNl(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') createNl(); }}
                placeholder="Schedule a review with James Friday 2pm"
                style={{ flex: 1, padding: '9px 12px', borderRadius: 8, background: c.subtle, border: `1px solid ${c.subtleBorder}`, color: c.text, fontFamily: 'var(--dmsans)', fontSize: 13, outline: 'none' }} />
              <button type="button" onClick={createNl} style={{ padding: '9px 14px', borderRadius: 8, background: 'rgba(59,110,247,0.1)', border: '1px solid rgba(59,110,247,0.3)', color: '#3b6ef7', fontFamily: 'var(--dmsans)', fontSize: 13, fontWeight: 600, cursor: 'pointer', whiteSpace: 'nowrap' }}>Create</button>
            </div>
            <div style={{ display: 'flex', background: c.subtle, border: `1px solid ${c.subtleBorder}`, borderRadius: 8, padding: 2 }}>
              {['month', 'week', 'agenda'].map(v => (
                <button key={v} type="button" onClick={() => setView(v)}
                  style={{ padding: '6px 12px', borderRadius: 6, border: 'none', cursor: 'pointer', fontFamily: 'var(--dmsans)', fontSize: 12, fontWeight: 600, textTransform: 'capitalize', background: view === v ? '#3b6ef7' : 'transparent', color: view === v ? '#fff' : c.text3 }}>{v}</button>
              ))}
            </div>
          </div>
        )}

        {loading ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>{Array.from({ length: 4 }).map((_, i) => <SkeletonRow key={i} height={56} />)}</div>
        ) : error ? (
          <BlockAlert block={{ level: 'danger', content: `Failed to load calendar: ${error}` }} />
        ) : connected.size === 0 ? (
          <EmptyState icon="◷" title="No calendar connected" subtitle="Connect Google, Microsoft, or a Notion database above to see your upcoming events here — and let your daemons reason over your schedule." />
        ) : events.length === 0 ? (
          <EmptyState icon="◷" title="No upcoming events" subtitle="Nothing in the next 30 days across your connected calendars." />
        ) : view === 'month' ? (
          <MonthCalendar c={c} events={events} provColor={provColor} onPrepare={prepareMe} />
        ) : view === 'week' ? (
          <WeekCalendar c={c} events={events} provColor={provColor} fmtTime={fmtTime} onPrepare={prepareMe} />
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
            {groups.map(g => (
              <div key={g.day}>
                <p style={{ fontFamily: 'var(--mono)', fontSize: 10, color: c.text3, letterSpacing: '0.12em', marginBottom: 9 }}>{fmtDay(g.day).toUpperCase()}</p>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {g.events.map((ev, i) => (
                    <div key={i} style={{ display: 'flex', gap: 12, padding: '11px 14px', background: c.card, border: `1px solid ${c.cardBorder}`, borderRadius: 9, alignItems: 'center' }}>
                      <span style={{ width: 3, alignSelf: 'stretch', borderRadius: 2, background: provColor(ev.provider), flexShrink: 0 }} />
                      <div style={{ minWidth: 76, fontFamily: 'var(--mono)', fontSize: 11, color: c.text2 }}>{fmtTime(ev)}</div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontFamily: 'var(--inter)', fontSize: 14, color: c.text, fontWeight: 500, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{ev.title}</div>
                        {(ev.location || (ev.attendees || []).length > 0) && (
                          <div style={{ fontFamily: 'var(--inter)', fontSize: 12, color: c.text3, marginTop: 2 }}>
                            {ev.location || ''}{ev.location && ev.attendees?.length ? ' · ' : ''}{ev.attendees?.length ? `${ev.attendees.length} guest${ev.attendees.length > 1 ? 's' : ''}` : ''}
                          </div>
                        )}
                      </div>
                      <button type="button" onClick={() => prepareMe(ev)} title="Daemon meeting prep"
                        style={{ ...mkGhostBtn(c, { color: '#3b6ef7', borderColor: 'rgba(59,110,247,0.3)' }), padding: '5px 10px', fontSize: 11, whiteSpace: 'nowrap', flexShrink: 0 }}>Prepare me</button>
                      <span style={{ fontFamily: 'var(--mono)', fontSize: 8, letterSpacing: '0.08em', color: provColor(ev.provider), textTransform: 'uppercase' }}>{ev.provider}</span>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// Month grid (IA §5.4) — current month, event dots per day, click a day to
// expand its events with a Prepare-me action.
export function MonthCalendar({ c, events, provColor, onPrepare }) {
  const [sel, setSel] = useState(null);
  const today = new Date();
  const [cursor, setCursor] = useState(new Date(today.getFullYear(), today.getMonth(), 1));
  const year = cursor.getFullYear(), month = cursor.getMonth();
  const first = new Date(year, month, 1);
  const startPad = first.getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const byDay = {};
  for (const ev of events) { const d = new Date(ev.start); if (d.getFullYear() === year && d.getMonth() === month) (byDay[d.getDate()] = byDay[d.getDate()] || []).push(ev); }
  const cells = [];
  for (let i = 0; i < startPad; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(d);
  const monthName = cursor.toLocaleDateString([], { month: 'long', year: 'numeric' });
  const isToday = (d) => d && today.getFullYear() === year && today.getMonth() === month && today.getDate() === d;

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
        <button type="button" onClick={() => setCursor(new Date(year, month - 1, 1))} style={{ ...mkGhostBtn(c), padding: '5px 11px', fontSize: 13 }}>←</button>
        <span style={{ fontFamily: 'var(--inter)', fontSize: 15, fontWeight: 600, color: c.text }}>{monthName}</span>
        <button type="button" onClick={() => setCursor(new Date(year, month + 1, 1))} style={{ ...mkGhostBtn(c), padding: '5px 11px', fontSize: 13 }}>→</button>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 4 }}>
        {['S', 'M', 'T', 'W', 'T', 'F', 'S'].map((d, i) => <div key={i} style={{ textAlign: 'center', fontFamily: 'var(--mono)', fontSize: 9, color: c.text4, padding: '2px 0' }}>{d}</div>)}
        {cells.map((d, i) => (
          <div key={i} onClick={() => d && byDay[d] && setSel(sel === d ? null : d)}
            style={{ minHeight: 58, borderRadius: 8, padding: 5, background: d ? (isToday(d) ? 'rgba(59,110,247,0.08)' : c.card) : 'transparent', border: d ? `1px solid ${sel === d ? '#3b6ef7' : isToday(d) ? 'rgba(59,110,247,0.3)' : c.cardBorder}` : 'none', cursor: d && byDay[d] ? 'pointer' : 'default' }}>
            {d && <>
              <div style={{ fontFamily: 'var(--mono)', fontSize: 10, color: isToday(d) ? '#3b6ef7' : c.text3, fontWeight: isToday(d) ? 700 : 400 }}>{d}</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 2, marginTop: 3 }}>
                {(byDay[d] || []).slice(0, 2).map((ev, j) => (
                  <div key={j} style={{ fontFamily: 'var(--inter)', fontSize: 9, color: c.text2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', borderLeft: `2px solid ${provColor(ev.provider)}`, paddingLeft: 3 }}>{ev.title}</div>
                ))}
                {(byDay[d] || []).length > 2 && <div style={{ fontFamily: 'var(--mono)', fontSize: 8, color: c.text4 }}>+{byDay[d].length - 2}</div>}
              </div>
            </>}
          </div>
        ))}
      </div>
      {sel && byDay[sel] && (
        <div style={{ marginTop: 14, display: 'flex', flexDirection: 'column', gap: 8 }}>
          <p style={{ fontFamily: 'var(--mono)', fontSize: 10, color: c.text3, letterSpacing: '0.1em' }}>{cursor.toLocaleDateString([], { month: 'short' }).toUpperCase()} {sel}</p>
          {byDay[sel].map((ev, i) => (
            <div key={i} style={{ display: 'flex', gap: 10, padding: '10px 13px', background: c.card, border: `1px solid ${c.cardBorder}`, borderRadius: 9, alignItems: 'center' }}>
              <span style={{ width: 3, alignSelf: 'stretch', borderRadius: 2, background: provColor(ev.provider) }} />
              <div style={{ minWidth: 64, fontFamily: 'var(--mono)', fontSize: 11, color: c.text2 }}>{ev.allDay ? 'All day' : new Date(ev.start).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</div>
              <div style={{ flex: 1, fontFamily: 'var(--inter)', fontSize: 13, color: c.text }}>{ev.title}</div>
              <button type="button" onClick={() => onPrepare(ev)} style={{ ...mkGhostBtn(c, { color: '#3b6ef7', borderColor: 'rgba(59,110,247,0.3)' }), padding: '5px 10px', fontSize: 11 }}>Prepare me</button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// Week view (IA §5.4) — the next 7 days as columns of events.
export function WeekCalendar({ c, events, provColor, fmtTime, onPrepare }) {
  const start = new Date(); start.setHours(0, 0, 0, 0);
  const days = Array.from({ length: 7 }, (_, i) => { const d = new Date(start); d.setDate(start.getDate() + i); return d; });
  const evFor = (d) => events.filter(ev => new Date(ev.start).toDateString() === d.toDateString());
  return (
    <div style={{ display: 'flex', gap: 10, overflowX: 'auto', paddingBottom: 8 }}>
      {days.map((d, i) => {
        const evs = evFor(d);
        return (
          <div key={i} style={{ flex: '0 0 150px', minWidth: 150 }}>
            <p style={{ fontFamily: 'var(--mono)', fontSize: 10, color: i === 0 ? '#3b6ef7' : c.text3, letterSpacing: '0.08em', marginBottom: 8 }}>{d.toLocaleDateString([], { weekday: 'short', day: 'numeric' }).toUpperCase()}</p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {evs.length === 0 ? <span style={{ fontFamily: 'var(--inter)', fontSize: 11, color: c.text4 }}>—</span> : evs.map((ev, j) => (
                <div key={j} onClick={() => onPrepare(ev)} title="Prepare me" style={{ padding: '8px 10px', background: c.card, border: `1px solid ${c.cardBorder}`, borderLeft: `3px solid ${provColor(ev.provider)}`, borderRadius: 8, cursor: 'pointer' }}>
                  <div style={{ fontFamily: 'var(--mono)', fontSize: 9.5, color: c.text3 }}>{fmtTime(ev)}</div>
                  <div style={{ fontFamily: 'var(--inter)', fontSize: 12, color: c.text, marginTop: 2, lineHeight: 1.3 }}>{ev.title}</div>
                </div>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// DAEMONS — autonomous knowledge automations (n8n-style, brain-native)
// ─────────────────────────────────────────────────────────────────────────────


export default CalendarPage;
