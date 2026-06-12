// Activity — what the workspace's daemons are DOING NOW / have DONE / will DO
// next (IA §9). The visibility layer the owner asked for: a single place to see
// every autonomous thing the daemons are up to. Grounds on /api/overview?view=
// activity (action queue, scheduled outbox, agent runs, cross-daemon events).
import { useViewport } from '../../context/ThemeContext.jsx';
import { useAuth } from '../../context/AuthContext.jsx';
import { useC } from '../../lib/theme.jsx';
import { useFetch } from '../../lib/hooks.js';
import { SkeletonRow, EmptyState } from '../../components/ui.jsx';

const STATUS_COLOR = {
  running: '#3b6ef7', pending: '#f59e0b', scheduled: '#f59e0b',
  done: '#10b981', failed: '#ef4444',
};
const KIND_ICON = { agent: '◇', action: '⚡', scheduled: '◷', coordination: '⇄', message: '✉' };

// Bare span like "3h" / "9d" / "just now" — no tense.
function span(iso) {
  if (!iso) return '';
  const d = new Date(iso).getTime();
  if (Number.isNaN(d)) return '';
  const abs = Math.abs(d - Date.now());
  const m = Math.round(abs / 60000), h = Math.round(abs / 3600000), day = Math.round(abs / 86400000);
  return abs < 60000 ? 'just now' : abs < 3600000 ? `${m}m` : abs < 86400000 ? `${h}h` : `${day}d`;
}

// When `age` is set the timestamp is "how long it's been waiting" (raised in the
// past) — say so explicitly. Otherwise it's a real schedule: "in 3h" / "9d ago".
function timeLabel(item) {
  const s = span(item.at);
  if (!s) return '';
  if (s === 'just now') return s;
  if (item.age) return `raised ${s} ago`;
  return new Date(item.at).getTime() > Date.now() ? `in ${s}` : `${s} ago`;
}

function Card({ item, c }) {
  const dot = STATUS_COLOR[item.status] || c.text3;
  return (
    <div style={{ display: 'flex', gap: 11, padding: '12px 14px', background: c.card, border: `1px solid ${c.cardBorder}`, borderRadius: 11 }}>
      <div style={{ flexShrink: 0, marginTop: 1, width: 22, height: 22, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', background: `${dot}1a`, color: dot, fontSize: 12 }}>
        {KIND_ICON[item.kind] || '•'}
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 10 }}>
          <div style={{ fontFamily: 'var(--dmsans)', fontSize: 13.5, fontWeight: 600, color: c.text, lineHeight: 1.35 }}>{item.title}</div>
          <span style={{ flexShrink: 0, fontFamily: 'var(--mono)', fontSize: 10.5, color: c.text4, whiteSpace: 'nowrap' }}>{timeLabel(item)}</span>
        </div>
        {item.detail ? <div style={{ fontFamily: 'var(--dmsans)', fontSize: 12, color: c.text3, marginTop: 3, lineHeight: 1.45, overflow: 'hidden', textOverflow: 'ellipsis', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' }}>{item.detail}</div> : null}
        {item.age ? <span style={{ display: 'inline-block', marginTop: 7, fontFamily: 'var(--mono)', fontSize: 9.5, fontWeight: 600, letterSpacing: '0.04em', color: dot, background: `${dot}14`, border: `1px solid ${dot}33`, borderRadius: 5, padding: '2px 7px' }}>AWAITING RESPONSE</span> : null}
      </div>
    </div>
  );
}

function Column({ title, sub, items, c, accent, isMobile }) {
  return (
    <div style={{ flex: 1, minWidth: 0 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
        <span style={{ width: 7, height: 7, borderRadius: '50%', background: accent }} />
        <h2 style={{ fontFamily: 'var(--inter)', fontSize: 14, fontWeight: 700, color: c.text, margin: 0, letterSpacing: '-0.01em' }}>{title}</h2>
        <span style={{ fontFamily: 'var(--mono)', fontSize: 11, color: c.text4 }}>{items.length}</span>
      </div>
      <p style={{ fontFamily: 'var(--dmsans)', fontSize: 11.5, color: c.text4, margin: '0 0 12px' }}>{sub}</p>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {items.length === 0
          ? <div style={{ fontFamily: 'var(--dmsans)', fontSize: 12.5, color: c.text4, padding: '14px 14px', background: c.subtle, border: `1px dashed ${c.subtleBorder}`, borderRadius: 11 }}>Nothing here{title === 'Doing now' ? ' — no daemons are actively running.' : title === 'Upcoming' ? ' — nothing scheduled or awaiting approval.' : ' yet.'}</div>
          : items.map(it => <Card key={it.id} item={it} c={c} />)}
      </div>
    </div>
  );
}

export function ActivityPage() {
  const c = useC();
  const { isMobile } = useViewport();
  const { token } = useAuth();
  const { data, loading, error } = useFetch('/api/overview?view=activity', token);

  const now = data?.now || [], upcoming = data?.upcoming || [], done = data?.done || [];

  return (
    <div style={{ padding: isMobile ? '20px 16px' : '28px 32px', overflowY: 'auto', height: '100%', background: c.bg, transition: 'background 0.2s' }}>
      <div style={{ maxWidth: 1160, margin: '0 auto' }}>
        <p className="wd-label-blue" style={{ marginBottom: 8 }}>WORKSPACE</p>
        <h1 style={{ fontFamily: 'var(--inter)', fontSize: isMobile ? 20 : 24, fontWeight: 700, color: c.text, letterSpacing: '-0.03em', marginBottom: 4 }}>Activity</h1>
        <p style={{ fontFamily: 'var(--dmsans)', fontSize: 13.5, color: c.text3, marginBottom: 22 }}>What your daemons are doing now, what they've done, and what's coming up.</p>

        {error && <EmptyState icon="⚠" title="Couldn't load activity" subtitle={String(error)} />}

        {loading
          ? <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : 'repeat(3, 1fr)', gap: 18 }}>{Array.from({ length: 3 }).map((_, i) => <div key={i}>{Array.from({ length: 3 }).map((_, j) => <SkeletonRow key={j} height={64} />)}</div>)}</div>
          : (
            <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : 'repeat(3, 1fr)', gap: 18, alignItems: 'start' }}>
              <Column title="Doing now" sub="Live — running this moment" items={now} c={c} accent="#3b6ef7" isMobile={isMobile} />
              <Column title="Upcoming" sub="Scheduled or awaiting your approval" items={upcoming} c={c} accent="#f59e0b" isMobile={isMobile} />
              <Column title="Done" sub="Recently completed" items={done} c={c} accent="#10b981" isMobile={isMobile} />
            </div>
          )}
      </div>
    </div>
  );
}

export default ActivityPage;
