import { useState, useEffect, useRef, useCallback } from 'react';
import { Routes, Route, Navigate, useNavigate } from 'react-router-dom';
import Sidebar from '../components/layout/Sidebar.jsx';
import DaemonMark from '../components/brand/DaemonMark.jsx';
import { useTheme, useViewport } from '../context/ThemeContext.jsx';
import { useAuth } from '../context/AuthContext.jsx';
import { brainApi } from '../lib/brainApi.js';
import {
  BarChart, Bar, LineChart, Line, AreaChart, Area,
  XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid,
} from 'recharts';

// ─────────────────────────────────────────────────────────────────────────────
// THEME COLORS
// ─────────────────────────────────────────────────────────────────────────────

function useC() {
  const { theme } = useTheme();
  const d = theme === 'dark';
  return {
    d,
    text:         d ? '#eeeef2'                  : '#1a1a1a',
    text2:        d ? '#9898a8'                  : '#5d5b54',
    text3:        d ? '#585868'                  : '#a4a097',
    text4:        d ? '#2e2e3e'                  : '#ccc9c2',
    bg:           d ? '#0d0d10'                  : '#ffffff',
    surface:      d ? '#131318'                  : '#f6f5f4',
    card:         d ? '#131318'                  : '#ffffff',
    cardBorder:   d ? '#1e1e28'                  : 'rgba(0,0,0,0.07)',
    cardShadow:   d ? 'none'                     : '0 1px 3px rgba(15,15,15,0.06)',
    stat:         d ? '#17171d'                  : '#f6f5f4',
    statBorder:   d ? '#1e1e28'                  : 'rgba(0,0,0,0.07)',
    statShadow:   d ? 'none'                     : '0 1px 3px rgba(15,15,15,0.05)',
    row:          d ? 'rgba(255,255,255,0.02)'   : 'rgba(0,0,0,0.02)',
    rowBorder:    d ? '#1e1e28'                  : 'rgba(0,0,0,0.06)',
    subtle:       d ? '#131318'                  : 'rgba(0,0,0,0.02)',
    subtleBorder: d ? '#1e1e28'                  : '#e5e3df',
    headerBg:     d ? '#0d0d10'                  : '#ffffff',
    headerBorder: d ? '#1e1e28'                  : '#e5e3df',
    inputBg:      d ? '#17171d'                  : '#ffffff',
    inputBorder:  d ? '#262630'                  : '#c8c4be',
    thinkingBg:   d ? 'rgba(255,255,255,0.02)'   : 'rgba(0,0,0,0.02)',
    thinkingBorder: d ? '#1e1e28'                : '#e5e3df',
    // New tokens
    navy:         '#0c1428',
    navyMid:      d ? '#111d3a'                  : '#0c1428',
    surface2:     d ? '#17171d'                  : '#efeeec',
    surface3:     d ? '#1c1c24'                  : '#e8e6e3',
    hairline:     d ? '#1e1e28'                  : '#e5e3df',
    hairlineStrong: d ? '#262630'                : '#c8c4be',
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// STYLE CONSTANTS
// ─────────────────────────────────────────────────────────────────────────────

const CHART_COLORS  = ['#4172f5', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6'];
const ACCENT_COLORS = { ok: '#10b981', warn: '#f59e0b', danger: '#ef4444', blue: '#4172f5' };

const PRIORITY_STYLES = {
  P0: { bg: 'rgba(239,68,68,0.11)',   border: 'rgba(239,68,68,0.3)',   color: '#ef4444' },
  P1: { bg: 'rgba(245,158,11,0.1)',   border: 'rgba(245,158,11,0.28)', color: '#f59e0b' },
  P2: { bg: 'rgba(65,114,245,0.08)',  border: 'rgba(65,114,245,0.2)',  color: '#4172f5' },
};

const SOURCE_COLORS = {
  Slack: '#4a154b', Jira: '#0052cc', GitHub: '#24292e',
  Gmail: '#ea4335', Notion: '#191919', Linear: '#5e6ad2',
  Figma: '#f24e1e', Default: '#4172f5',
};

// ─────────────────────────────────────────────────────────────────────────────
// CONTEXT PRESETS  (role categories — not demo data)
// ─────────────────────────────────────────────────────────────────────────────

const CONTEXT_PRESETS = [
  {
    id: 'tech', name: 'Tech / SaaS',
    roles: [
      { id: 'ceo',   label: 'CEO / Founder',   sub: 'Strategy, fundraising & vision' },
      { id: 'cto',   label: 'CTO',             sub: 'Architecture, infra & eng team' },
      { id: 'pm',    label: 'Product Manager', sub: 'Roadmap, specs & prioritization' },
      { id: 'eng',   label: 'Eng Lead',        sub: 'Sprints, code review & velocity' },
      { id: 'sales', label: 'Head of Sales',   sub: 'Pipeline, quotas & revenue' },
    ],
  },
  {
    id: 'health', name: 'Healthcare',
    roles: [
      { id: 'coo',     label: 'COO',             sub: 'Operations, compliance & staffing' },
      { id: 'doc',     label: 'Medical Director', sub: 'Clinical protocols & care quality' },
      { id: 'billing', label: 'Billing Manager',  sub: 'Claims, codes & revenue cycle' },
      { id: 'it',      label: 'Health IT Lead',   sub: 'EHR systems & HIPAA compliance' },
    ],
  },
  {
    id: 'agency', name: 'Agency',
    roles: [
      { id: 'cd',   label: 'Creative Director', sub: 'Brand strategy & creative vision' },
      { id: 'acct', label: 'Account Director',  sub: 'Clients, scopes & deliverables' },
      { id: 'lead', label: 'Lead Designer',     sub: 'Visual systems & design reviews' },
      { id: 'strat',label: 'Brand Strategist',  sub: 'Positioning & market research' },
    ],
  },
];

// ─────────────────────────────────────────────────────────────────────────────
// DATA FETCHING
// ─────────────────────────────────────────────────────────────────────────────

function useFetch(url, token) {
  const [data, setData]       = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetch(url, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    })
      .then(r => { if (!r.ok) throw new Error(r.statusText); return r.json(); })
      .then(d  => { if (!cancelled) setData(d); })
      .catch(e => { if (!cancelled) setError(e.message); })
      .finally(()=> { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [url, token]);

  return { data, loading, error };
}

// Fetch from the new Brain backend (VITE_BRAIN_API_URL) when configured, else the
// legacy same-origin path. `adapt` maps the backend shape to what the UI expects.
function useBrainFetch({ brainPath, legacyPath, adapt }, token) {
  const brainUrl = (import.meta.env.VITE_BRAIN_API_URL || '').replace(/\/$/, '');
  const url = brainUrl ? `${brainUrl}${brainPath}` : legacyPath;
  const { data, loading, error } = useFetch(url, token);
  const mapped = brainUrl && data && adapt ? adapt(data) : data;
  return { data: mapped, loading, error };
}

// ─────────────────────────────────────────────────────────────────────────────
// SHARED UI
// ─────────────────────────────────────────────────────────────────────────────

function Spinner({ size = 14 }) {
  return (
    <span style={{
      width: size, height: size, display: 'inline-block',
      border: '2px solid rgba(255,255,255,0.1)',
      borderTopColor: 'rgba(255,255,255,0.65)',
      borderRadius: '50%',
      animation: 'wd-spin 0.75s linear infinite',
    }} />
  );
}

function SkeletonRow({ height = 48, radius = 9 }) {
  const c = useC();
  return (
    <div style={{
      height, borderRadius: radius,
      background: c.d
        ? 'linear-gradient(90deg, rgba(255,255,255,0.03) 25%, rgba(255,255,255,0.06) 50%, rgba(255,255,255,0.03) 75%)'
        : 'linear-gradient(90deg, rgba(0,0,0,0.03) 25%, rgba(0,0,0,0.05) 50%, rgba(0,0,0,0.03) 75%)',
      backgroundSize: '400% 100%',
      animation: 'wd-shimmer 1.4s ease infinite',
    }} />
  );
}

function EmptyState({ icon = '◈', title, subtitle, cta, onCta }) {
  const c = useC();
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', gap: 14, padding: 48 }}>
      <div style={{
        width: 48, height: 48, borderRadius: 12,
        background: c.subtle, border: `1px solid ${c.subtleBorder}`,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontFamily: 'var(--mono)', fontSize: 18, color: c.text3,
      }}>{icon}</div>
      <div style={{ textAlign: 'center', maxWidth: 320 }}>
        <p style={{ fontFamily: 'var(--dmsans)', fontSize: 15, fontWeight: 600, color: c.text, marginBottom: 6 }}>{title}</p>
        <p style={{ fontFamily: 'var(--dmsans)', fontSize: 13, color: c.text3, lineHeight: 1.6 }}>{subtitle}</p>
      </div>
      {cta && (
        <button className="wd-btn" onClick={onCta} style={{ marginTop: 4, fontSize: 11, letterSpacing: '0.06em' }}>
          {cta}
        </button>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// MARKDOWN RENDERER
// ─────────────────────────────────────────────────────────────────────────────

function Md({ text, c }) {
  if (!text) return null;
  return (
    <div style={{ fontFamily: 'var(--dmsans)', fontSize: 15, color: c.text, lineHeight: 1.75 }}>
      {text.split('\n\n').map((para, pi) => (
        <p key={pi} style={{ margin: pi > 0 ? '10px 0 0' : 0 }}>
          {para.split(/\*\*([^*]+)\*\*/).map((part, i) =>
            i % 2 === 1
              ? <strong key={i} style={{ color: c.text, fontWeight: 600 }}>{part}</strong>
              : part
          )}
        </p>
      ))}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// BLOCK RENDERERS
// ─────────────────────────────────────────────────────────────────────────────

function BlockBoot({ block }) {
  const c = useC();
  const statusIcon  = { ok: '✓', pending: '⋯', fail: '✕' };
  const statusColor = { ok: '#10b981', pending: '#f59e0b', fail: '#ef4444' };
  return (
    <div style={{ border: `1px solid ${c.cardBorder}`, borderRadius: 12, overflow: 'hidden' }}>
      <div style={{ padding: '8px 16px', background: c.d ? 'rgba(255,255,255,0.03)' : 'rgba(0,0,0,0.02)', borderBottom: `1px solid ${c.cardBorder}` }}>
        <span style={{ fontFamily: 'var(--mono)', fontSize: 9, letterSpacing: '0.12em', color: c.text3 }}>{block.title || 'DAEMON BOOT SEQUENCE'}</span>
      </div>
      <div style={{ padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: 9 }}>
        {(block.lines || []).map((line, i) => {
          const s = line.status || 'ok';
          return (
            <div key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
              <span style={{ fontFamily: 'var(--mono)', fontSize: 12, color: statusColor[s] || '#4172f5', width: 14, flexShrink: 0, marginTop: 1 }}>{statusIcon[s] || '·'}</span>
              <span style={{ fontFamily: 'var(--mono)', fontSize: 10, color: c.text3, width: 130, flexShrink: 0, letterSpacing: '0.05em', paddingTop: 1 }}>{line.label}</span>
              <span style={{ fontFamily: 'var(--dmsans)', fontSize: 13, color: c.text2, flex: 1, lineHeight: 1.4 }}>{line.detail}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function BlockText({ block }) {
  const c = useC();
  if (block.md) return <Md text={block.md} c={c} />;
  return <div style={{ fontFamily: 'var(--dmsans)', fontSize: 15, color: c.text2, lineHeight: 1.75 }}>{block.content}</div>;
}

function BlockStatGrid({ block }) {
  const c = useC();
  const { isMobile } = useViewport();
  return (
    <div className="wd-block-stats" style={{ display: 'grid', gridTemplateColumns: isMobile ? 'repeat(2, 1fr)' : 'repeat(auto-fit, minmax(140px, 1fr))', gap: 10, padding: 12, borderRadius: 12, borderWidth: '1px', borderStyle: 'solid' }}>
      {(block.stats || []).map((s, i) => (
        <div key={i} style={{ padding: '14px 16px', background: c.stat, border: `1px solid ${c.statBorder}`, borderRadius: 10, boxShadow: c.statShadow }}>
          <div style={{ fontFamily: 'var(--mono)', fontSize: 10, color: c.text3, letterSpacing: '0.1em', marginBottom: 6 }}>{(s.label || '').toUpperCase()}</div>
          <div style={{ fontFamily: 'var(--orbitron)', fontSize: 22, fontWeight: 700, color: (s.accent || s.status) ? ACCENT_COLORS[s.accent || s.status] : c.text, letterSpacing: '-0.01em', marginBottom: 4 }}>{s.value}</div>
          {s.unit   && <div style={{ fontFamily: 'var(--inter)', fontSize: 12, color: c.text3 }}>{s.unit}</div>}
          {s.source && (
            <div style={{ marginTop: 8, display: 'inline-flex', padding: '2px 8px', background: c.subtle, border: `1px solid ${c.subtleBorder}`, borderRadius: 5 }}>
              <span style={{ fontFamily: 'var(--mono)', fontSize: 9, color: c.text4, letterSpacing: '0.06em' }}>#{s.source}</span>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

function BlockChartBar({ block }) {
  const c = useC();
  return (
    <div>
      {block.title && <p style={{ fontFamily: 'var(--mono)', fontSize: 10, color: c.text3, letterSpacing: '0.1em', marginBottom: 12 }}>{block.title.toUpperCase()}</p>}
      <ResponsiveContainer width="100%" height={180}>
        <BarChart data={block.data || []} margin={{ top: 4, right: 4, bottom: 4, left: -20 }}>
          <CartesianGrid stroke={c.d ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.06)'} vertical={false} />
          <XAxis dataKey="name" tick={{ fontFamily: 'var(--mono)', fontSize: 9, fill: c.text3 }} axisLine={false} tickLine={false} />
          <YAxis tick={{ fontFamily: 'var(--mono)', fontSize: 9, fill: c.text4 }} axisLine={false} tickLine={false} />
          <Tooltip contentStyle={{ background: c.surface, border: `1px solid ${c.cardBorder}`, borderRadius: 8, fontFamily: 'var(--mono)', fontSize: 11, color: c.text }} labelStyle={{ color: c.text3 }} itemStyle={{ color: '#4172f5' }} />
          {(block.keys || ['value']).map((k, i) => <Bar key={k} dataKey={k} fill={CHART_COLORS[i % CHART_COLORS.length]} radius={[3, 3, 0, 0]} />)}
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

function BlockChartLine({ block }) {
  const c = useC();
  const ChartComp = block.filled ? AreaChart : LineChart;
  const DataComp  = block.filled ? Area      : Line;
  return (
    <div>
      {block.title && <p style={{ fontFamily: 'var(--mono)', fontSize: 10, color: c.text3, letterSpacing: '0.1em', marginBottom: 12 }}>{block.title.toUpperCase()}</p>}
      <ResponsiveContainer width="100%" height={180}>
        <ChartComp data={block.data || []} margin={{ top: 4, right: 4, bottom: 4, left: -20 }}>
          <CartesianGrid stroke={c.d ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.06)'} vertical={false} />
          <XAxis dataKey="name" tick={{ fontFamily: 'var(--mono)', fontSize: 9, fill: c.text3 }} axisLine={false} tickLine={false} />
          <YAxis tick={{ fontFamily: 'var(--mono)', fontSize: 9, fill: c.text4 }} axisLine={false} tickLine={false} />
          <Tooltip contentStyle={{ background: c.surface, border: `1px solid ${c.cardBorder}`, borderRadius: 8, fontFamily: 'var(--mono)', fontSize: 11, color: c.text }} labelStyle={{ color: c.text3 }} itemStyle={{ color: '#4172f5' }} />
          {(block.keys || ['value']).map((k, i) => (
            <DataComp key={k} dataKey={k} stroke={CHART_COLORS[i % CHART_COLORS.length]} strokeWidth={2} dot={false}
              {...(block.filled ? { fill: `${CHART_COLORS[i % CHART_COLORS.length]}18`, fillOpacity: 1 } : {})} />
          ))}
        </ChartComp>
      </ResponsiveContainer>
    </div>
  );
}

function BlockAlert({ block }) {
  const c = useC();
  const styles = {
    info:     { leftBorder: '#4172f5', title: '#4172f5', icon: 'ℹ', tintClass: 'wd-block-alert-info' },
    success:  { leftBorder: '#10b981', title: '#10b981', icon: '✓', tintClass: 'wd-block-alert-ok' },
    warning:  { leftBorder: '#f59e0b', title: '#f59e0b', icon: '⚠', tintClass: 'wd-block-alert-warn' },
    warn:     { leftBorder: '#f59e0b', title: '#f59e0b', icon: '⚠', tintClass: 'wd-block-alert-warn' },
    danger:   { leftBorder: '#ef4444', title: '#ef4444', icon: '×', tintClass: 'wd-block-alert-danger' },
    critical: { leftBorder: '#ef4444', title: '#ef4444', icon: '×', tintClass: 'wd-block-alert-danger' },
    error:    { leftBorder: '#ef4444', title: '#ef4444', icon: '×', tintClass: 'wd-block-alert-danger' },
    ok:       { leftBorder: '#10b981', title: '#10b981', icon: '✓', tintClass: 'wd-block-alert-ok' },
  };
  const s = styles[block.level] || styles.info;
  return (
    <div className={s.tintClass} style={{ padding: '13px 16px', borderRadius: 10, borderWidth: '1px', borderStyle: 'solid', borderLeftWidth: '3px', borderLeftColor: s.leftBorder }}>
      {block.title && (
        <div style={{ fontFamily: 'var(--mono)', fontSize: 11, color: s.title, letterSpacing: '0.08em', marginBottom: 6, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 6 }}>
          <span>{s.icon}</span> {block.title}
        </div>
      )}
      <div style={{ fontFamily: 'var(--inter)', fontSize: 14, color: c.text2, lineHeight: 1.6 }}>{block.content}</div>
      {block.tag && (
        <div style={{ marginTop: 10 }}>
          <span style={{ display: 'inline-flex', padding: '3px 9px', background: c.subtle, border: `1px solid ${c.subtleBorder}`, borderRadius: 5, fontFamily: 'var(--mono)', fontSize: 10, color: c.text4, letterSpacing: '0.08em' }}>{block.tag}</span>
        </div>
      )}
    </div>
  );
}

function BlockPeopleList({ block }) {
  const c = useC();
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {(block.people || []).map((p, i) => (
        <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '11px 14px', background: c.row, border: `1px solid ${c.rowBorder}`, borderRadius: 9 }}>
          <div style={{ width: 34, height: 34, borderRadius: '50%', background: '#4172f5', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'var(--orbitron)', fontSize: 11, fontWeight: 700, color: '#fff', flexShrink: 0 }}>
            {(p.name || '?').charAt(0)}
          </div>
          <div style={{ flex: 1 }}>
            <div style={{ fontFamily: 'var(--dmsans)', fontSize: 14, fontWeight: 500, color: c.text }}>{p.name}</div>
            <div style={{ fontFamily: 'var(--dmsans)', fontSize: 12, color: c.text3, marginTop: 1 }}>{p.role || p.title || ''}</div>
          </div>
          {p.metric && <span style={{ fontFamily: 'var(--mono)', fontSize: 10, color: c.text3, whiteSpace: 'nowrap' }}>{p.metric}</span>}
          {p.status && (
            <span style={{ padding: '3px 9px', borderRadius: 5, fontFamily: 'var(--mono)', fontSize: 9, letterSpacing: '0.08em', background: p.status === 'online' ? (c.d ? 'rgba(16,185,129,0.1)' : 'rgba(16,185,129,0.08)') : c.subtle, border: `1px solid ${p.status === 'online' ? 'rgba(16,185,129,0.25)' : c.subtleBorder}`, color: p.status === 'online' ? '#10b981' : c.text4 }}>
              {p.status.toUpperCase()}
            </span>
          )}
        </div>
      ))}
    </div>
  );
}

function BlockTimeline({ block }) {
  const c = useC();
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
      {(block.events || []).map((ev, i) => (
        <div key={i} style={{ display: 'flex', gap: 14, paddingBottom: i < block.events.length - 1 ? 16 : 0 }}>
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', flexShrink: 0 }}>
            <div style={{ width: 9, height: 9, borderRadius: '50%', background: ev.accent ? '#4172f5' : c.rowBorder, border: `2px solid ${ev.accent ? '#4172f5' : c.subtleBorder}`, marginTop: 4, flexShrink: 0 }} />
            {i < (block.events || []).length - 1 && <div style={{ width: 1, flex: 1, background: c.subtleBorder, marginTop: 4 }} />}
          </div>
          <div style={{ paddingBottom: 4 }}>
            <div style={{ fontFamily: 'var(--dmsans)', fontSize: 14, color: c.text2, lineHeight: 1.5 }}>{ev.title}</div>
            {ev.time && <div style={{ fontFamily: 'var(--mono)', fontSize: 10, color: c.text4, letterSpacing: '0.06em', marginTop: 3 }}>{ev.time}</div>}
          </div>
        </div>
      ))}
    </div>
  );
}

function BlockProgressBars({ block }) {
  const c = useC();
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      {(block.items || []).map((item, i) => {
        const pct = item.value != null ? item.value
          : item.target > 0 ? Math.round((item.current / item.target) * 100) : 0;
        const barColor = item.color || (item.status === 'danger' ? '#ef4444' : item.status === 'warn' ? '#f59e0b' : '#4172f5');
        return (
          <div key={i}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
              <span style={{ fontFamily: 'var(--dmsans)', fontSize: 13, color: c.text2 }}>{item.label}</span>
              <span style={{ fontFamily: 'var(--mono)', fontSize: 11, color: c.text3 }}>
                {item.current != null ? `${item.current}/${item.target}` : pct}{item.unit || '%'}
              </span>
            </div>
            <div style={{ height: 5, background: c.d ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.08)', borderRadius: 3, overflow: 'hidden' }}>
              <div style={{ height: '100%', width: `${Math.min(pct, 100)}%`, background: barColor, borderRadius: 3, animation: 'wd-progress 0.8s ease both' }} />
            </div>
          </div>
        );
      })}
    </div>
  );
}

function BlockKanban({ block }) {
  const c = useC();
  return (
    <div style={{ display: 'flex', gap: 12, overflowX: 'auto', paddingBottom: 4 }}>
      {(block.columns || []).map((col, ci) => (
        <div key={ci} style={{ minWidth: 190, flex: '0 0 190px' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
            <span style={{ fontFamily: 'var(--mono)', fontSize: 10, color: c.text3, letterSpacing: '0.1em' }}>{(col.title || '').toUpperCase()}</span>
            <span style={{ fontFamily: 'var(--mono)', fontSize: 10, color: c.text4 }}>{(col.items || []).length}</span>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {(col.items || []).map((item, ii) => (
              <div key={ii} style={{ padding: '10px 12px', background: c.row, border: `1px solid ${c.rowBorder}`, borderRadius: 8 }}>
                <div style={{ fontFamily: 'var(--dmsans)', fontSize: 13, color: c.text2, lineHeight: 1.4 }}>{typeof item === 'string' ? item : item.title}</div>
                {item.tag && <span style={{ display: 'inline-block', marginTop: 5, padding: '2px 7px', background: c.subtle, border: `1px solid ${c.subtleBorder}`, borderRadius: 4, fontFamily: 'var(--mono)', fontSize: 9, color: c.text4, letterSpacing: '0.06em' }}>{item.tag}</span>}
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function BlockActionConfirm({ block, onConfirm, onCancel }) {
  const c = useC();
  const [dismissed, setDismissed] = useState(false);
  if (dismissed) return null;
  return (
    <div style={{ border: `1px solid ${c.cardBorder}`, borderRadius: 12, overflow: 'hidden' }}>
      <div style={{ padding: '8px 16px', background: c.d ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.03)', borderBottom: `1px solid ${c.cardBorder}` }}>
        <span style={{ fontFamily: 'var(--mono)', fontSize: 9, letterSpacing: '0.12em', color: c.text3 }}>ACTION PENDING CONFIRMATION</span>
      </div>
      <div style={{ padding: '16px 18px' }}>
        <div style={{ fontFamily: 'var(--dmsans)', fontSize: 15, fontWeight: 600, color: c.text, marginBottom: 6 }}>{block.title}</div>
        {block.description && (
          <div style={{ fontFamily: 'var(--dmsans)', fontSize: 13, color: c.text3, marginBottom: 14, lineHeight: 1.5 }}>{block.description}</div>
        )}
        {(block.steps || []).length > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 14 }}>
            {block.steps.map((step, i) => (
              <div key={i} style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
                <div style={{ width: 22, height: 22, borderRadius: 6, background: c.subtle, border: `1px solid ${c.subtleBorder}`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'var(--mono)', fontSize: 10, color: c.text3, flexShrink: 0, marginTop: 1 }}>{i + 1}</div>
                <div style={{ fontFamily: 'var(--dmsans)', fontSize: 13, color: c.text2, lineHeight: 1.5, paddingTop: 2 }}>{step}</div>
              </div>
            ))}
          </div>
        )}
        {block.consequence && (
          <div style={{ padding: '10px 14px', background: c.d ? 'rgba(255,255,255,0.03)' : 'rgba(0,0,0,0.03)', border: `1px solid ${c.subtleBorder}`, borderRadius: 8, fontFamily: 'var(--dmsans)', fontSize: 12, color: c.text3, lineHeight: 1.5, marginBottom: 16 }}>
            {block.consequence}
          </div>
        )}
        <div style={{ display: 'flex', gap: 10 }}>
          <button className="wd-btn" style={{ flex: 1, height: 44, fontSize: 9, letterSpacing: '0.1em' }}
            onClick={() => { onConfirm?.(block.id); setDismissed(true); }}>
            CONFIRM — EXECUTE
          </button>
          <button className="wd-btn-ghost" style={{ height: 44, padding: '0 20px', justifyContent: 'center', fontFamily: 'var(--mono)', fontSize: 9, letterSpacing: '0.1em' }}
            onClick={() => { onCancel?.(); setDismissed(true); }}>
            CANCEL
          </button>
        </div>
      </div>
    </div>
  );
}

function BlockActionDone({ block }) {
  const c = useC();
  return (
    <div style={{ padding: '12px 16px', background: c.d ? 'rgba(16,185,129,0.08)' : 'rgba(16,185,129,0.06)', border: '1px solid rgba(16,185,129,0.22)', borderLeft: '3px solid #10b981', borderRadius: '0 10px 10px 0' }}>
      <div style={{ fontFamily: 'var(--dmsans)', fontSize: 13, color: '#10b981', lineHeight: 1.6 }}>{block.summary}</div>
    </div>
  );
}

function BlockInvoiceTable({ block }) {
  const c = useC();
  const total = (block.rows || []).reduce((sum, r) => sum + (r.amount || 0), 0);
  return (
    <div style={{ border: `1px solid ${c.cardBorder}`, borderRadius: 10, overflow: 'hidden' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead>
          <tr style={{ background: c.stat, borderBottom: `1px solid ${c.statBorder}` }}>
            {(block.columns || ['Item', 'Amount']).map(col => (
              <th key={col} style={{ padding: '9px 14px', textAlign: 'left', fontFamily: 'var(--mono)', fontSize: 10, color: c.text3, letterSpacing: '0.1em', fontWeight: 400 }}>{col.toUpperCase()}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {(block.rows || []).map((row, i) => (
            <tr key={i} style={{ borderBottom: i < block.rows.length - 1 ? `1px solid ${c.rowBorder}` : 'none' }}>
              {Object.values(row).map((val, j) => (
                <td key={j} style={{ padding: '10px 14px', fontFamily: j === 0 ? 'var(--dmsans)' : 'var(--mono)', fontSize: j === 0 ? 13 : 12, color: c.text2 }}>
                  {typeof val === 'number' ? `$${val.toLocaleString()}` : val}
                </td>
              ))}
            </tr>
          ))}
          {block.showTotal && (
            <tr style={{ borderTop: `1px solid ${c.statBorder}`, background: c.stat }}>
              <td colSpan={(block.columns || []).length - 1} style={{ padding: '10px 14px', fontFamily: 'var(--mono)', fontSize: 10, color: c.text3, letterSpacing: '0.1em' }}>TOTAL</td>
              <td style={{ padding: '10px 14px', fontFamily: 'var(--orbitron)', fontSize: 15, fontWeight: 700, color: c.text }}>${total.toLocaleString()}</td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

function renderBlock(block, i, { onConfirm, onCancel } = {}) {
  const wrap = (content) => (
    <div key={i}>
      {block.label && <p style={{ fontFamily: 'var(--mono)', fontSize: 10, color: 'var(--text-3)', letterSpacing: '0.1em', marginBottom: 10 }}>{block.label.toUpperCase()}</p>}
      {content}
    </div>
  );
  switch (block.type) {
    case 'boot':           return wrap(<BlockBoot block={block} />);
    case 'text':           return wrap(<BlockText block={block} />);
    case 'stat_grid':      return wrap(<BlockStatGrid block={block} />);
    case 'chart_bar':      return wrap(<BlockChartBar block={block} />);
    case 'chart_line':     return wrap(<BlockChartLine block={block} />);
    case 'alert':          return wrap(<BlockAlert block={block} />);
    case 'kanban':         return wrap(<BlockKanban block={block} />);
    case 'people_list':    return wrap(<BlockPeopleList block={block} />);
    case 'timeline':       return wrap(<BlockTimeline block={block} />);
    case 'progress_bars':  return wrap(<BlockProgressBars block={block} />);
    case 'action_confirm': return wrap(<BlockActionConfirm block={block} onConfirm={onConfirm} onCancel={onCancel} />);
    case 'action_done':    return wrap(<BlockActionDone block={block} />);
    case 'invoice_table':  return wrap(<BlockInvoiceTable block={block} />);
    default:               return wrap(<BlockText block={{ md: typeof block === 'string' ? block : JSON.stringify(block) }} />);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// CHAT API
// ─────────────────────────────────────────────────────────────────────────────

function buildDaemonPrompt({ name, title, company, industry, size, permissionLevel = 2 }) {
  const firstName = name ? name.split(' ')[0] : 'there';
  const permLabels = { 1: 'Copilot (read-only)', 2: 'Assistant (confirm before act)', 3: 'Autonomous (execute and report)' };

  return `OUTPUT CONTRACT — ABSOLUTE RULE:
Your response is one JSON object. First character: {. Last character: }. Nothing else. No reasoning. No planning. No asterisks. No text before or after. Violating this breaks the interface.

{"blocks":[...],"suggestions":["...","...","..."]}

IDENTITY:
Owner: ${name || 'Unknown'}${title ? ` (${title})` : ''}
Company: ${company || 'Unknown'}${industry ? `, ${industry}` : ''}${size ? `, ${size}` : ''}
Permission: ${permissionLevel} — ${permLabels[permissionLevel] || permLabels[2]}

BLOCK TYPES:
{"type":"boot","title":"DAEMON BOOT SEQUENCE","lines":[{"label":"Identity","status":"ok","detail":"${name || 'User'} · ${title || 'Staff'}"},{"label":"Company Brain","status":"ok","detail":"${company || 'Workspace'} · LINKED"},{"label":"Knowledge graph","status":"pending","detail":"Connect tools to activate"},{"label":"Permission","status":"ok","detail":"LEVEL ${permissionLevel}"},{"label":"Memory","status":"pending","detail":"Learning your patterns"}]}
{"type":"text","md":"**bold** names/IDs/amounts/deadlines. No bullet dashes. Cite: (Jira BUG-119), (Slack #eng 15 May)."}
{"type":"stat_grid","stats":[{"label":"Sprint Progress","value":"3","unit":"of 8","source":"Jira","status":"warn"}]}
{"type":"kanban","columns":[{"title":"Blocked","items":[{"id":"BUG-119","title":"Login fix","assignee":"James","priority":"P0","blockers":"3 days stale"}]}]}
{"type":"alert","level":"critical","title":"...","content":"...","tag":"..."}  level: critical|warning|info
{"type":"action_confirm","id":"uid","title":"...","description":"...","steps":["..."],"consequence":"..."}
{"type":"action_done","summary":"✓ done, where, when."}
{"type":"people_list","people":[{"name":"James","role":"Lead Dev","initial":"J","status":"blocked","note":"..."}]}
{"type":"timeline","events":[{"date":"15 May","title":"...","body":"...","source":"Jira","event_type":"decision"}]}
{"type":"progress_bars","items":[{"label":"Q2 Revenue","current":87,"target":100,"unit":"%","status":"warn"}]}
{"type":"chart_bar","title":"...","keys":["value"],"data":[{"name":"Sprint 22","value":12}]}
{"type":"chart_line","title":"...","keys":["value"],"data":[{"name":"Jan","value":1.2}]}
{"type":"invoice_table","columns":["Client","Amount"],"rows":[{"client":"Acme","amount":5000}],"showTotal":true}

BLOCK SELECTION: Session start→boot+text+stat_grid/alert | Metrics→stat_grid+chart | Tasks→kanban | Team→people_list | Urgent→alert | History→timeline | Goals→progress_bars+stat_grid | Action(L2)→action_confirm | Action(L3)→action_done | Financial→invoice_table+stat_grid | General→text+block. Open with text or boot. 2–5 blocks max.

PERMISSION: L1=read only | L2=action_confirm, wait for confirm | L3=execute then action_done

SESSION START when "[SESSION_START]": boot block first, then text greeting ${firstName} with company-aware intro, then 1–2 relevant blocks. If no tools: acknowledge and offer 3 specific connection steps.

LANGUAGE: Bold names/IDs/deadlines/amounts. Prose not dashes. Cite every fact. End with exactly 3 specific actionable suggestions. Never: visible reasoning, "As an AI", "I don't have access".`;
}

function serializeDaemonMsg(msg) {
  if (msg.role === 'user') return { role: 'user', content: msg.text || '' };
  const content = msg.blocks
    ? JSON.stringify({ blocks: msg.blocks })
    : (msg.text || '');
  return { role: 'assistant', content };
}

function parseJsonResponse(text) {
  if (!text) return { blocks: [], suggestions: [] };
  // Strip <thinking> tags (extended thinking models)
  let t = text.replace(/<thinking>[\s\S]*?<\/thinking>/gi, '').trim();
  // 1. Direct parse
  try { const p = JSON.parse(t); if (p.blocks) return p; } catch {}
  // 2. Code fence
  const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) { try { const p = JSON.parse(fence[1].trim()); if (p.blocks) return p; } catch {} }
  // 3. Balanced brace scan — first complete JSON object that has "blocks"
  let depth = 0, start = -1;
  for (let i = 0; i < t.length; i++) {
    if (t[i] === '{') { if (depth === 0) start = i; depth++; }
    else if (t[i] === '}') {
      depth--;
      if (depth === 0 && start !== -1) {
        try { const p = JSON.parse(t.slice(start, i + 1)); if (p.blocks) return p; } catch {}
        start = -1;
      }
    }
  }
  // 4. Fallback: show raw text
  return { blocks: [{ type: 'text', md: text }], suggestions: [] };
}

async function callDaemonAPI({ messages, context, apiKey, authToken }) {
  const sys = buildDaemonPrompt(context);

  // Direct Anthropic API (user-provided key)
  if (apiKey) {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
        'anthropic-dangerous-direct-browser-access': 'true',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 4096,
        system: sys,
        messages: messages.map(serializeDaemonMsg),
      }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error?.message || `API error ${res.status}`);
    }
    const data = await res.json();
    return parseJsonResponse(data.content[0]?.text || '');
  }

  // New FINAL-spec Brain backend (DeepSeek), when configured. Identity is derived
  // server-side from the auth token, so we only send the latest message + history.
  const brainUrl = (import.meta.env.VITE_BRAIN_API_URL || '').replace(/\/$/, '');
  if (brainUrl) {
    const serialized = messages.map(serializeDaemonMsg);
    const last = serialized[serialized.length - 1];
    const res = await fetch(`${brainUrl}/api/chat`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
      },
      body: JSON.stringify({
        message: typeof last?.content === 'string' ? last.content : (last?.content ?? ''),
        history: serialized.slice(0, -1),
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.detail || data.error || `Server error ${res.status}`);
    // Backend returns rich {blocks, suggestions}; fall back to a text block.
    return {
      blocks: data.blocks?.length ? data.blocks : [{ type: 'text', md: data.text || '' }],
      suggestions: data.suggestions || [],
    };
  }

  // Legacy backend endpoint (old /api/chat on the same origin)
  const res = await fetch('/api/chat', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
    },
    body: JSON.stringify({
      messages: messages.map(serializeDaemonMsg),
    }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `Server error ${res.status}`);
  }
  return res.json();
}

// ─────────────────────────────────────────────────────────────────────────────
// CHAT VIEW
// ─────────────────────────────────────────────────────────────────────────────

function dbMsgToDisplay(m) {
  if (m.role === 'user') return { role: 'user', text: m.content };
  try {
    const p = JSON.parse(m.content);
    return { role: 'daemon', blocks: p.blocks || [] };
  } catch {
    return { role: 'daemon', blocks: [{ type: 'text', md: m.content }] };
  }
}

function ChatView({ context, onBack, onMenu }) {
  const c = useC();
  const { isMobile } = useViewport();
  const { token: authToken } = useAuth();
  const [msgs, setMsgs]               = useState([]);
  const [suggestions, setSuggestions] = useState([]);
  const [input, setInput]             = useState('');
  const [thinking, setThinking]       = useState(false);
  const [error, setError]             = useState('');
  const [apiKey]                      = useState(() => sessionStorage.getItem('wd_apiKey') || '');
  const [historyLoaded, setHistoryLoaded] = useState(false);
  const bottomRef = useRef(null);
  const inputRef  = useRef(null);
  const startedRef = useRef(false);
  const hadHistoryRef = useRef(false);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [msgs, thinking]);

  // Seed the composer from elsewhere (e.g. Inbox "Use draft"), then clear it.
  useEffect(() => {
    const seed = sessionStorage.getItem('wd_daemon_seed');
    if (seed) {
      sessionStorage.removeItem('wd_daemon_seed');
      setInput(seed);
      setTimeout(() => inputRef.current?.focus(), 150);
    }
  }, []);

  // Restore the persisted transcript before firing the session greeting, so a
  // fresh login resumes the conversation instead of starting blank.
  useEffect(() => {
    if (!authToken || apiKey) { setHistoryLoaded(true); return; }
    const brainUrl = (import.meta.env.VITE_BRAIN_API_URL || '').replace(/\/$/, '');
    const url = brainUrl ? `${brainUrl}/api/chat/history?limit=30` : '/api/chat';
    fetch(url, { headers: { Authorization: `Bearer ${authToken}` } })
      .then(r => r.ok ? r.json() : { messages: [] })
      .then(({ messages }) => {
        // Filter out any session-ping sentinels that older builds persisted, so
        // a stray "[SESSION_RESUME]"/"[SESSION_START]" never renders as a bubble.
        const real = (messages || []).filter(
          m => !(m.role === 'user' && /^\[SESSION_(START|RESUME)\]$/.test((m.content || '').trim()))
        );
        if (real.length) {
          setMsgs(real.map(dbMsgToDisplay));
          hadHistoryRef.current = true;
        }
      })
      .catch(() => {})
      .finally(() => setHistoryLoaded(true));
  }, [authToken, apiKey]);

  const send = useCallback(async (text) => {
    const q = text.trim();
    if (!q || thinking) return;
    setError('');
    setSuggestions([]);
    const userMsg = { role: 'user', text: q };
    setMsgs(m => [...m, userMsg]);
    setInput('');
    setThinking(true);
    try {
      const { blocks, suggestions: nextSugs } = await callDaemonAPI({
        messages: [...msgs, userMsg],
        context, apiKey, authToken,
      });
      setMsgs(m => [...m, { role: 'daemon', blocks: blocks || [] }]);
      setSuggestions(nextSugs || []);
    } catch (e) {
      setError(e.message || 'Something went wrong. Try again.');
    } finally {
      setThinking(false);
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [msgs, context, apiKey, authToken, thinking]);

  // Session startup: fires after history is loaded. Fresh session → [SESSION_START]
  // (full boot greeting); returning session with restored history → [SESSION_RESUME]
  // (brief "welcome back" delta, prior transcript passed as conversation context).
  useEffect(() => {
    if (startedRef.current || !authToken || !historyLoaded) return;
    startedRef.current = true;
    setThinking(true);
    const sentinel = hadHistoryRef.current ? '[SESSION_RESUME]' : '[SESSION_START]';
    callDaemonAPI({
      messages: [...msgs, { role: 'user', text: sentinel }],
      context, apiKey, authToken,
    }).then(({ blocks, suggestions: sugs }) => {
      setMsgs(m => [...m, { role: 'daemon', blocks: blocks || [] }]);
      setSuggestions(sugs || []);
    }).catch(e => {
      setError(e.message || 'Failed to load Daemon. Try refreshing.');
    }).finally(() => setThinking(false));
  }, [authToken, historyLoaded]);

  const onConfirmAction = useCallback((actionId) => {
    send(`CONFIRMED — execute ${actionId}`);
  }, [send]);

  const onCancelAction = useCallback(() => {
    setSuggestions([]);
  }, []);

  const isLong = suggestions.some(s => s.length > 36);

  const clearChat = useCallback(() => {
    if (thinking) return;
    startedRef.current = false;
    setMsgs([]);
    setSuggestions([]);
    setError('');
    setThinking(true);
    callDaemonAPI({
      messages: [{ role: 'user', text: '[SESSION_START]' }],
      context, apiKey, authToken,
    }).then(({ blocks, suggestions: sugs }) => {
      setMsgs([{ role: 'daemon', blocks: blocks || [] }]);
      setSuggestions(sugs || []);
    }).catch(e => {
      setError(e.message || 'Failed to load Daemon. Try refreshing.');
    }).finally(() => {
      startedRef.current = true;
      setThinking(false);
    });
  }, [thinking, context, apiKey, authToken]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden', background: c.bg, transition: 'background 0.2s' }}>

      {/* Header — Notion navy hero band */}
      <div style={{ padding: isMobile ? '0 12px' : '0 24px', height: 52, display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderBottom: '1px solid rgba(255,255,255,0.08)', background: '#0c1428', flexShrink: 0, gap: 8 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: isMobile ? 8 : 14, minWidth: 0, flex: 1 }}>
          {isMobile && (
            <button type="button" onClick={onMenu} style={{ width: 32, height: 32, borderRadius: 8, background: 'none', border: 'none', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 4, cursor: 'pointer', padding: 0, flexShrink: 0, color: 'rgba(255,255,255,0.45)' }}>
              <span style={{ width: 16, height: 1.5, background: 'currentColor', borderRadius: 1, display: 'block' }} />
              <span style={{ width: 16, height: 1.5, background: 'currentColor', borderRadius: 1, display: 'block' }} />
              <span style={{ width: 11, height: 1.5, background: 'currentColor', borderRadius: 1, display: 'block', alignSelf: 'flex-start' }} />
            </button>
          )}
          {onBack && <div style={{ width: 1, height: 16, background: 'rgba(255,255,255,0.12)', flexShrink: 0 }} />}
          {onBack && (
          <button type="button" onClick={onBack} style={{ fontFamily: 'var(--mono)', fontSize: isMobile ? 9 : 13, color: 'rgba(255,255,255,0.45)', background: 'none', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4, padding: 0, letterSpacing: isMobile ? '0.08em' : 0, flexShrink: 0 }}
            onMouseEnter={e => { e.currentTarget.style.color = 'rgba(255,255,255,0.75)'; }}
            onMouseLeave={e => { e.currentTarget.style.color = 'rgba(255,255,255,0.45)'; }}>
            ← BACK
          </button>
          )}
          <div style={{ width: 1, height: 16, background: 'rgba(255,255,255,0.12)', flexShrink: 0 }} />
          <DaemonMark size={16} glow />
          <div style={{ fontFamily: 'var(--inter)', fontSize: isMobile ? 13 : 14, fontWeight: 600, color: '#eeeef2', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', letterSpacing: '-0.02em' }}>
            {context.roleLabel}
          </div>
          {!isMobile && context.company && (
            <>
              <div style={{ width: 1, height: 14, background: 'rgba(255,255,255,0.12)', flexShrink: 0 }} />
              <div style={{ fontFamily: 'var(--inter)', fontSize: 13, color: 'rgba(255,255,255,0.4)', whiteSpace: 'nowrap' }}>{context.company}</div>
            </>
          )}
        </div>
        <button
          type="button"
          onClick={clearChat}
          disabled={thinking}
          title="Clear chat and start fresh"
          style={{
            background: 'rgba(255,255,255,0.08)', border: '1px solid rgba(255,255,255,0.12)', borderRadius: 7,
            padding: '5px 10px', cursor: thinking ? 'not-allowed' : 'pointer',
            fontFamily: 'var(--mono)', fontSize: 10, letterSpacing: '0.08em',
            color: thinking ? 'rgba(255,255,255,0.2)' : 'rgba(255,255,255,0.55)', flexShrink: 0,
            transition: 'all 0.15s',
          }}
          onMouseEnter={e => { if (!thinking) { e.currentTarget.style.background = 'rgba(255,255,255,0.14)'; e.currentTarget.style.color = 'rgba(255,255,255,0.85)'; } }}
          onMouseLeave={e => { e.currentTarget.style.background = 'rgba(255,255,255,0.08)'; e.currentTarget.style.color = ''; }}
        >
          NEW
        </button>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: isMobile ? '5px 10px' : '6px 12px', borderRadius: 20, background: 'rgba(255,255,255,0.08)', border: '1px solid rgba(255,255,255,0.12)', flexShrink: 0 }}>
          <span className="wd-dot" style={{ width: 5, height: 5, background: '#10b981' }} />
          {!isMobile && <span style={{ fontFamily: 'var(--inter)', fontSize: 11, fontWeight: 500, color: 'rgba(255,255,255,0.6)', letterSpacing: '0.01em' }}>Online</span>}
        </div>
      </div>

      {/* Messages */}
      <div style={{ flex: 1, overflowY: 'auto', padding: isMobile ? '16px 14px 0' : '28px 28px 0' }}>
        <div style={{ maxWidth: 780, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: isMobile ? 18 : 24 }}>

          {msgs.map((m, i) => (
            <div key={i} style={{ display: 'flex', flexDirection: 'column', alignItems: m.role === 'user' ? 'flex-end' : 'flex-start', gap: 10 }}>
              {m.role === 'user' ? (
                <div style={{
                  maxWidth: isMobile ? '84%' : '62%',
                  padding: isMobile ? '10px 14px' : '12px 18px',
                  background: '#4172f5',
                  borderRadius: '18px 18px 4px 18px',
                  fontFamily: 'var(--dmsans)', fontSize: isMobile ? 14 : 15,
                  color: '#ffffff', lineHeight: 1.5,
                  boxShadow: '0 2px 12px rgba(65,114,245,0.25)',
                }}>{m.text}</div>
              ) : (
                <div style={{ width: '100%', display: 'flex', flexDirection: 'column', gap: 12 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <DaemonMark size={16} glow={c.d} />
                    <span style={{ fontFamily: 'var(--mono)', fontSize: 10, color: c.text3, letterSpacing: '0.1em' }}>DAEMON</span>
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                    {(m.blocks || []).map((block, bi) => renderBlock(block, bi, { onConfirm: onConfirmAction, onCancel: onCancelAction }))}
                    {m.text && <Md text={m.text} c={c} />}
                  </div>
                </div>
              )}
            </div>
          ))}

          {thinking && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <DaemonMark size={16} />
              <div style={{ padding: '10px 16px', background: c.thinkingBg, border: `1px solid ${c.thinkingBorder}`, borderRadius: '18px 18px 18px 4px', display: 'flex', alignItems: 'center', gap: 8 }}>
                <Spinner />
                <span style={{ fontFamily: 'var(--mono)', fontSize: 10, color: c.text3, letterSpacing: '0.08em' }}>QUERYING DAEMON...</span>
              </div>
            </div>
          )}

          {error && (
            <BlockAlert block={{ level: 'danger', content: error }} />
          )}

          <div ref={bottomRef} style={{ height: 4 }} />
        </div>
      </div>

      {/* Suggestions */}
      {suggestions.length > 0 && (
        <div style={{ padding: isMobile ? '12px 14px 4px' : '16px 28px 4px', maxWidth: 780 + 56, margin: '0 auto', width: '100%' }}>
          <div style={{ display: 'flex', flexDirection: isMobile ? 'column' : (isLong ? 'column' : 'row'), flexWrap: isLong ? undefined : 'wrap', gap: 6 }}>
            {suggestions.map(s => (
              <button key={s} className="wd-chip" onClick={() => send(s)} disabled={thinking} style={{ opacity: thinking ? 0.5 : 1, fontSize: isMobile ? 12 : undefined, textAlign: 'left' }}>
                {s}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Input */}
      <div style={{ padding: isMobile ? '10px 14px 16px' : '12px 28px 20px', flexShrink: 0 }}>
        <div style={{ maxWidth: 780, margin: '0 auto' }}>
          <form onSubmit={e => { e.preventDefault(); send(input); }} style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <input
              ref={inputRef}
              className="wd-input"
              placeholder={isMobile ? 'Message your Daemon...' : 'Message your Daemon — Enter to send, Shift+Enter for new line'}
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(input); } }}
              disabled={thinking}
              style={{ flex: 1, borderRadius: 24, padding: isMobile ? '11px 16px' : '13px 20px', height: isMobile ? 46 : 50, fontSize: isMobile ? 14 : 15 }}
            />
            <button type="submit" disabled={!input.trim() || thinking} style={{
              width: isMobile ? 44 : 50, height: isMobile ? 44 : 50, borderRadius: 14,
              background: input.trim() && !thinking ? '#4172f5' : c.d ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.04)',
              border: 'none', color: input.trim() && !thinking ? '#fff' : c.text3,
              fontSize: isMobile ? 18 : 20, cursor: input.trim() && !thinking ? 'pointer' : 'not-allowed',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              transition: 'all 0.15s', flexShrink: 0,
              boxShadow: input.trim() && !thinking ? '0 4px 16px rgba(65,114,245,0.28)' : 'none',
            }}>↑</button>
          </form>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// DAEMON PAGE
// ─────────────────────────────────────────────────────────────────────────────

function DaemonPage({ onMenu, onChatChange }) {
  const c = useC();
  const { isMobile } = useViewport();
  const { profile, loading, token } = useAuth();

  // Pre-populate from onboarding profile
  const profilePreset = profile?.industry
    ? CONTEXT_PRESETS.find(p => p.id === profile.industry) ?? CONTEXT_PRESETS[0]
    : CONTEXT_PRESETS[0];
  const profileRole = profile?.role
    ? profilePreset.roles.find(r => r.id === profile.role) ?? profilePreset.roles[0]
    : profilePreset.roles[0];
  const profileCompany = profile?.workspaces?.name ?? '';

  const [selectedPreset, setSelectedPreset] = useState(profilePreset);
  const [selectedRole, setSelectedRole]     = useState(profileRole);
  const [company, setCompany]               = useState(profileCompany);

  // Skip picker for onboarded users OR anyone in a workspace (invited members).
  // `launched` is only the guest path (someone with no profile picks a context).
  const hasProfile = !!(profile?.onboarded || profile?.workspace_id || profile?.workspaces?.id);
  const [launched, setLaunched]             = useState(false);
  const showChat = hasProfile || launched; // derived → no async flash / one-frame gap

  useEffect(() => { onChatChange?.(showChat); }, [showChat]);

  // While auth/profile is still resolving, show nothing (not the context picker).
  // Also gate on token&&!profile: covers the gap where onAuthStateChange fires SIGNED_IN
  // after init() already cleared loading, leaving profile null for a frame.
  if (loading || (token && !profile)) {
    return <div style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', background: c.bg }}><Spinner size={20} /></div>;
  }

  if (showChat) {
    const chatContext = {
      name: profile?.name || null,
      title: profile?.title || profile?.role || selectedRole?.label || null,
      company: profile?.workspaces?.name || company || null,
      industry: profile?.workspaces?.industry || selectedPreset?.id || null,
      size: profile?.workspaces?.size || null,
      permissionLevel: profile?.permission_level ?? 2,
      roleLabel: profile?.title || profile?.role || selectedRole?.label || 'Daemon',
    };
    return (
      <div style={{ height: '100%', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        <ChatView
          context={chatContext}
          onBack={hasProfile ? null : () => setLaunched(false)}
          onMenu={onMenu}
        />
      </div>
    );
  }

  return (
    <div style={{ padding: isMobile ? '20px 16px' : '32px', overflowY: 'auto', height: '100%', background: c.bg, transition: 'background 0.2s' }}>
      <div style={{ maxWidth: 640, margin: '0 auto', textAlign: 'center' }}>
        <p className="wd-label-blue" style={{ marginBottom: 10 }}>MY DAEMON</p>
        <h1 style={{ fontFamily: 'var(--inter)', fontSize: isMobile ? 22 : 28, fontWeight: 600, color: c.text, letterSpacing: '-0.04em', marginBottom: 6 }}>Choose your context.</h1>
        <p style={{ fontFamily: 'var(--inter)', fontSize: isMobile ? 14 : 15, color: c.text3, marginBottom: isMobile ? 24 : 32, lineHeight: 1.6 }}>
          Your Daemon loads full context for your role. Pick an industry and role to begin.
        </p>

        {/* Company name */}
        <div style={{ marginBottom: 20, textAlign: 'left' }}>
          <label className="wd-label" style={{ display: 'block', marginBottom: 8 }}>Company Name <span style={{ color: c.text4, fontWeight: 400 }}>(optional)</span></label>
          <input
            className="wd-input"
            placeholder="e.g. Acme Corp"
            value={company}
            onChange={e => setCompany(e.target.value)}
            style={{ maxWidth: 320 }}
          />
        </div>

        {/* Industry tabs */}
        <div style={{ marginBottom: 12, textAlign: 'left' }}>
          <label className="wd-label" style={{ display: 'block', marginBottom: 8 }}>Industry</label>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {CONTEXT_PRESETS.map(p => (
              <button key={p.id} type="button" onClick={() => { setSelectedPreset(p); setSelectedRole(p.roles[0]); }}
                style={{ padding: isMobile ? '7px 14px' : '8px 18px', background: selectedPreset.id === p.id ? (c.d ? 'rgba(255,255,255,0.09)' : 'rgba(0,0,0,0.06)') : c.subtle, border: `1px solid ${selectedPreset.id === p.id ? c.rowBorder : c.subtleBorder}`, borderRadius: 8, fontFamily: 'var(--dmsans)', fontSize: isMobile ? 12 : 13, color: selectedPreset.id === p.id ? c.text : c.text3, cursor: 'pointer', fontWeight: selectedPreset.id === p.id ? 500 : 400, transition: 'all 0.15s' }}
              >{p.name}</button>
            ))}
          </div>
        </div>

        {/* Role grid */}
        <div style={{ marginBottom: 8, textAlign: 'left' }}>
          <label className="wd-label" style={{ display: 'block', marginBottom: 8 }}>Role</label>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 28 }}>
          {selectedPreset.roles.map(r => (
            <button key={r.id} type="button" onClick={() => setSelectedRole(r)}
              style={{ padding: isMobile ? '12px 14px' : '14px 16px', background: selectedRole.id === r.id ? (c.d ? 'rgba(255,255,255,0.09)' : 'rgba(0,0,0,0.06)') : c.subtle, border: `1px solid ${selectedRole.id === r.id ? c.rowBorder : c.subtleBorder}`, borderRadius: 10, textAlign: 'left', cursor: 'pointer', transition: 'all 0.15s', outline: 'none' }}
              onMouseEnter={e => { if (selectedRole.id !== r.id) { e.currentTarget.style.background = c.d ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.04)'; e.currentTarget.style.borderColor = c.rowBorder; } }}
              onMouseLeave={e => { if (selectedRole.id !== r.id) { e.currentTarget.style.background = c.subtle; e.currentTarget.style.borderColor = c.subtleBorder; } }}
            >
              <div style={{ fontFamily: 'var(--dmsans)', fontSize: isMobile ? 13 : 14, fontWeight: 500, color: selectedRole.id === r.id ? c.text : c.text2, marginBottom: 3 }}>{r.label}</div>
              <div style={{ fontFamily: 'var(--dmsans)', fontSize: isMobile ? 11 : 12, color: selectedRole.id === r.id ? c.text3 : c.text4 }}>{r.sub}</div>
            </button>
          ))}
        </div>

        <button className="wd-btn" onClick={() => setLaunched(true)} style={{ width: '100%' }}>
          LAUNCH {selectedRole.label.toUpperCase()} DAEMON  →
        </button>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// COMPANY BRAIN
// ─────────────────────────────────────────────────────────────────────────────

const BRAIN_FIELDS = [
  {
    section: 'ABOUT',
    fields: [
      { key: 'description', label: 'What does your company do?', placeholder: 'One or two sentences — what you build, who you serve.', multiline: true, rows: 3 },
      { key: 'stage',       label: 'Stage', placeholder: 'e.g. Pre-seed · Seed · Series A · Series B · Bootstrapped', multiline: false },
    ],
  },
  {
    section: 'NUMBERS',
    fields: [
      { key: 'revenue',   label: 'Revenue', placeholder: 'e.g. $45k MRR · $540k ARR · Pre-revenue', multiline: false },
      { key: 'headcount', label: 'Headcount', placeholder: 'e.g. 12 FTEs + 3 contractors', multiline: false },
    ],
  },
  {
    section: 'CURRENT FOCUS',
    fields: [
      { key: 'priorities', label: 'Top priorities this quarter', placeholder: 'What are the 2–3 things that must happen this quarter?', multiline: true, rows: 3 },
      { key: 'projects',   label: 'Active projects', placeholder: "What's being built or shipped right now?", multiline: true, rows: 3 },
    ],
  },
  {
    section: 'MARKET',
    fields: [
      { key: 'customers',   label: 'Customers / ICP', placeholder: 'Who buys from you? Any notable names or segments?', multiline: true, rows: 2 },
      { key: 'competitors', label: 'Competitors', placeholder: 'e.g. Notion, Linear, Asana — and how you differ', multiline: false },
    ],
  },
  {
    section: 'METRICS & NOTES',
    fields: [
      { key: 'metrics', label: 'Key metrics you track', placeholder: 'e.g. NPS 62 · Churn 2.1% · CAC $320 · LTV $4,200', multiline: false },
      { key: 'notes',   label: 'Anything else the Daemon should know', placeholder: 'Open field — context, history, strategic bets, anything.', multiline: true, rows: 3 },
    ],
  },
];

function CompanyContextForm({ token, c, isMobile }) {
  const [ctx, setCtx]       = useState({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving]   = useState(false);
  const [saved, setSaved]     = useState(false);
  const [err, setErr]         = useState('');

  useEffect(() => {
    if (!token) return;
    fetch('/api/brain', { headers: { Authorization: `Bearer ${token}` } })
      .then(r => r.json())
      .then(d => { setCtx(d.context || {}); })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [token]);

  const set = (key, val) => { setCtx(prev => ({ ...prev, [key]: val })); setSaved(false); };

  const save = async () => {
    setSaving(true); setErr(''); setSaved(false);
    try {
      const r = await fetch('/api/brain', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ context: ctx }),
      });
      const d = await r.json();
      if (!r.ok) { setErr(d.error || 'Save failed'); return; }
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } catch { setErr('Network error'); }
    setSaving(false);
  };

  const inputSt = (multiline) => ({
    width: '100%', boxSizing: 'border-box',
    padding: multiline ? '10px 12px' : '9px 12px',
    background: c.inputBg, border: `1px solid ${c.inputBorder}`,
    borderRadius: 7, color: c.text, fontSize: 13,
    fontFamily: 'var(--dmsans)', outline: 'none',
    resize: multiline ? 'vertical' : 'none',
    lineHeight: 1.5,
  });

  if (loading) return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {Array.from({ length: 5 }).map((_, i) => <SkeletonRow key={i} height={56} />)}
    </div>
  );

  const filled = Object.values(ctx).filter(v => v && String(v).trim()).length;

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 20, padding: '12px 16px', borderRadius: 10, background: filled > 0 ? 'rgba(16,185,129,0.05)' : 'rgba(65,114,245,0.05)', border: `1px solid ${filled > 0 ? 'rgba(16,185,129,0.2)' : 'rgba(65,114,245,0.15)'}` }}>
        <span style={{ fontSize: 16 }}>{filled > 0 ? '◈' : '○'}</span>
        <div style={{ flex: 1 }}>
          <div style={{ fontFamily: 'var(--dmsans)', fontSize: 13, fontWeight: 600, color: c.text }}>
            {filled > 0 ? `${filled} field${filled !== 1 ? 's' : ''} saved — Daemon is using this context` : 'Daemon has no company context yet'}
          </div>
          <div style={{ fontFamily: 'var(--mono)', fontSize: 10, color: c.text3, marginTop: 2, letterSpacing: '0.04em' }}>
            {filled > 0 ? 'Every chat session uses these facts automatically' : 'Fill in the fields below to unlock real answers'}
          </div>
        </div>
      </div>

      {BRAIN_FIELDS.map(({ section, fields }) => (
        <div key={section} style={{ marginBottom: 28 }}>
          <div style={{ fontFamily: 'var(--mono)', fontSize: 9, letterSpacing: '0.14em', color: c.text3, marginBottom: 14, paddingBottom: 6, borderBottom: `1px solid ${c.cardBorder}` }}>{section}</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            {fields.map(({ key, label, placeholder, multiline, rows }) => (
              <div key={key}>
                <label style={{ fontFamily: 'var(--dmsans)', fontSize: 11, fontWeight: 600, color: c.text2, display: 'block', marginBottom: 5 }}>{label}</label>
                {multiline ? (
                  <textarea
                    value={ctx[key] || ''} onChange={e => set(key, e.target.value)}
                    placeholder={placeholder} rows={rows}
                    style={inputSt(true)}
                  />
                ) : (
                  <input
                    type="text" value={ctx[key] || ''} onChange={e => set(key, e.target.value)}
                    placeholder={placeholder}
                    style={inputSt(false)}
                  />
                )}
              </div>
            ))}
          </div>
        </div>
      ))}

      {err && <p style={{ fontFamily: 'var(--dmsans)', fontSize: 12, color: '#ef4444', marginBottom: 10 }}>{err}</p>}

      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <button
          type="button" onClick={save} disabled={saving}
          style={{ padding: '10px 24px', borderRadius: 8, border: 'none', cursor: saving ? 'wait' : 'pointer', background: saving ? 'rgba(65,114,245,0.5)' : '#4172f5', fontFamily: 'var(--dmsans)', fontSize: 13, fontWeight: 600, color: '#fff', transition: 'all 0.15s' }}
        >
          {saving ? 'Saving…' : 'Save to Brain'}
        </button>
        {saved && (
          <span style={{ fontFamily: 'var(--mono)', fontSize: 11, color: '#10b981', letterSpacing: '0.06em' }}>✓ SAVED</span>
        )}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// BRAIN — HUNT FINDINGS TAB
// ─────────────────────────────────────────────────────────────────────────────

const HUNT_MODES = [
  { key: 'threat',      label: 'THREAT HUNT',      icon: '◈', color: '#ef4444', desc: 'Churn, cash flow, legal, staff risk' },
  { key: 'waste',       label: 'WASTE HUNT',        icon: '⊗', color: '#f59e0b', desc: 'Redundancies, inefficiencies, unused tools' },
  { key: 'opportunity', label: 'OPPORTUNITY HUNT',  icon: '◇', color: '#10b981', desc: 'Upsells, partnerships, underutilised talent' },
  { key: 'performance', label: 'PERFORMANCE HUNT',  icon: '▣', color: '#4172f5', desc: 'Team performance, burnout, overload signals' },
  { key: 'knowledge',   label: 'KNOWLEDGE HUNT',    icon: '○', color: '#8b5cf6', desc: 'Knowledge gaps, missing documentation' },
];

const SEVERITY_STYLE = {
  critical: { bg: 'rgba(239,68,68,0.08)',  border: 'rgba(239,68,68,0.25)',  color: '#ef4444', leftBorder: '#ef4444' },
  warning:  { bg: 'rgba(245,158,11,0.07)', border: 'rgba(245,158,11,0.22)', color: '#f59e0b', leftBorder: '#f59e0b' },
  info:     { bg: 'rgba(65,114,245,0.06)', border: 'rgba(65,114,245,0.18)', color: '#4172f5', leftBorder: '#4172f5' },
};

function HuntFindingCard({ finding, onResolve, c }) {
  const sev = SEVERITY_STYLE[finding.severity] || SEVERITY_STYLE.info;
  const mode = HUNT_MODES.find(m => m.key === finding.hunt_mode);
  const [resolving, setResolving] = useState(false);

  const handleResolve = async () => {
    setResolving(true);
    await onResolve(finding.id);
    setResolving(false);
  };

  return (
    <div style={{
      padding: '14px 16px',
      background: sev.bg, border: `1px solid ${sev.border}`,
      borderLeft: `3px solid ${sev.leftBorder}`,
      borderRadius: '0 10px 10px 0',
      display: 'flex', gap: 12, alignItems: 'flex-start',
    }}>
      <div style={{ flexShrink: 0, marginTop: 2 }}>
        <span style={{ fontFamily: 'var(--mono)', fontSize: 14, color: mode?.color || sev.color }}>{mode?.icon || '◈'}</span>
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 5, flexWrap: 'wrap' }}>
          <span style={{ fontFamily: 'var(--mono)', fontSize: 9, letterSpacing: '0.1em', color: mode?.color || sev.color, background: `${mode?.color || sev.color}15`, border: `1px solid ${mode?.color || sev.color}30`, borderRadius: 4, padding: '2px 7px' }}>
            {mode?.label || finding.hunt_mode.toUpperCase()}
          </span>
          <span style={{ fontFamily: 'var(--mono)', fontSize: 9, letterSpacing: '0.1em', color: sev.color, background: `${sev.color}10`, border: `1px solid ${sev.border}`, borderRadius: 4, padding: '2px 7px' }}>
            {finding.severity.toUpperCase()}
          </span>
          <span style={{ fontFamily: 'var(--mono)', fontSize: 9, color: c.text4, letterSpacing: '0.05em' }}>
            {finding.occurrences}× detected
          </span>
        </div>
        <div style={{ fontFamily: 'var(--dmsans)', fontSize: 13, color: c.text, fontWeight: 500, lineHeight: 1.4, marginBottom: finding.recommendation ? 8 : 0 }}>
          {finding.pattern}
        </div>
        {finding.recommendation && (
          <div style={{ fontFamily: 'var(--dmsans)', fontSize: 12, color: c.text3, lineHeight: 1.55, marginBottom: 8 }}>
            → {finding.recommendation}
          </div>
        )}
        {finding.affected_roles?.length > 0 && (
          <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>
            {finding.affected_roles.map(r => (
              <span key={r} style={{ fontFamily: 'var(--mono)', fontSize: 9, color: c.text4, background: c.subtle, border: `1px solid ${c.subtleBorder}`, borderRadius: 4, padding: '2px 7px', letterSpacing: '0.05em' }}>{r}</span>
            ))}
          </div>
        )}
      </div>
      <button
        type="button" onClick={handleResolve} disabled={resolving}
        title="Mark as resolved"
        style={{
          flexShrink: 0, padding: '5px 10px', borderRadius: 6,
          background: 'none', border: `1px solid ${c.subtleBorder}`,
          fontFamily: 'var(--mono)', fontSize: 9, letterSpacing: '0.08em',
          color: c.text4, cursor: resolving ? 'wait' : 'pointer', transition: 'all 0.15s',
        }}
        onMouseEnter={e => { e.currentTarget.style.borderColor = '#10b981'; e.currentTarget.style.color = '#10b981'; }}
        onMouseLeave={e => { e.currentTarget.style.borderColor = ''; e.currentTarget.style.color = ''; }}
      >{resolving ? '…' : '✓ RESOLVE'}</button>
    </div>
  );
}

function HuntTab({ token, c, isMobile }) {
  const [data, setData]       = useState(null);
  const [loading, setLoading] = useState(true);
  const [scanning, setScanning] = useState(false);
  const [findings, setFindings] = useState([]);

  const load = async () => {
    if (!token) return;
    setLoading(true);
    try {
      const r = await fetch('/api/brain?tab=hunt', { headers: { Authorization: `Bearer ${token}` } });
      const d = await r.json();
      setData(d);
      setFindings(d.findings || []);
    } catch {}
    setLoading(false);
  };

  useEffect(() => { load(); }, [token]);

  const runScan = async () => {
    setScanning(true);
    try {
      await fetch('/api/brain', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ action: 'hunt_scan' }),
      });
      await load();
    } catch {}
    setScanning(false);
  };

  const resolveFind = async (id) => {
    await fetch('/api/brain', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ action: 'resolve_finding', id }),
    });
    setFindings(prev => prev.filter(f => f.id !== id));
  };

  const modeCount = data?.mode_counts || {};
  const stats     = data?.stats || {};

  if (loading) return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {Array.from({ length: 3 }).map((_, i) => <SkeletonRow key={i} height={100} />)}
    </div>
  );

  return (
    <div>
      {/* Hunt mode status grid */}
      <div style={{ display: 'grid', gridTemplateColumns: isMobile ? 'repeat(2,1fr)' : 'repeat(5,1fr)', gap: 8, marginBottom: 24 }}>
        {HUNT_MODES.map(m => {
          const count = modeCount[m.key] || 0;
          return (
            <div key={m.key} style={{
              padding: '12px 14px', borderRadius: 10,
              background: count > 0 ? `${m.color}0d` : c.subtle,
              border: `1px solid ${count > 0 ? m.color + '30' : c.subtleBorder}`,
            }}>
              <div style={{ fontFamily: 'var(--mono)', fontSize: 16, color: count > 0 ? m.color : c.text4, marginBottom: 5 }}>{m.icon}</div>
              <div style={{ fontFamily: 'var(--mono)', fontSize: 8, letterSpacing: '0.1em', color: count > 0 ? m.color : c.text4, marginBottom: 3 }}>{m.label}</div>
              <div style={{ fontFamily: 'var(--orbitron)', fontSize: 18, fontWeight: 700, color: count > 0 ? m.color : c.text4 }}>{count}</div>
              <div style={{ fontFamily: 'var(--dmsans)', fontSize: 10, color: c.text4, marginTop: 2 }}>{count === 1 ? 'finding' : 'findings'}</div>
            </div>
          );
        })}
      </div>

      {/* Stats row */}
      <div style={{ display: 'flex', gap: 10, marginBottom: 20, flexWrap: 'wrap' }}>
        {[
          { label: 'INTERACTIONS (30D)', value: stats.total_30d || 0 },
          { label: 'THIS WEEK',          value: stats.total_7d  || 0 },
          { label: 'ACTIVE USERS',       value: stats.unique_users || 0 },
          { label: 'ROLES ENGAGED',      value: stats.unique_roles || 0 },
        ].map(s => (
          <div key={s.label} style={{ padding: '10px 14px', background: c.stat, border: `1px solid ${c.statBorder}`, borderRadius: 9 }}>
            <div style={{ fontFamily: 'var(--mono)', fontSize: 9, color: c.text3, letterSpacing: '0.1em', marginBottom: 4 }}>{s.label}</div>
            <div style={{ fontFamily: 'var(--orbitron)', fontSize: 18, fontWeight: 700, color: c.text }}>{s.value}</div>
          </div>
        ))}
      </div>

      {/* Scan button */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 20 }}>
        <button
          type="button" onClick={runScan} disabled={scanning}
          style={{
            padding: '9px 18px', borderRadius: 8, border: 'none', cursor: scanning ? 'wait' : 'pointer',
            background: scanning ? 'rgba(65,114,245,0.4)' : '#4172f5',
            fontFamily: 'var(--dmsans)', fontSize: 12, fontWeight: 600, color: '#fff',
          }}
        >{scanning ? 'Scanning…' : '⟳ Run Hunt Scan'}</button>
        <span style={{ fontFamily: 'var(--dmsans)', fontSize: 12, color: c.text4 }}>
          Scans last 30 days of interactions for patterns across all 5 hunt modes
        </span>
      </div>

      {/* Findings list */}
      {findings.length === 0 ? (
        <EmptyState icon="◇" title="No active findings" subtitle="Run a hunt scan to detect threats, waste, opportunities, performance issues, and knowledge gaps across your team's interactions." />
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {findings.map(f => (
            <HuntFindingCard key={f.id} finding={f} onResolve={resolveFind} c={c} />
          ))}
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// BRAIN — TEAM AGENTS TAB
// ─────────────────────────────────────────────────────────────────────────────

const ACCESS_LEVELS = ['junior', 'manager', 'director', 'executive'];
const ACCESS_TOOLS = {
  junior:    ['Slack', 'Notion', 'Google Drive'],
  manager:   ['Slack', 'Notion', 'Google Drive', 'CRM', 'Project Tools'],
  director:  ['Slack', 'Notion', 'Google Drive', 'CRM', 'Finance', 'HR System'],
  executive: ['All Tools — Full Company Access'],
};
const ACCESS_COLOR = { junior: '#8b5cf6', manager: '#4172f5', director: '#f59e0b', executive: '#10b981' };

function AgentProfileCard({ agent, token, onUpdated, c }) {
  const [editing, setEditing]   = useState(false);
  const [level, setLevel]       = useState(agent.access_level);
  const [saving, setSaving]     = useState(false);

  const save = async () => {
    setSaving(true);
    try {
      await fetch('/api/brain', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ action: 'update_agent', target_user_id: agent.user_id, access_level: level }),
      });
      onUpdated();
      setEditing(false);
    } catch {}
    setSaving(false);
  };

  const ac = ACCESS_COLOR[agent.access_level] || '#4172f5';
  const trustPct = Math.round((agent.trust_score || 1) * 100);

  return (
    <div style={{ padding: '14px 18px', background: c.subtle, border: `1px solid ${c.subtleBorder}`, borderRadius: 10 }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
        <div style={{ width: 38, height: 38, borderRadius: '50%', background: ac, display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'var(--orbitron)', fontSize: 12, fontWeight: 700, color: '#fff', flexShrink: 0 }}>
          {(agent.name || '?').charAt(0)}
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 3, flexWrap: 'wrap' }}>
            <span style={{ fontFamily: 'var(--dmsans)', fontSize: 14, fontWeight: 600, color: c.text }}>{agent.name}</span>
            {agent.workspace_role === 'admin' && (
              <span style={{ fontFamily: 'var(--mono)', fontSize: 9, color: '#f59e0b', background: 'rgba(245,158,11,0.1)', border: '1px solid rgba(245,158,11,0.25)', borderRadius: 4, padding: '2px 6px', letterSpacing: '0.08em' }}>ADMIN</span>
            )}
          </div>
          {agent.title && <div style={{ fontFamily: 'var(--dmsans)', fontSize: 12, color: c.text3, marginBottom: 6 }}>{agent.title}</div>}

          {!editing ? (
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
              <span style={{ fontFamily: 'var(--mono)', fontSize: 9, letterSpacing: '0.1em', color: ac, background: `${ac}15`, border: `1px solid ${ac}30`, borderRadius: 5, padding: '3px 8px' }}>
                {agent.access_level.toUpperCase()}
              </span>
              <span style={{ fontFamily: 'var(--dmsans)', fontSize: 11, color: c.text4 }}>
                {agent.interaction_count} interactions · trust {trustPct}%
              </span>
            </div>
          ) : (
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 4 }}>
              {ACCESS_LEVELS.map(l => (
                <button key={l} type="button" onClick={() => setLevel(l)}
                  style={{
                    padding: '5px 12px', borderRadius: 6, cursor: 'pointer', transition: 'all 0.12s',
                    background: level === l ? `${ACCESS_COLOR[l]}18` : c.subtle,
                    border: `1px solid ${level === l ? ACCESS_COLOR[l] + '50' : c.subtleBorder}`,
                    fontFamily: 'var(--dmsans)', fontSize: 11, fontWeight: level === l ? 600 : 400,
                    color: level === l ? ACCESS_COLOR[l] : c.text3,
                  }}>
                  {l}
                  <div style={{ fontSize: 9, color: c.text4, marginTop: 1 }}>{(ACCESS_TOOLS[l] || []).slice(0, 2).join(', ')}{ACCESS_TOOLS[l]?.length > 2 ? '…' : ''}</div>
                </button>
              ))}
            </div>
          )}
        </div>
        <div style={{ flexShrink: 0 }}>
          {!editing ? (
            <button type="button" onClick={() => setEditing(true)}
              style={{ padding: '5px 12px', borderRadius: 6, background: 'none', border: `1px solid ${c.subtleBorder}`, fontFamily: 'var(--dmsans)', fontSize: 11, color: c.text3, cursor: 'pointer' }}>
              Edit
            </button>
          ) : (
            <div style={{ display: 'flex', gap: 6 }}>
              <button type="button" onClick={save} disabled={saving}
                style={{ padding: '5px 12px', borderRadius: 6, background: '#4172f5', border: 'none', fontFamily: 'var(--dmsans)', fontSize: 11, fontWeight: 600, color: '#fff', cursor: saving ? 'wait' : 'pointer' }}>
                {saving ? '…' : 'Save'}
              </button>
              <button type="button" onClick={() => { setEditing(false); setLevel(agent.access_level); }}
                style={{ padding: '5px 10px', borderRadius: 6, background: 'none', border: `1px solid ${c.subtleBorder}`, fontFamily: 'var(--dmsans)', fontSize: 11, color: c.text3, cursor: 'pointer' }}>
                ×
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function AgentsTab({ token, c, isMobile }) {
  const [agents, setAgents]   = useState([]);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    if (!token) return;
    setLoading(true);
    try {
      const r = await fetch('/api/brain?tab=agents', { headers: { Authorization: `Bearer ${token}` } });
      const d = await r.json();
      setAgents(d.agents || []);
    } catch {}
    setLoading(false);
  };

  useEffect(() => { load(); }, [token]);

  if (loading) return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {Array.from({ length: 4 }).map((_, i) => <SkeletonRow key={i} height={80} />)}
    </div>
  );

  return (
    <div>
      <div style={{ padding: '12px 16px', borderRadius: 9, background: 'rgba(65,114,245,0.05)', border: '1px solid rgba(65,114,245,0.15)', marginBottom: 20 }}>
        <p style={{ fontFamily: 'var(--dmsans)', fontSize: 12, color: c.text2, lineHeight: 1.6, margin: 0 }}>
          <strong style={{ color: '#4172f5' }}>Access levels</strong> control what tools and data each Daemon agent can see.
          {' '}<strong>Junior</strong> — Slack, Notion, Google Drive.
          {' '}<strong>Manager</strong> — + CRM & project tools.
          {' '}<strong>Director</strong> — + Finance & HR.
          {' '}<strong>Executive</strong> — full company access.
        </p>
      </div>

      {agents.length === 0 ? (
        <EmptyState icon="◎" title="No agents yet" subtitle="As team members start using their Daemon, their agent profiles will appear here." />
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {agents.map(a => (
            <AgentProfileCard key={a.user_id} agent={a} token={token} onUpdated={load} c={c} />
          ))}
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// BRAIN — INTEGRATIONS TAB
// ─────────────────────────────────────────────────────────────────────────────

const TOOL_CATALOG = [
  { name: 'Notion',          icon: 'N',  category: 'Knowledge',     color: '#191919', hunt: ['knowledge','waste'] },
  { name: 'Slack',           icon: 'S',  category: 'Communication', color: '#4a154b', hunt: ['threat','performance','knowledge'] },
  { name: 'Google Drive',    icon: 'G',  category: 'Knowledge',     color: '#4172f5', hunt: ['knowledge'] },
  { name: 'Gmail',           icon: 'M',  category: 'Communication', color: '#ea4335', hunt: ['threat','opportunity'] },
  { name: 'Google Calendar', icon: 'C',  category: 'Scheduling',    color: '#1a73e8', hunt: ['performance','waste'] },
  { name: 'HubSpot',         icon: 'H',  category: 'CRM',           color: '#ff7a59', hunt: ['threat','opportunity'] },
  { name: 'Salesforce',      icon: 'SF', category: 'CRM',           color: '#00a1e0', hunt: ['threat','opportunity'] },
  { name: 'Jira',            icon: 'J',  category: 'Project Tools', color: '#0052cc', hunt: ['performance','waste'] },
  { name: 'Linear',          icon: 'L',  category: 'Project Tools', color: '#5e6ad2', hunt: ['performance','waste'] },
  { name: 'QuickBooks',      icon: 'QB', category: 'Finance',       color: '#2ca01c', hunt: ['threat','waste'] },
  { name: 'BambooHR',        icon: 'B',  category: 'HR',            color: '#78b943', hunt: ['threat','performance'] },
  { name: 'GitHub',          icon: 'GH', category: 'Engineering',   color: '#24292e', hunt: ['performance','waste'] },
];

function IntegrationsTab({ c, isMobile }) {
  const categories = [...new Set(TOOL_CATALOG.map(t => t.category))];

  return (
    <div>
      <div style={{ padding: '12px 16px', borderRadius: 9, background: 'rgba(245,158,11,0.05)', border: '1px solid rgba(245,158,11,0.2)', marginBottom: 20 }}>
        <p style={{ fontFamily: 'var(--dmsans)', fontSize: 12, color: c.text2, lineHeight: 1.6, margin: 0 }}>
          <strong style={{ color: '#f59e0b' }}>Tool connections</strong> are the Brain's live feed. Each connected tool streams real-time data into the hunt engine — enabling threat detection, waste identification, and opportunity surfacing. Full integration support coming in v2.
        </p>
      </div>

      {categories.map(cat => (
        <div key={cat} style={{ marginBottom: 24 }}>
          <div style={{ fontFamily: 'var(--mono)', fontSize: 9, letterSpacing: '0.14em', color: c.text3, marginBottom: 10, paddingBottom: 6, borderBottom: `1px solid ${c.cardBorder}` }}>{cat.toUpperCase()}</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
            {TOOL_CATALOG.filter(t => t.category === cat).map(tool => (
              <div key={tool.name} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '11px 14px', background: c.subtle, border: `1px solid ${c.subtleBorder}`, borderRadius: 9 }}>
                <div style={{ width: 32, height: 32, borderRadius: 8, background: tool.color, display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'var(--orbitron)', fontSize: 10, fontWeight: 700, color: '#fff', flexShrink: 0 }}>{tool.icon}</div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontFamily: 'var(--dmsans)', fontSize: 13, fontWeight: 500, color: c.text, marginBottom: 3 }}>{tool.name}</div>
                  <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>
                    {tool.hunt.map(h => {
                      const mode = HUNT_MODES.find(m => m.key === h);
                      return (
                        <span key={h} style={{ fontFamily: 'var(--mono)', fontSize: 8, color: mode?.color || '#4172f5', background: `${mode?.color || '#4172f5'}12`, border: `1px solid ${mode?.color || '#4172f5'}25`, borderRadius: 3, padding: '1px 5px', letterSpacing: '0.07em' }}>
                          {mode?.icon} {h}
                        </span>
                      );
                    })}
                  </div>
                </div>
                <span style={{ fontFamily: 'var(--mono)', fontSize: 9, letterSpacing: '0.08em', color: '#4172f5', background: 'rgba(65,114,245,0.08)', border: '1px solid rgba(65,114,245,0.2)', borderRadius: 5, padding: '4px 10px', cursor: 'pointer' }}>
                  CONNECT
                </span>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// BRAIN PAGE — MAIN
// ─────────────────────────────────────────────────────────────────────────────

function BrainPage() {
  const c = useC();
  const { isMobile } = useViewport();
  const { token } = useAuth();
  const [activeTab, setActiveTab] = useState('overview');

  const TABS = [
    { key: 'overview',      label: 'OVERVIEW' },
    { key: 'patterns',      label: 'PATTERNS' },
    { key: 'integrations',  label: 'INTEGRATIONS' },
    { key: 'agents',        label: 'TEAM AGENTS' },
    { key: 'security',      label: 'SECURITY' },
  ];

  return (
    <div style={{ padding: isMobile ? '20px 16px' : '28px 32px', overflowY: 'auto', height: '100%', background: c.bg, transition: 'background 0.2s' }}>
      <div style={{ maxWidth: 860 }}>

        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 20, gap: 16, flexWrap: 'wrap' }}>
          <div>
            <p className="wd-label-blue" style={{ marginBottom: 6 }}>COMPANY BRAIN</p>
            <h1 style={{ fontFamily: 'var(--inter)', fontSize: isMobile ? 20 : 24, fontWeight: 700, color: c.text, letterSpacing: '-0.03em', marginBottom: 4 }}>
              The Living Intelligence
            </h1>
            <p style={{ fontFamily: 'var(--dmsans)', fontSize: 13, color: c.text3 }}>
              Always on · Always learning · Always hunting · Admin view
            </p>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '8px 14px', borderRadius: 20, background: 'rgba(16,185,129,0.08)', border: '1px solid rgba(16,185,129,0.2)', flexShrink: 0 }}>
            <span className="wd-dot" style={{ width: 6, height: 6, background: '#10b981', borderRadius: '50%', display: 'block' }} />
            <span style={{ fontFamily: 'var(--mono)', fontSize: 10, color: '#10b981', letterSpacing: '0.06em' }}>BRAIN ONLINE</span>
          </div>
        </div>

        {/* Tabs */}
        <div style={{ display: 'flex', gap: 4, marginBottom: 24, overflowX: 'auto', WebkitOverflowScrolling: 'touch', borderBottom: `1px solid ${c.cardBorder}`, paddingBottom: 0 }}>
          {TABS.map(t => (
            <button key={t.key} type="button" onClick={() => setActiveTab(t.key)}
              style={{
                padding: '8px 14px', background: 'none', border: 'none',
                borderBottom: `2px solid ${activeTab === t.key ? '#4172f5' : 'transparent'}`,
                fontFamily: 'var(--mono)', fontSize: isMobile ? 9 : 10, letterSpacing: '0.1em',
                color: activeTab === t.key ? '#4172f5' : c.text3,
                cursor: 'pointer', marginBottom: -1, whiteSpace: 'nowrap', transition: 'all 0.15s',
              }}>
              {t.label}
            </button>
          ))}
        </div>

        {activeTab === 'overview'     && <CompanyContextForm token={token} c={c} isMobile={isMobile} />}
        {activeTab === 'patterns'     && <HuntTab token={token} c={c} isMobile={isMobile} />}
        {activeTab === 'integrations' && <IntegrationsTab c={c} isMobile={isMobile} />}
        {activeTab === 'agents'       && <AgentsTab token={token} c={c} isMobile={isMobile} />}
        {activeTab === 'security'     && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <BlockAlert block={{ level: 'info', title: 'SECURITY ARCHITECTURE', content: 'The Brain sees everything — agents surface only what is appropriate to each user\'s role and clearance. Interaction data is used for learning — not exposed to other staff. All interactions are logged, timestamped, and auditable. Data sovereignty and compliance enforced at the Brain level. Agent access controls managed centrally.' }} />
            <div style={{ padding: '16px 18px', background: c.subtle, border: `1px solid ${c.subtleBorder}`, borderRadius: 10 }}>
              <p style={{ fontFamily: 'var(--mono)', fontSize: 10, color: c.text3, letterSpacing: '0.1em', marginBottom: 10 }}>ISOLATION MODEL</p>
              {[
                ['Company data', 'Isolated per workspace — zero crossover between companies'],
                ['User memory', 'Scoped to user_id + workspace_id — never shared'],
                ['Hunt findings', 'Workspace-scoped — only admins can view'],
                ['Agent profiles', 'Individually controlled — admin can revoke at any time'],
                ['Interaction logs', 'Per-user — used for learning, never exposed peer-to-peer'],
              ].map(([k, v]) => (
                <div key={k} style={{ display: 'flex', gap: 12, padding: '8px 0', borderBottom: `1px solid ${c.cardBorder}` }}>
                  <span style={{ fontFamily: 'var(--mono)', fontSize: 11, color: c.text2, width: 130, flexShrink: 0 }}>{k}</span>
                  <span style={{ fontFamily: 'var(--dmsans)', fontSize: 12, color: c.text3 }}>{v}</span>
                </div>
              ))}
            </div>
          </div>
        )}

      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// TASKS
// ─────────────────────────────────────────────────────────────────────────────

function TaskCard({ task }) {
  const c = useC();
  const ps = PRIORITY_STYLES[task.priority] || PRIORITY_STYLES.P2;
  return (
    <div style={{ padding: '12px 14px', background: task.blocked ? (c.d ? 'rgba(239,68,68,0.04)' : 'rgba(239,68,68,0.03)') : c.subtle, border: `1px solid ${task.blocked ? 'rgba(239,68,68,0.18)' : task.stale ? 'rgba(245,158,11,0.18)' : c.subtleBorder}`, borderRadius: 9 }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8, marginBottom: 9 }}>
        <span style={{ fontSize: 9, padding: '2px 7px', borderRadius: 5, background: ps.bg, border: `1px solid ${ps.border}`, color: ps.color, fontFamily: 'var(--mono)', letterSpacing: '0.06em', flexShrink: 0, marginTop: 2 }}>{task.priority}</span>
        <span style={{ fontFamily: 'var(--dmsans)', fontSize: 13, color: c.text2, lineHeight: 1.45 }}>{task.title}</span>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
          <span style={{ fontFamily: 'var(--mono)', fontSize: 9, color: c.text4, letterSpacing: '0.05em' }}>{task.source || task.tag} · {task.id}</span>
          {(task.blocked || task.stale) && (
            <span style={{ fontFamily: 'var(--mono)', fontSize: 9, color: task.blocked ? '#ef4444' : '#f59e0b', letterSpacing: '0.06em' }}>
              {task.blocked ? '⚠ BLOCKED' : '⏱ STALE'}
            </span>
          )}
        </div>
        {task.assignee && (
          <div title={task.assignee} style={{ width: 22, height: 22, borderRadius: '50%', background: '#4172f5', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'var(--orbitron)', fontSize: 7, fontWeight: 700, color: '#fff', flexShrink: 0 }}>
            {task.assignee.charAt(0)}
          </div>
        )}
      </div>
    </div>
  );
}

function KanbanColumn({ title, tasks }) {
  const c = useC();
  return (
    <div style={{ flex: 1, minWidth: 0 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
        <span style={{ fontFamily: 'var(--mono)', fontSize: 10, color: c.text3, letterSpacing: '0.12em' }}>{title}</span>
        <span style={{ fontFamily: 'var(--mono)', fontSize: 10, color: c.text4, background: c.subtle, border: `1px solid ${c.subtleBorder}`, borderRadius: 5, padding: '1px 7px' }}>{tasks.length}</span>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
        {tasks.map((t, i) => <TaskCard key={t.id || i} task={t} />)}
      </div>
    </div>
  );
}

function TasksPage() {
  const c = useC();
  const { isMobile } = useViewport();
  const { token } = useAuth();
  const { data, loading, error } = useBrainFetch({
    brainPath: '/api/tasks',
    legacyPath: '/api/tasks',
    adapt: (d) => {
      const cols = { todo: [], inProgress: [], review: [], done: [] };
      const bucket = { pending: 'todo', delivered: 'todo', accepted: 'inProgress',
        in_progress: 'inProgress', flagged: 'review', handed_off: 'review',
        completed: 'done', blocked: 'review' };
      for (const t of (d.tasks || [])) {
        const col = bucket[t.status] || 'todo';
        cols[col].push({ title: t.title, priority: t.priority?.toUpperCase?.() || 'P2',
          tag: t.brief ? `#${(t.brief || '').slice(0, 18)}` : undefined,
          blocked: t.status === 'blocked' || t.status === 'flagged' });
      }
      return { columns: cols, sprint: { label: 'CROSS-AGENT TASKS' } };
    },
  }, token);

  const columns = data?.columns || { todo: [], inProgress: [], review: [], done: [] };
  const total   = Object.values(columns).reduce((s, a) => s + a.length, 0);
  const done    = (columns.done || []).length;
  const pct     = total > 0 ? Math.round((done / total) * 100) : 0;
  const sprint  = data?.sprint || {};

  return (
    <div style={{ padding: isMobile ? '20px 16px' : '28px 32px', overflowY: 'auto', height: '100%', background: c.bg, transition: 'background 0.2s' }}>
      <div style={{ maxWidth: 1020, margin: '0 auto' }}>
        <div style={{ display: 'flex', alignItems: isMobile ? 'flex-start' : 'flex-end', flexDirection: isMobile ? 'column' : 'row', justifyContent: 'space-between', marginBottom: 20, gap: isMobile ? 12 : 0 }}>
          <div>
            <p className="wd-label-blue" style={{ marginBottom: 6 }}>{sprint.label || 'TASKS'}</p>
            <h1 style={{ fontFamily: 'var(--inter)', fontSize: isMobile ? 20 : 22, fontWeight: 600, color: c.text, letterSpacing: '-0.03em' }}>Task Board</h1>
          </div>
          {total > 0 && (
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <div style={{ padding: '7px 14px', background: c.stat, border: `1px solid ${c.statBorder}`, borderRadius: 9 }}>
                <span style={{ fontFamily: 'var(--mono)', fontSize: 10, color: '#f59e0b', letterSpacing: '0.08em' }}>{done}/{total} DONE · {pct}%</span>
              </div>
            </div>
          )}
        </div>

        {total > 0 && (
          <div style={{ height: 3, background: c.d ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.08)', borderRadius: 2, overflow: 'hidden', marginBottom: 28 }}>
            <div style={{ height: '100%', width: `${pct}%`, background: '#4172f5', borderRadius: 2, transition: 'width 0.6s ease' }} />
          </div>
        )}

        {loading ? (
          <div style={{ display: 'flex', gap: 16 }}>
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 8 }}>
                <SkeletonRow height={18} radius={4} />
                {Array.from({ length: 2 + i % 2 }).map((_, j) => <SkeletonRow key={j} height={72} />)}
              </div>
            ))}
          </div>
        ) : error ? (
          <BlockAlert block={{ level: 'danger', content: `Failed to load tasks: ${error}` }} />
        ) : total === 0 ? (
          <EmptyState icon="✓" title="No tasks yet" subtitle="Connect Jira or Linear to see your sprint board here." />
        ) : (
          <div style={{ display: 'flex', gap: 16, overflowX: isMobile ? 'auto' : 'visible', paddingBottom: isMobile ? 16 : 0 }}>
            {[
              { title: 'TO DO',       tasks: columns.todo || [] },
              { title: 'IN PROGRESS', tasks: columns.inProgress || [] },
              { title: 'IN REVIEW',   tasks: columns.review || [] },
              { title: 'DONE',        tasks: columns.done || [] },
            ].map(col => (
              <div key={col.title} style={{ flex: isMobile ? '0 0 260px' : 1, minWidth: isMobile ? 260 : 0 }}>
                <KanbanColumn title={col.title} tasks={col.tasks} />
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// INBOX
// ─────────────────────────────────────────────────────────────────────────────

function InboxPage() {
  const c = useC();
  const { isMobile } = useViewport();
  const { token } = useAuth();
  const { data, loading, error } = useBrainFetch({
    brainPath: '/api/pushes',
    legacyPath: '/api/inbox',
    adapt: (d) => ({
      items: (d.pushes || []).map((p) => ({
        id: p.id,
        title: { task_assignment: 'New task assigned', hunt_finding: 'Brain alert',
          pattern: 'Pattern detected', brain_insight: 'Brain insight' }[p.kind] || 'Brain',
        body: p.message || p.recommended_action || '',
        source: 'Daemon',
        level: p.kind === 'hunt_finding' ? 'warning' : undefined,
        unread: !p.read_at,
        time: p.created_at ? new Date(p.created_at).toLocaleString() : '',
        icon: 'WD',
      })),
    }),
  }, token);
  const [filter, setFilter] = useState('all');
  const navigate = useNavigate();

  // Locally-tracked reads, so the UI updates instantly without a refetch.
  const [readIds, setReadIds] = useState(() => new Set());
  const [expandedId, setExpandedId] = useState(null); // inline detail view
  const [copiedId, setCopiedId] = useState(null);     // transient "copied" state

  const markRead = useCallback((id) => {
    if (!id) return;
    setReadIds(prev => prev.has(id) ? prev : new Set(prev).add(id));
    fetch('/api/inbox', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: JSON.stringify({ id, read: true }),
    }).catch(() => {});
  }, [token]);

  const markAllRead = useCallback((ids) => {
    setReadIds(new Set(ids));
    fetch('/api/inbox', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: JSON.stringify({ all: true, read: true }),
    }).catch(() => {});
  }, [token]);

  // Hand a brain-drafted asset to the daemon composer for review/refine/post.
  const useDraft = useCallback((item) => {
    if (!item?.draft) return;
    sessionStorage.setItem(
      'wd_daemon_seed',
      `The Company Brain drafted this post for "${item.title}". Refine it, keep it on-brand, and prepare it for posting (ask me to confirm before anything goes out):\n\n${item.draft}`,
    );
    markRead(item.id);
    navigate('/app/daemon');
  }, [navigate, markRead]);

  // Toggle the inline detail view; opening also marks the item read.
  const toggleExpand = useCallback((item) => {
    setExpandedId(prev => (prev === item.id ? null : item.id));
    if (item.unread) markRead(item.id);
  }, [markRead]);

  const copyDraft = useCallback((item) => {
    if (!item?.draft) return;
    navigator.clipboard?.writeText(item.draft).then(() => {
      setCopiedId(item.id);
      setTimeout(() => setCopiedId(c => (c === item.id ? null : c)), 1600);
    }).catch(() => {});
  }, []);

  const FILTERS = [
    { key: 'all',      label: 'ALL',      fn: () => true },
    { key: 'mentions', label: 'MENTIONS', fn: i => i.source === 'Slack' },
    { key: 'alerts',   label: 'ALERTS',   fn: i => !!i.level },
    { key: 'updates',  label: 'UPDATES',  fn: i => ['Jira', 'GitHub', 'Linear'].includes(i.source) },
  ];

  const rawItems = data?.items || [];
  const items    = rawItems.map(i => ({ ...i, unread: i.unread && !readIds.has(i.id) }));
  const unread   = items.filter(i => i.unread).length;
  const visible  = items.filter(FILTERS.find(f => f.key === filter)?.fn ?? (() => true));
  const LEVEL_COLOR = { danger: '#ef4444', warning: '#f59e0b' };

  return (
    <div style={{ padding: isMobile ? '20px 16px' : '28px 32px', overflowY: 'auto', height: '100%', background: c.bg, transition: 'background 0.2s' }}>
      <div style={{ maxWidth: 680, margin: '0 auto' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
          <div>
            <p className="wd-label-blue" style={{ marginBottom: 6 }}>INBOX</p>
            <h1 style={{ fontFamily: 'var(--inter)', fontSize: isMobile ? 20 : 22, fontWeight: 600, color: c.text, letterSpacing: '-0.03em', display: 'flex', alignItems: 'center', gap: 10 }}>
              Messages
              {unread > 0 && <span style={{ fontSize: 13, fontWeight: 500, fontFamily: 'var(--mono)', color: '#4172f5', background: 'rgba(65,114,245,0.09)', border: '1px solid rgba(65,114,245,0.22)', borderRadius: 20, padding: '2px 10px', letterSpacing: '0.05em' }}>{unread} new</span>}
            </h1>
          </div>
          {unread > 0 && (
            <button type="button" onClick={() => markAllRead(items.map(i => i.id))}
              style={{ fontFamily: 'var(--mono)', fontSize: 10, letterSpacing: '0.08em', color: c.text3, background: 'none', border: `1px solid ${c.cardBorder}`, borderRadius: 8, padding: '7px 12px', cursor: 'pointer', transition: 'all 0.15s', whiteSpace: 'nowrap' }}
              onMouseEnter={e => { e.currentTarget.style.color = c.text; e.currentTarget.style.borderColor = c.text3; }}
              onMouseLeave={e => { e.currentTarget.style.color = c.text3; e.currentTarget.style.borderColor = c.cardBorder; }}>
              MARK ALL READ
            </button>
          )}
        </div>

        <div style={{ display: 'flex', gap: 2, marginBottom: 20, borderBottom: `1px solid ${c.cardBorder}` }}>
          {FILTERS.map(f => (
            <button key={f.key} type="button" onClick={() => setFilter(f.key)}
              style={{ padding: '8px 14px', background: 'none', border: 'none', borderBottom: `2px solid ${filter === f.key ? '#4172f5' : 'transparent'}`, fontFamily: 'var(--mono)', fontSize: 10, letterSpacing: '0.1em', color: filter === f.key ? '#4172f5' : c.text3, cursor: 'pointer', marginBottom: -1, transition: 'all 0.15s' }}
            >{f.label}</button>
          ))}
        </div>

        {loading ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
            {Array.from({ length: 5 }).map((_, i) => <SkeletonRow key={i} height={72} />)}
          </div>
        ) : error ? (
          <BlockAlert block={{ level: 'danger', content: `Failed to load inbox: ${error}` }} />
        ) : visible.length === 0 ? (
          <EmptyState icon="✉" title="No messages" subtitle="Connect Slack, Gmail, GitHub and Jira to see unified messages here." />
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
            {visible.map((item, idx) => {
              const lc = LEVEL_COLOR[item.level];
              const srcColor = SOURCE_COLORS[item.source] || SOURCE_COLORS.Default;
              const expanded       = expandedId === item.id;
              const roles          = item.metadata?.affected_roles || [];
              const recommendation = (item.body || '').split('\n\nDraft ready:\n')[0];
              return (
                <div key={item.id || idx} style={{
                  background: item.unread ? (lc ? c.d ? `rgba(${item.level === 'danger' ? '239,68,68' : '245,158,11'},0.05)` : `rgba(${item.level === 'danger' ? '239,68,68' : '245,158,11'},0.03)` : c.row) : c.subtle,
                  border: `1px solid ${item.unread ? (lc ? `rgba(${item.level === 'danger' ? '239,68,68' : '245,158,11'},0.2)` : c.rowBorder) : c.subtleBorder}`,
                  borderLeft: lc && item.unread ? `3px solid ${lc}` : undefined,
                  borderRadius: lc && item.unread ? '0 9px 9px 0' : 9,
                  transition: 'background 0.15s',
                }}>
                  {/* Header row — click to expand/collapse */}
                  <div onClick={() => toggleExpand(item)} style={{ display: 'flex', gap: 12, cursor: 'pointer', padding: '13px 15px' }}>
                    <div style={{ width: 30, height: 30, borderRadius: 8, background: srcColor, display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'var(--orbitron)', fontSize: 10, fontWeight: 700, color: '#fff', flexShrink: 0 }}>{item.icon || item.source?.charAt(0)}</div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                        <span style={{ fontFamily: 'var(--dmsans)', fontSize: 14, fontWeight: item.unread ? 500 : 400, color: item.unread ? c.text : c.text2 }}>{item.title}</span>
                        {item.unread && <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#4172f5', flexShrink: 0 }} />}
                      </div>
                      {!expanded && (
                        <div style={{ fontFamily: 'var(--dmsans)', fontSize: 13, color: c.text3, lineHeight: 1.4, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{recommendation}</div>
                      )}
                      <div style={{ marginTop: 5, display: 'flex', alignItems: 'center', gap: 10 }}>
                        <span style={{ fontFamily: 'var(--mono)', fontSize: 9, color: c.text4, letterSpacing: '0.07em' }}>{item.source} · {item.time}</span>
                        {item.draft && !expanded && (
                          <span style={{ fontFamily: 'var(--mono)', fontSize: 9, letterSpacing: '0.08em', color: '#4172f5', background: 'rgba(65,114,245,0.09)', border: '1px solid rgba(65,114,245,0.22)', borderRadius: 6, padding: '2px 7px' }}>✎ DRAFT</span>
                        )}
                      </div>
                    </div>
                    <span style={{ alignSelf: 'flex-start', marginTop: 2, color: c.text4, fontSize: 12, transform: expanded ? 'rotate(90deg)' : 'none', transition: 'transform 0.15s', flexShrink: 0 }}>▸</span>
                  </div>

                  {/* Inline detail panel */}
                  {expanded && (
                    <div style={{ padding: '0 15px 14px 57px', display: 'flex', flexDirection: 'column', gap: 12 }}>
                      {recommendation && (
                        <div style={{ fontFamily: 'var(--dmsans)', fontSize: 13.5, color: c.text2, lineHeight: 1.55, whiteSpace: 'pre-wrap' }}>{recommendation}</div>
                      )}
                      {roles.length > 0 && (
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center' }}>
                          <span style={{ fontFamily: 'var(--mono)', fontSize: 9, color: c.text4, letterSpacing: '0.08em' }}>ROUTED TO</span>
                          {roles.map(r => (
                            <span key={r} style={{ fontFamily: 'var(--mono)', fontSize: 9, letterSpacing: '0.06em', color: c.text3, background: c.subtle, border: `1px solid ${c.cardBorder}`, borderRadius: 5, padding: '2px 7px', textTransform: 'uppercase' }}>{r}</span>
                          ))}
                        </div>
                      )}
                      {item.draft && (
                        <div style={{ border: '1px solid rgba(65,114,245,0.22)', background: 'rgba(65,114,245,0.05)', borderRadius: 9, padding: '12px 13px' }}>
                          <div style={{ fontFamily: 'var(--mono)', fontSize: 9, letterSpacing: '0.1em', color: '#4172f5', marginBottom: 7 }}>✎ DRAFT — READY TO POST</div>
                          <div style={{ fontFamily: 'var(--dmsans)', fontSize: 13.5, color: c.text, lineHeight: 1.55, whiteSpace: 'pre-wrap' }}>{item.draft}</div>
                          <div style={{ marginTop: 11, display: 'flex', gap: 8 }}>
                            <button type="button" onClick={(e) => { e.stopPropagation(); useDraft(item); }}
                              style={{ fontFamily: 'var(--mono)', fontSize: 9, letterSpacing: '0.08em', color: '#fff', background: '#4172f5', border: 'none', borderRadius: 6, padding: '6px 11px', cursor: 'pointer' }}>
                              ✎ REFINE IN DAEMON
                            </button>
                            <button type="button" onClick={(e) => { e.stopPropagation(); copyDraft(item); }}
                              style={{ fontFamily: 'var(--mono)', fontSize: 9, letterSpacing: '0.08em', color: c.text3, background: 'none', border: `1px solid ${c.cardBorder}`, borderRadius: 6, padding: '6px 11px', cursor: 'pointer' }}>
                              {copiedId === item.id ? 'COPIED ✓' : 'COPY'}
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// OVERVIEW
// ─────────────────────────────────────────────────────────────────────────────

function OverviewPage() {
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
const PROVIDERS = [
  {
    id: 'openrouter', name: 'OpenRouter', color: '#7c3aed',
    desc: '300+ models via one key', keyLabel: 'API Key',
    placeholder: 'sk-or-v1-…',
    keyPrefix: 'sk-or-',
    staticModels: [],
  },
  {
    id: 'anthropic', name: 'Anthropic', color: '#d97706',
    desc: 'Direct Claude access', keyLabel: 'API Key',
    placeholder: 'sk-ant-api03-…',
    keyPrefix: 'sk-ant-',
    staticModels: [
      { id: 'claude-haiku-4-5', name: 'Claude Haiku 4.5', cost: 'best' },
      { id: 'claude-sonnet-4-6', name: 'Claude Sonnet 4.6', cost: 'mid' },
      { id: 'claude-opus-4-5', name: 'Claude Opus 4.5', cost: 'high' },
    ],
  },
  {
    id: 'openai', name: 'OpenAI', color: '#10b981',
    desc: 'GPT models + embeddings', keyLabel: 'API Key',
    placeholder: 'sk-proj-…',
    keyPrefix: 'sk-',
    staticModels: [
      { id: 'gpt-4o-mini', name: 'GPT-4o mini', cost: 'best' },
      { id: 'gpt-4o', name: 'GPT-4o', cost: 'mid' },
      { id: 'gpt-4.1', name: 'GPT-4.1', cost: 'mid' },
      { id: 'o4-mini', name: 'o4-mini', cost: 'mid' },
      { id: 'o3', name: 'o3', cost: 'high' },
      { id: 'text-embedding-3-small', name: 'text-embedding-3-small', cost: 'best' },
      { id: 'text-embedding-3-large', name: 'text-embedding-3-large', cost: 'mid' },
    ],
  },
  {
    id: 'google', name: 'Google Gemini', color: '#4172f5',
    desc: 'Gemini Pro & Flash', keyLabel: 'API Key',
    placeholder: 'AIza…',
    keyPrefix: 'AIza',
    staticModels: [
      { id: 'gemini-2.5-flash', name: 'Gemini 2.5 Flash', cost: 'best' },
      { id: 'gemini-2.0-flash', name: 'Gemini 2.0 Flash', cost: 'best' },
      { id: 'gemini-2.5-pro', name: 'Gemini 2.5 Pro', cost: 'high' },
    ],
  },
  {
    id: 'mistral', name: 'Mistral', color: '#ec4899',
    desc: 'Mistral & Codestral', keyLabel: 'API Key',
    placeholder: 'your-mistral-key',
    staticModels: [
      { id: 'mistral-small-latest', name: 'Mistral Small', cost: 'best' },
      { id: 'mistral-large-latest', name: 'Mistral Large', cost: 'mid' },
      { id: 'codestral-latest', name: 'Codestral', cost: 'mid' },
      { id: 'mistral-embed', name: 'Mistral Embed', cost: 'best' },
    ],
  },
  {
    id: 'ollama', name: 'Ollama', color: '#64748b',
    desc: 'Self-hosted local models', keyLabel: null,
    isEndpoint: true, endpointPlaceholder: 'http://localhost:11434',
    staticModels: [],
  },
  {
    id: 'azure', name: 'Azure OpenAI', color: '#0078d4',
    desc: 'Enterprise deployments', keyLabel: 'API Key',
    placeholder: 'your-azure-key',
    isEndpoint: true, endpointPlaceholder: 'https://your-resource.openai.azure.com',
    staticModels: [],
  },
  {
    id: 'modal', name: 'Company Brain (Hermes-3)', color: '#16a34a',
    desc: 'Your fine-tuned model on Modal GPU', keyLabel: 'Serve Token',
    placeholder: 'serve token (SERVE_TOKEN)',
    isEndpoint: true, endpointPlaceholder: 'https://your-serving-url',
    modelLabel: 'Company ID', modelPlaceholder: 'company_id to route to',
    staticModels: [],
  },
];

const COST_LABELS = {
  best: { label: 'Fast & cheap', color: '#10b981' },
  mid:  { label: 'Balanced',     color: '#f59e0b' },
  high: { label: 'Powerful',     color: '#ef4444' },
};

function detectProviderFromKey(key) {
  if (!key) return null;
  if (key.startsWith('sk-ant-')) return 'anthropic';
  if (key.startsWith('sk-or-'))  return 'openrouter';
  if (key.startsWith('AIza'))    return 'google';
  if (key.startsWith('sk-'))     return 'openai';
  return null;
}

const USE_CASES = [
  { id: 'reasoning',  label: 'Daemon Chat',      desc: 'Main AI assistant for all users' },
  { id: 'embeddings', label: 'Embeddings',        desc: 'Vector search & knowledge base' },
  { id: 'sensitive',  label: 'Sensitive Queries', desc: 'Private data, stays local' },
  { id: 'fallback',   label: 'Fallback',          desc: 'Used if primary key fails' },
];

function ProviderBadge({ provider, size = 'sm' }) {
  const cfg = PROVIDERS.find(p => p.id === provider);
  if (!cfg) return null;
  const pad = size === 'sm' ? '3px 8px' : '5px 12px';
  const fs = size === 'sm' ? 10 : 12;
  return (
    <span style={{
      display: 'inline-block', padding: pad, borderRadius: 20,
      background: `${cfg.color}18`, border: `1px solid ${cfg.color}40`,
      fontFamily: 'var(--dmsans)', fontSize: fs, fontWeight: 600,
      color: cfg.color, whiteSpace: 'nowrap',
    }}>{cfg.name}</span>
  );
}

function UseCaseBadge({ useCase }) {
  const cfg = USE_CASES.find(u => u.id === useCase) ?? USE_CASES[0];
  return (
    <span style={{
      display: 'inline-block', padding: '2px 8px', borderRadius: 20,
      background: 'rgba(65,114,245,0.08)', border: '1px solid rgba(65,114,245,0.2)',
      fontFamily: 'var(--dmsans)', fontSize: 10, fontWeight: 600,
      color: '#4172f5', whiteSpace: 'nowrap', textTransform: 'uppercase', letterSpacing: '0.06em',
    }}>{cfg.label}</span>
  );
}

function FocusedInput({ value, onChange, placeholder, inputSt, type = 'text', style: extraStyle = {} }) {
  const [focused, setFocused] = useState(false);
  return (
    <input
      type={type} value={value} onChange={e => onChange(e.target.value)}
      placeholder={placeholder} onFocus={() => setFocused(true)} onBlur={() => setFocused(false)}
      autoComplete="off" spellCheck={false}
      style={{ ...inputSt(focused), ...extraStyle }}
    />
  );
}

const mkPrimaryBtn = (color, enabled) => ({
  padding: '9px 20px', borderRadius: 7, cursor: enabled ? 'pointer' : 'not-allowed',
  background: enabled ? color : 'rgba(255,255,255,0.05)', border: 'none',
  fontFamily: 'var(--dmsans)', fontSize: 13, fontWeight: 600,
  color: enabled ? '#fff' : 'rgba(255,255,255,0.3)', transition: 'opacity 0.15s',
});
const mkGhostBtn = (c, extra = {}) => ({
  padding: '9px 16px', borderRadius: 7, cursor: 'pointer',
  background: 'none', border: `1px solid ${c.subtleBorder}`,
  fontFamily: 'var(--dmsans)', fontSize: 13, color: c.text3, ...extra,
});

function AddProviderForm({ token, onSaved, onCancel, editKey, c }) {
  const [step, setStep]         = useState(editKey ? 2 : 1);
  const [provider, setProvider] = useState(editKey?.provider || '');
  const [apiKey, setApiKey]     = useState('');
  const [endpoint, setEndpoint] = useState(editKey?.endpoint || '');
  const [model, setModel]       = useState(editKey?.model || '');
  const [useCase, setUseCase]   = useState(editKey?.use_case || 'reasoning');
  const [label, setLabel]       = useState(editKey?.label || '');
  const [showKey, setShowKey]   = useState(false);
  const [models, setModels]     = useState([]);
  const [loadingModels, setLoadingModels] = useState(false);
  const [saving, setSaving]     = useState(false);
  const [err, setErr]           = useState('');
  const cfg = PROVIDERS.find(p => p.id === provider);

  const handleKeyChange = (val) => {
    setApiKey(val);
    if (!provider) {
      const detected = detectProviderFromKey(val);
      if (detected) setProvider(detected);
    }
  };

  const inputSt = (focused) => ({
    width: '100%', padding: '10px 14px', boxSizing: 'border-box',
    background: focused ? (c.d ? 'rgba(255,255,255,0.07)' : '#fff') : c.inputBg,
    border: `1px solid ${focused ? 'rgba(65,114,245,0.5)' : c.inputBorder}`,
    borderRadius: 7, color: c.text, fontSize: 14, fontFamily: 'var(--dmsans)',
    outline: 'none', transition: 'all 0.15s',
    boxShadow: focused ? '0 0 0 2px rgba(65,114,245,0.15)' : 'none',
  });

  const validateAndFetch = useCallback(async () => {
    if (!cfg) return;
    setLoadingModels(true);
    setErr('');
    try {
      const r = await fetch('/api/workspace/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ action: 'validate', provider, key: apiKey, endpoint }),
      });
      const d = await r.json();
      const live = d.models || [];
      const merged = live.length ? live : cfg.staticModels;
      setModels(merged);
      if (!model && merged[0]) setModel(merged[0].id);
    } catch {
      setModels(cfg.staticModels || []);
      if (!model && cfg.staticModels?.[0]) setModel(cfg.staticModels[0].id);
    }
    setLoadingModels(false);
  }, [cfg, token, provider, apiKey, endpoint, model]);

  const advanceToModels = () => {
    const base = cfg?.staticModels || [];
    setModels(base);
    if (!model && base[0]) setModel(base[0].id);
    setStep(3);
    if (apiKey || provider === 'ollama') validateAndFetch();
  };

  const save = async () => {
    setSaving(true); setErr('');
    try {
      const r = await fetch('/api/workspace/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          id: editKey?.id, provider,
          key: apiKey || undefined, endpoint: endpoint || undefined,
          model, use_case: useCase, label: label || undefined,
        }),
      });
      const d = await r.json();
      if (!r.ok) { setErr(d.error || 'Save failed'); return; }
      onSaved();
    } catch { setErr('Network error'); }
    setSaving(false);
  };

  return (
    <div style={{ background: c.card, border: '1px solid rgba(65,114,245,0.25)', borderRadius: 12, padding: '20px 24px', marginBottom: 16 }}>
      {/* Steps */}
      <div style={{ display: 'flex', gap: 6, marginBottom: 20, alignItems: 'center' }}>
        {['Provider', 'Credentials', 'Model & Use'].map((s, i) => (
          <div key={s} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <div style={{
              width: 22, height: 22, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center',
              background: step > i + 1 ? '#10b981' : step === i + 1 ? '#4172f5' : c.subtle,
              border: `1px solid ${step > i + 1 ? '#10b981' : step === i + 1 ? '#4172f5' : c.subtleBorder}`,
              fontFamily: 'var(--dmsans)', fontSize: 11, fontWeight: 700,
              color: step >= i + 1 ? '#fff' : c.text3,
            }}>{step > i + 1 ? '✓' : i + 1}</div>
            <span style={{ fontFamily: 'var(--dmsans)', fontSize: 12, color: step === i + 1 ? c.text : c.text3 }}>{s}</span>
            {i < 2 && <span style={{ color: c.text4, fontSize: 14, marginLeft: 2 }}>›</span>}
          </div>
        ))}
        <button type="button" onClick={onCancel} style={{ marginLeft: 'auto', background: 'none', border: 'none', color: c.text3, cursor: 'pointer', fontSize: 20, lineHeight: 1, padding: 0 }}>×</button>
      </div>

      {/* Step 1: Provider picker */}
      {step === 1 && (
        <div>
          <p style={{ fontFamily: 'var(--dmsans)', fontSize: 13, color: c.text2, marginBottom: 8 }}>Choose a provider, or paste your API key below to auto-detect.</p>
          <div style={{ marginBottom: 14, position: 'relative' }}>
            <input
              type="text" placeholder="Paste API key to auto-detect provider (sk-ant-…, AIza…, sk-or-…, sk-…)"
              style={{
                width: '100%', padding: '9px 14px', boxSizing: 'border-box',
                background: c.inputBg, border: `1px solid ${c.inputBorder}`,
                borderRadius: 7, color: c.text, fontSize: 13, fontFamily: 'var(--dmsans)', outline: 'none',
              }}
              onChange={e => {
                const val = e.target.value;
                const detected = detectProviderFromKey(val);
                if (detected) { setApiKey(val); setProvider(detected); setStep(2); }
              }}
            />
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(155px, 1fr))', gap: 8 }}>
            {PROVIDERS.map(p => (
              <button key={p.id} type="button" onClick={() => { setProvider(p.id); setStep(2); }}
                style={{
                  padding: '12px 14px', textAlign: 'left', cursor: 'pointer',
                  background: c.subtle, border: `1px solid ${c.subtleBorder}`,
                  borderRadius: 9, transition: 'all 0.12s',
                }}
                onMouseEnter={e => { e.currentTarget.style.borderColor = p.color + '55'; e.currentTarget.style.background = `${p.color}0e`; }}
                onMouseLeave={e => { e.currentTarget.style.borderColor = ''; e.currentTarget.style.background = ''; }}
              >
                <div style={{ fontFamily: 'var(--dmsans)', fontSize: 13, fontWeight: 700, color: p.color, marginBottom: 3 }}>{p.name}</div>
                <div style={{ fontFamily: 'var(--dmsans)', fontSize: 11, color: c.text3 }}>{p.desc}</div>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Step 2: Key / endpoint */}
      {step === 2 && cfg && (
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16 }}>
            <ProviderBadge provider={provider} size="md" />
            <span style={{ fontFamily: 'var(--dmsans)', fontSize: 13, color: c.text2 }}>{cfg.desc}</span>
          </div>
          {cfg.isEndpoint && (
            <div style={{ marginBottom: 12 }}>
              <label style={{ fontFamily: 'var(--dmsans)', fontSize: 11, color: c.text3, display: 'block', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.07em' }}>Endpoint URL</label>
              <FocusedInput value={endpoint} onChange={setEndpoint} placeholder={cfg.endpointPlaceholder} inputSt={inputSt} />
            </div>
          )}
          {cfg.keyLabel && (
            <div style={{ marginBottom: 16 }}>
              <div style={{ marginBottom: 10, padding: '10px 12px', borderRadius: 8, background: 'rgba(65,114,245,0.06)', border: '1px solid rgba(65,114,245,0.15)' }}>
                <p style={{ fontFamily: 'var(--dmsans)', fontSize: 12, color: c.text2, margin: 0, lineHeight: 1.5 }}>
                  <strong style={{ color: '#4172f5' }}>API key required.</strong> Claude Pro, ChatGPT Plus, and Gemini subscriptions don't include API access — they're separate products. Get an API key from the provider's developer console, then add credit separately.
                </p>
              </div>
              <label style={{ fontFamily: 'var(--dmsans)', fontSize: 11, color: c.text3, display: 'block', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.07em' }}>{cfg.keyLabel}</label>
              <div style={{ position: 'relative' }}>
                <FocusedInput type={showKey ? 'text' : 'password'} value={apiKey} onChange={handleKeyChange}
                  placeholder={editKey ? `Leave blank to keep existing key ${editKey.keyHint || ''}` : cfg.placeholder}
                  inputSt={inputSt} extraStyle={{ paddingRight: 52 }} />
                <button type="button" onClick={() => setShowKey(s => !s)}
                  style={{ position: 'absolute', right: 12, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer', color: c.text3, fontSize: 12, fontFamily: 'var(--dmsans)' }}>
                  {showKey ? 'hide' : 'show'}
                </button>
              </div>
            </div>
          )}
          {err && <p style={{ fontFamily: 'var(--dmsans)', fontSize: 12, color: '#ef4444', marginBottom: 10 }}>{err}</p>}
          <div style={{ display: 'flex', gap: 8 }}>
            {!editKey && <button type="button" onClick={() => setStep(1)} style={mkGhostBtn(c)}>← Back</button>}
            <button type="button" onClick={advanceToModels}
              disabled={!!(cfg.keyLabel && !apiKey && !editKey)}
              style={mkPrimaryBtn(cfg.color, !cfg.keyLabel || !!apiKey || !!editKey)}>
              Next: Choose model →
            </button>
          </div>
        </div>
      )}

      {/* Step 3: Model + use case */}
      {step === 3 && cfg && (
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16 }}>
            <ProviderBadge provider={provider} size="md" />
          </div>
          <div style={{ marginBottom: 16 }}>
            <label style={{ fontFamily: 'var(--dmsans)', fontSize: 11, color: c.text3, display: 'block', marginBottom: 8, textTransform: 'uppercase', letterSpacing: '0.07em' }}>{cfg.modelLabel || 'Model'}</label>
            {loadingModels && <p style={{ fontFamily: 'var(--dmsans)', fontSize: 12, color: c.text3, marginBottom: 8 }}>Fetching live model list…</p>}
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 10 }}>
              {models.slice(0, 20).map(m => {
                const costInfo = m.cost ? COST_LABELS[m.cost] : null;
                const isSelected = model === m.id;
                return (
                  <button key={m.id} type="button" onClick={() => setModel(m.id)}
                    style={{
                      padding: '6px 12px', borderRadius: 6, cursor: 'pointer', transition: 'all 0.1s',
                      background: isSelected ? `${cfg.color}18` : c.subtle,
                      border: `1px solid ${isSelected ? cfg.color + '55' : c.subtleBorder}`,
                      fontFamily: 'var(--dmsans)', fontSize: 12, textAlign: 'left',
                      fontWeight: isSelected ? 600 : 400,
                      color: isSelected ? cfg.color : c.text2,
                      display: 'flex', flexDirection: 'column', gap: 2,
                    }}>
                    <span>{m.name || m.id}</span>
                    {costInfo && (
                      <span style={{ fontSize: 10, fontWeight: 500, color: costInfo.color, opacity: 0.85 }}>{costInfo.label}</span>
                    )}
                  </button>
                );
              })}
            </div>
            <FocusedInput value={model} onChange={setModel} placeholder={cfg.modelPlaceholder || 'Or type any model ID…'} inputSt={inputSt} />
          </div>
          <div style={{ marginBottom: 16 }}>
            <label style={{ fontFamily: 'var(--dmsans)', fontSize: 11, color: c.text3, display: 'block', marginBottom: 8, textTransform: 'uppercase', letterSpacing: '0.07em' }}>Use Case</label>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
              {USE_CASES.map(u => (
                <button key={u.id} type="button" onClick={() => setUseCase(u.id)}
                  style={{
                    padding: '10px 12px', textAlign: 'left', cursor: 'pointer', transition: 'all 0.1s',
                    background: useCase === u.id ? 'rgba(65,114,245,0.1)' : c.subtle,
                    border: `1px solid ${useCase === u.id ? 'rgba(65,114,245,0.45)' : c.subtleBorder}`,
                    borderRadius: 8,
                  }}>
                  <div style={{ fontFamily: 'var(--dmsans)', fontSize: 12, fontWeight: 600, color: useCase === u.id ? '#4172f5' : c.text }}>{u.label}</div>
                  <div style={{ fontFamily: 'var(--dmsans)', fontSize: 11, color: c.text3, marginTop: 2 }}>{u.desc}</div>
                </button>
              ))}
            </div>
          </div>
          <div style={{ marginBottom: 16 }}>
            <label style={{ fontFamily: 'var(--dmsans)', fontSize: 11, color: c.text3, display: 'block', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.07em' }}>Label <span style={{ color: c.text4, fontWeight: 400 }}>(optional)</span></label>
            <FocusedInput value={label} onChange={setLabel} placeholder="e.g. Internal Llama, Embeddings key…" inputSt={inputSt} />
          </div>
          {err && <p style={{ fontFamily: 'var(--dmsans)', fontSize: 12, color: '#ef4444', marginBottom: 10 }}>{err}</p>}
          <div style={{ display: 'flex', gap: 8 }}>
            <button type="button" onClick={() => setStep(2)} style={mkGhostBtn(c)}>← Back</button>
            <button type="button" onClick={save} disabled={saving || !model}
              style={mkPrimaryBtn('#4172f5', !!model && !saving)}>
              {saving ? 'Saving…' : editKey ? 'Save Changes' : 'Add Provider'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// Quick-fill personality vibes; the textarea (freeform) is the source of truth.
const PERSONA_PRESETS = [
  { key: 'witty',      label: 'Sharp & witty',      text: 'Sharp and a little witty — concise, candid, with a dash of dry humour. Never fawning or robotic.' },
  { key: 'warm',       label: 'Warm & encouraging', text: 'Warm and encouraging — supportive, positive, and personable, while still direct.' },
  { key: 'precise',    label: 'Calm & precise',     text: 'Calm and precise — measured, exact, detail-oriented, and unflappable.' },
  { key: 'nononsense', label: 'No-nonsense',        text: 'No-nonsense and direct — brief, blunt, zero filler. Gets straight to the point.' },
];

function DaemonSettings({ c, token }) {
  const [daemonName, setDaemonName]       = useState('');
  const [preferredName, setPreferredName] = useState('');
  const [persona, setPersona]             = useState('');
  const [loading, setLoading]             = useState(true);
  const [saving, setSaving]               = useState(false);
  const [saved, setSaved]                 = useState(false);

  useEffect(() => {
    if (!token) return;
    brainApi.getDaemon({ token })
      .then(d => {
        setDaemonName(d.daemon_name || '');
        setPreferredName(d.preferred_name || '');
        setPersona(d.persona || '');
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [token]);

  const save = async () => {
    setSaving(true); setSaved(false);
    try {
      await brainApi.updateDaemon({ token, daemonName, preferredName, persona });
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    } catch {}
    setSaving(false);
  };

  const field = {
    width: '100%', boxSizing: 'border-box', padding: '9px 12px', borderRadius: 8,
    background: c.bg, border: `1px solid ${c.cardBorder}`, color: c.text,
    fontFamily: 'var(--dmsans)', fontSize: 14, outline: 'none',
  };
  const lbl = { fontFamily: 'var(--mono)', fontSize: 10, letterSpacing: '0.08em', color: c.text3, marginBottom: 6, display: 'block' };

  return (
    <div style={{ marginTop: 44 }}>
      <div style={{ marginBottom: 18 }}>
        <p className="wd-label-blue" style={{ marginBottom: 6 }}>YOUR DAEMON</p>
        <h2 style={{ fontFamily: 'var(--inter)', fontSize: 19, fontWeight: 700, color: c.text, margin: 0, letterSpacing: '-0.02em' }}>Name & personality</h2>
        <p style={{ fontFamily: 'var(--dmsans)', fontSize: 13, color: c.text3, marginTop: 6, lineHeight: 1.6 }}>
          Give your daemon a name and a personality. You can also just tell it in chat —
          “call yourself Atlas, call me Boss, and be more concise.”
        </p>
      </div>

      <div style={{ background: c.card, border: `1px solid ${c.cardBorder}`, borderRadius: 12, padding: 20 }}>
        {loading ? (
          <p style={{ fontFamily: 'var(--dmsans)', fontSize: 14, color: c.text3, margin: 0 }}>Loading…</p>
        ) : (
          <>
            <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', marginBottom: 16 }}>
              <div style={{ flex: 1, minWidth: 200 }}>
                <label style={lbl}>DAEMON’S NAME</label>
                <input style={field} value={daemonName} maxLength={40}
                  onChange={e => setDaemonName(e.target.value)} placeholder="e.g. Atlas (leave blank to stay “your Daemon”)" />
              </div>
              <div style={{ flex: 1, minWidth: 200 }}>
                <label style={lbl}>WHAT SHOULD IT CALL YOU?</label>
                <input style={field} value={preferredName} maxLength={40}
                  onChange={e => setPreferredName(e.target.value)} placeholder="e.g. Boss (defaults to your name)" />
              </div>
            </div>

            <label style={lbl}>PERSONALITY</label>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 10 }}>
              {PERSONA_PRESETS.map(p => (
                <button key={p.key} type="button" onClick={() => setPersona(p.text)}
                  style={{
                    padding: '6px 12px', borderRadius: 999, cursor: 'pointer',
                    fontFamily: 'var(--dmsans)', fontSize: 12, fontWeight: 600,
                    background: persona === p.text ? 'rgba(65,114,245,0.14)' : c.subtle,
                    border: `1px solid ${persona === p.text ? 'rgba(65,114,245,0.4)' : c.subtleBorder}`,
                    color: persona === p.text ? '#4172f5' : c.text2,
                  }}>{p.label}</button>
              ))}
            </div>
            <textarea style={{ ...field, minHeight: 84, resize: 'vertical', lineHeight: 1.5 }}
              value={persona} maxLength={1000}
              onChange={e => setPersona(e.target.value)}
              placeholder="Pick a vibe above, then tweak — or write your own. e.g. “Sharp and witty, but careful with numbers.”" />

            <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 14 }}>
              <button type="button" onClick={save} disabled={saving}
                style={{
                  padding: '9px 20px', borderRadius: 8, cursor: saving ? 'default' : 'pointer',
                  background: 'rgba(65,114,245,0.1)', border: '1px solid rgba(65,114,245,0.3)',
                  fontFamily: 'var(--dmsans)', fontSize: 13, fontWeight: 600, color: '#4172f5',
                  opacity: saving ? 0.6 : 1,
                }}>
                {saving ? 'Saving…' : 'Save daemon'}
              </button>
              {saved && <span style={{ fontFamily: 'var(--dmsans)', fontSize: 13, color: '#10b981' }}>✓ Saved — it takes effect next message.</span>}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function SettingsPage() {
  const c = useC();
  const { token } = useAuth();
  const [keys, setKeys]       = useState([]);
  const [loading, setLoading] = useState(true);
  const [adding, setAdding]   = useState(false);
  const [editKey, setEditKey] = useState(null);
  const [syncing, setSyncing] = useState(null);

  const load = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    try {
      const r = await fetch('/api/workspace/settings', { headers: { Authorization: `Bearer ${token}` } });
      const d = await r.json();
      setKeys(d.keys || []);
    } catch {}
    setLoading(false);
  }, [token]);

  useEffect(() => { load(); }, [load]);

  const remove = async (id) => {
    if (!window.confirm('Remove this provider key? This cannot be undone.')) return;
    await fetch('/api/workspace/settings', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ id }),
    });
    load();
  };

  const syncModels = async (key) => {
    setSyncing(key.id);
    const r = await fetch(`/api/workspace/settings?models=true&keyId=${key.id}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const d = await r.json();
    setSyncing(null);
    if (d.models?.length) {
      alert(`${d.models.length} models available for this key. Edit the provider to update your selection.`);
    }
  };

  return (
    <div style={{ height: '100%', overflowY: 'auto', background: c.bg, transition: 'background 0.2s' }}>
      <div style={{ maxWidth: 720, margin: '0 auto', padding: '48px 32px 80px' }}>

        <div style={{ marginBottom: 36 }}>
          <p className="wd-label-blue" style={{ marginBottom: 6 }}>SETTINGS</p>
          <h1 style={{ fontFamily: 'var(--inter)', fontSize: 24, fontWeight: 700, color: c.text, margin: 0, letterSpacing: '-0.03em' }}>API Keys & Models</h1>
          <p style={{ fontFamily: 'var(--dmsans)', fontSize: 14, color: c.text3, marginTop: 6, lineHeight: 1.6 }}>
            Connect any AI provider. Your whole team shares these keys — no per-user setup.
          </p>
        </div>

        {(adding || editKey) && (
          <AddProviderForm
            token={token} editKey={editKey} c={c}
            onCancel={() => { setAdding(false); setEditKey(null); }}
            onSaved={() => { setAdding(false); setEditKey(null); load(); }}
          />
        )}

        {loading ? (
          <p style={{ fontFamily: 'var(--dmsans)', fontSize: 14, color: c.text3 }}>Loading…</p>
        ) : keys.length === 0 ? (
          <div style={{ background: c.card, border: `1px solid ${c.cardBorder}`, borderRadius: 12, padding: '32px 24px', textAlign: 'center', marginBottom: 16 }}>
            <p style={{ fontFamily: 'var(--dmsans)', fontSize: 15, fontWeight: 600, color: c.text, marginBottom: 6 }}>No providers connected</p>
            <p style={{ fontFamily: 'var(--dmsans)', fontSize: 13, color: c.text3 }}>Add a provider key to enable the Daemon for your workspace.</p>
          </div>
        ) : (
          <div style={{ marginBottom: 16 }}>
            {keys.map(k => (
              <div key={k.id} style={{
                background: c.card, border: `1px solid ${c.cardBorder}`,
                borderRadius: 10, padding: '14px 18px', marginBottom: 8,
                display: 'flex', alignItems: 'center', gap: 14,
              }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 5, flexWrap: 'wrap' }}>
                    <ProviderBadge provider={k.provider} />
                    <UseCaseBadge useCase={k.use_case} />
                    {k.label && <span style={{ fontFamily: 'var(--dmsans)', fontSize: 11, color: c.text3 }}>· {k.label}</span>}
                  </div>
                  <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'center' }}>
                    {k.model && <span style={{ fontFamily: 'var(--mono)', fontSize: 11, color: c.text2 }}>{k.model}</span>}
                    {k.endpoint && <span style={{ fontFamily: 'var(--mono)', fontSize: 11, color: c.text3 }}>{k.endpoint}</span>}
                    {k.keyHint && <span style={{ fontFamily: 'var(--mono)', fontSize: 11, color: c.text4 }}>key: {k.keyHint}</span>}
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
                  <button type="button" onClick={() => syncModels(k)}
                    title="Refresh available models"
                    style={{ ...mkGhostBtn(c), padding: '5px 10px', fontSize: 13 }}>
                    {syncing === k.id ? '…' : '↻'}
                  </button>
                  <button type="button" onClick={() => { setEditKey(k); setAdding(false); }}
                    style={{ ...mkGhostBtn(c), padding: '5px 12px', fontSize: 12 }}>Edit</button>
                  <button type="button" onClick={() => remove(k.id)}
                    style={{ ...mkGhostBtn(c, { color: '#ef4444', borderColor: 'rgba(239,68,68,0.25)' }), padding: '5px 12px', fontSize: 12 }}>
                    Remove
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}

        {!adding && !editKey && (
          <button type="button" onClick={() => { setAdding(true); setEditKey(null); }}
            style={{
              padding: '10px 20px', borderRadius: 8, cursor: 'pointer',
              background: 'rgba(65,114,245,0.08)', border: '1px solid rgba(65,114,245,0.25)',
              fontFamily: 'var(--dmsans)', fontSize: 13, fontWeight: 600, color: '#4172f5',
            }}>
            + Add Provider
          </button>
        )}

        <div style={{ marginTop: 32, padding: '14px 18px', background: c.subtle, border: `1px solid ${c.subtleBorder}`, borderRadius: 10 }}>
          <p style={{ fontFamily: 'var(--dmsans)', fontSize: 12, color: c.text3, lineHeight: 1.65, margin: 0 }}>
            <strong style={{ color: c.text2 }}>Daemon Chat</strong> uses the reasoning key.{' '}
            <strong style={{ color: c.text2 }}>Embeddings</strong> powers knowledge base search.{' '}
            <strong style={{ color: c.text2 }}>Sensitive</strong> keeps queries on your own infra (Ollama).{' '}
            Switching embedding providers requires re-indexing — runs as a background job.
          </p>
        </div>

        <DaemonSettings c={c} token={token} />
        <PublishingSettings c={c} token={token} />
      </div>
    </div>
  );
}

function PublishingSettings({ c, token }) {
  const [autoPublish, setAutoPublish] = useState(false);
  const [webhook, setWebhook]         = useState('');
  const [loading, setLoading]         = useState(true);
  const [saving, setSaving]           = useState(false);
  const [saved, setSaved]             = useState(false);
  const [err, setErr]                 = useState('');

  useEffect(() => {
    if (!token) return;
    fetch('/api/workspace/settings?publishing=true', { headers: { Authorization: `Bearer ${token}` } })
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (d) { setAutoPublish(!!d.auto_publish); setWebhook(d.publish_webhook_url || ''); } })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [token]);

  const save = async () => {
    setSaving(true); setSaved(false); setErr('');
    try {
      const r = await fetch('/api/workspace/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ action: 'update_publishing', auto_publish: autoPublish, publish_webhook_url: webhook }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) { setErr(d.error || 'Could not save.'); if (d.error?.includes('webhook')) setAutoPublish(false); }
      else { setSaved(true); setTimeout(() => setSaved(false), 2500); }
    } catch { setErr('Network error.'); }
    setSaving(false);
  };

  const field = {
    width: '100%', boxSizing: 'border-box', padding: '9px 12px', borderRadius: 8,
    background: c.bg, border: `1px solid ${c.cardBorder}`, color: c.text,
    fontFamily: 'var(--mono)', fontSize: 13, outline: 'none',
  };
  const lbl = { fontFamily: 'var(--mono)', fontSize: 10, letterSpacing: '0.08em', color: c.text3, marginBottom: 6, display: 'block' };

  return (
    <div style={{ marginTop: 44 }}>
      <div style={{ marginBottom: 18 }}>
        <p className="wd-label-blue" style={{ marginBottom: 6 }}>AUTONOMOUS PUBLISHING · LEVEL 3</p>
        <h2 style={{ fontFamily: 'var(--inter)', fontSize: 19, fontWeight: 700, color: c.text, margin: 0, letterSpacing: '-0.02em' }}>Let the brain post for you</h2>
        <p style={{ fontFamily: 'var(--dmsans)', fontSize: 13, color: c.text3, marginTop: 6, lineHeight: 1.6 }}>
          When on, the brain auto-publishes content drafts it generates from market findings — no confirmation —
          and reports each post to the affected team’s inbox. It POSTs to your webhook (Zapier, Make, n8n or a Slack
          incoming webhook → your socials). Leave off to keep the default: drafts wait for you to confirm.
        </p>
      </div>

      <div style={{ background: c.card, border: `1px solid ${c.cardBorder}`, borderRadius: 12, padding: 20 }}>
        {loading ? (
          <p style={{ fontFamily: 'var(--dmsans)', fontSize: 14, color: c.text3, margin: 0 }}>Loading…</p>
        ) : (
          <>
            <label style={lbl}>PUBLISH WEBHOOK URL</label>
            <input style={field} value={webhook} maxLength={2000}
              onChange={e => setWebhook(e.target.value)} placeholder="https://hooks.zapier.com/…  (receives {company, finding, text})" />

            <label style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 16, cursor: 'pointer' }}>
              <input type="checkbox" checked={autoPublish} onChange={e => setAutoPublish(e.target.checked)} style={{ width: 16, height: 16, cursor: 'pointer' }} />
              <span style={{ fontFamily: 'var(--dmsans)', fontSize: 14, color: c.text, fontWeight: 500 }}>
                Enable autonomous publishing (Level 3 — execute &amp; report)
              </span>
            </label>

            <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 16 }}>
              <button type="button" onClick={save} disabled={saving}
                style={{
                  padding: '9px 20px', borderRadius: 8, cursor: saving ? 'default' : 'pointer',
                  background: 'rgba(65,114,245,0.1)', border: '1px solid rgba(65,114,245,0.3)',
                  fontFamily: 'var(--dmsans)', fontSize: 13, fontWeight: 600, color: '#4172f5',
                  opacity: saving ? 0.6 : 1,
                }}>
                {saving ? 'Saving…' : 'Save publishing'}
              </button>
              {saved && <span style={{ fontFamily: 'var(--dmsans)', fontSize: 13, color: '#10b981' }}>✓ Saved.</span>}
              {err && <span style={{ fontFamily: 'var(--dmsans)', fontSize: 13, color: '#ef4444' }}>{err}</span>}
            </div>
          </>
        )}
      </div>
    </div>
  );
}


// ─────────────────────────────────────────────────────────────────────────────
// INTEGRATIONS
// ─────────────────────────────────────────────────────────────────────────────

const INTEGRATION_ROADMAP = [
  'Gmail', 'Google Drive', 'Google Calendar', 'Notion', 'Microsoft Teams',
  'Outlook', 'OneDrive', 'GitHub', 'Jira', 'HubSpot', 'Salesforce',
];

function IntegrationsPage() {
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
                    <div style={{ fontFamily: 'var(--mono)', fontSize: 10, letterSpacing: '0.04em', color: connected ? '#10b981' : c.text4, marginTop: 3 }}>
                      {connected ? `CONNECTED${conn.external_account ? ` · ${conn.external_account}` : ''}` : p.configured ? 'NOT CONNECTED' : 'AWAITING SETUP'}
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
                        background: p.configured ? 'rgba(65,114,245,0.1)' : c.subtle, border: `1px solid ${p.configured ? 'rgba(65,114,245,0.3)' : c.subtleBorder}`,
                        fontFamily: 'var(--dmsans)', fontSize: 13, fontWeight: 600, color: p.configured ? '#4172f5' : c.text4, opacity: busy === p.id ? 0.6 : 1 }}>
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
// SHELL COMPONENTS
// ─────────────────────────────────────────────────────────────────────────────

function PlaceholderPage({ title, label }) {
  const c = useC();
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', gap: 12, background: c.bg, transition: 'background 0.2s' }}>
      <p className="wd-label-blue">{label}</p>
      <p style={{ fontFamily: 'var(--dmsans)', fontSize: 16, color: c.text3 }}>{title} — coming soon</p>
    </div>
  );
}

function AdminRoute({ isAdmin, children }) {
  const c = useC();
  if (isAdmin) return children;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', gap: 16, background: c.bg, transition: 'background 0.2s' }}>
      <div style={{ width: 44, height: 44, borderRadius: 12, background: c.subtle, border: `1px solid ${c.subtleBorder}`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 20 }}>🔒</div>
      <div style={{ textAlign: 'center' }}>
        <p style={{ fontFamily: 'var(--dmsans)', fontSize: 15, fontWeight: 600, color: c.text, marginBottom: 6 }}>Admin access required</p>
        <p style={{ fontFamily: 'var(--dmsans)', fontSize: 13, color: c.text3 }}>Company Brain is restricted to workspace admins.</p>
      </div>
    </div>
  );
}

function MobileTopBar({ onOpen, isLight }) {
  const c = useC();
  const { toggle } = useTheme();
  const iconColor = isLight ? 'rgba(15,20,53,0.5)' : 'rgba(255,255,255,0.45)';
  return (
    <div style={{ height: 52, display: 'flex', alignItems: 'center', padding: '0 14px', gap: 10, background: c.headerBg, borderBottom: `1px solid ${c.headerBorder}`, flexShrink: 0 }}>
      <button type="button" onClick={onOpen} style={{ width: 36, height: 36, borderRadius: 8, background: 'none', border: 'none', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 4, cursor: 'pointer', padding: 0, flexShrink: 0, color: iconColor }}>
        <span style={{ width: 18, height: 1.5, background: 'currentColor', borderRadius: 1, display: 'block' }} />
        <span style={{ width: 18, height: 1.5, background: 'currentColor', borderRadius: 1, display: 'block' }} />
        <span style={{ width: 12, height: 1.5, background: 'currentColor', borderRadius: 1, display: 'block', alignSelf: 'flex-start' }} />
      </button>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flex: 1 }}>
        <DaemonMark size={18} glow={!isLight} />
        <span style={{ fontFamily: 'var(--orbitron)', fontSize: 10, fontWeight: 700, color: '#4172f5', letterSpacing: '0.14em' }}>WORKDAEMON</span>
      </div>
      <button type="button" onClick={toggle} style={{ width: 32, height: 32, borderRadius: 8, background: isLight ? 'rgba(0,0,0,0.05)' : 'rgba(255,255,255,0.05)', border: `1px solid ${isLight ? 'rgba(0,0,0,0.09)' : 'rgba(255,255,255,0.08)'}`, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', fontSize: 13, flexShrink: 0 }}>
        {isLight ? '🌙' : '☀️'}
      </button>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// DASHBOARD SHELL
// ─────────────────────────────────────────────────────────────────────────────

export default function Dashboard() {
  const { isMobile } = useViewport();
  const { theme } = useTheme();
  const { profile } = useAuth();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [inChat, setInChat] = useState(false);
  const isLight = theme === 'light';
  const isAdmin = profile?.workspaces?.id
    ? true  // member of a workspace — role check done server-side per route
    : false;
  const openMenu = () => setSidebarOpen(true);

  return (
    <div style={{ display: 'flex', height: '100vh', overflow: 'hidden' }}>
      <Sidebar
        isAdmin={isAdmin}
        isOpen={!isMobile || sidebarOpen}
        onClose={() => setSidebarOpen(false)}
      />

      <div style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
        {isMobile && !inChat && <MobileTopBar onOpen={openMenu} isLight={isLight} />}

        <Routes>
          <Route path="/"            element={<Navigate to="daemon" replace />} />
          <Route path="daemon"       element={<DaemonPage onMenu={openMenu} onChatChange={setInChat} />} />
          <Route path="brain"        element={<AdminRoute isAdmin={isAdmin}><BrainPage /></AdminRoute>} />
          <Route path="tasks"        element={<TasksPage />} />
          <Route path="inbox"        element={<InboxPage />} />
          <Route path="integrations" element={<IntegrationsPage />} />
          <Route path="overview"     element={<AdminRoute isAdmin={isAdmin}><OverviewPage /></AdminRoute>} />
          <Route path="team"         element={<AdminRoute isAdmin={isAdmin}><PlaceholderPage label="ADMIN" title="Team Management" /></AdminRoute>} />
          <Route path="audit"        element={<AdminRoute isAdmin={isAdmin}><PlaceholderPage label="ADMIN" title="Audit Log" /></AdminRoute>} />
          <Route path="settings"     element={<SettingsPage />} />
        </Routes>
      </div>
    </div>
  );
}
