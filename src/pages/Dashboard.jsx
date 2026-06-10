import { useState, useEffect, useRef, useCallback } from 'react';
import { Routes, Route, Navigate, useNavigate } from 'react-router-dom';
import Sidebar from '../components/layout/Sidebar.jsx';
import DaemonMark from '../components/brand/DaemonMark.jsx';
import { useTheme, useViewport } from '../context/ThemeContext.jsx';
import { useAuth, supabase } from '../context/AuthContext.jsx';
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

function BlockActionConfirm({ block, onConfirm, onCancel, onExecPlan }) {
  const c = useC();
  const [dismissed, setDismissed] = useState(false);
  const [running, setRunning] = useState(false);
  if (dismissed) return null;
  const steps = Array.isArray(block.steps) ? block.steps : [];
  const stepText = (s) => (typeof s === 'string' ? s : (s?.text || s?.title || ''));
  // Multi-step plan: collect the execs from the steps (or a top-level execs array).
  const execs = Array.isArray(block.execs)
    ? block.execs
    : steps.filter(s => s && typeof s === 'object' && s.exec).map(s => s.exec);

  const confirm = async () => {
    if (execs.length && onExecPlan) { setRunning(true); await onExecPlan(execs, block); setDismissed(true); return; }
    onConfirm?.(block.id, block.exec); setDismissed(true);
  };
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
        {steps.length > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 14 }}>
            {steps.map((step, i) => (
              <div key={i} style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
                <div style={{ width: 22, height: 22, borderRadius: 6, background: c.subtle, border: `1px solid ${c.subtleBorder}`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'var(--mono)', fontSize: 10, color: c.text3, flexShrink: 0, marginTop: 1 }}>{i + 1}</div>
                <div style={{ fontFamily: 'var(--dmsans)', fontSize: 13, color: c.text2, lineHeight: 1.5, paddingTop: 2 }}>
                  {stepText(step)}
                  {step && typeof step === 'object' && step.exec && <span style={{ marginLeft: 7, fontFamily: 'var(--mono)', fontSize: 8.5, letterSpacing: '0.06em', color: '#4172f5', background: 'rgba(65,114,245,0.09)', border: '1px solid rgba(65,114,245,0.2)', borderRadius: 5, padding: '1px 6px', whiteSpace: 'nowrap' }}>⚙ {step.exec.name}</span>}
                </div>
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
          <button className="wd-btn" style={{ flex: 1, height: 44, fontSize: 9, letterSpacing: '0.1em', opacity: running ? 0.6 : 1 }}
            disabled={running} onClick={confirm}>
            {running ? 'EXECUTING…' : (execs.length > 1 ? `CONFIRM — EXECUTE ${execs.length} STEPS` : 'CONFIRM — EXECUTE')}
          </button>
          <button className="wd-btn-ghost" style={{ height: 44, padding: '0 20px', justifyContent: 'center', fontFamily: 'var(--mono)', fontSize: 9, letterSpacing: '0.1em' }}
            disabled={running} onClick={() => { onCancel?.(); setDismissed(true); }}>
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

// Adaptive action card — the daemon proposes something the user approves in one
// click; the buttons adapt to the conversation (Verify & Apply / Reject for a
// tool mutation, Copy / Email for produced content). A button's `exec` runs a
// real tool via /api/tasks execute_action; `copy` copies `body`; neither dismisses.
function BlockStagedAction({ block, onExec }) {
  const c = useC();
  const [s, setS] = useState('idle');        // idle | running | done | rejected | err
  const [err, setErr] = useState('');
  const [copied, setCopied] = useState(false);
  if (s === 'rejected') return null;
  const body = block.body || block.content || '';
  const changes = Array.isArray(block.changes) ? block.changes : [];
  const actions = Array.isArray(block.actions) && block.actions.length
    ? block.actions
    : [{ label: 'Verify & Apply', style: 'primary', exec: block.exec }, { label: 'Reject', style: 'danger' }];

  const onClick = async (a) => {
    if (a.exec?.name) {
      setS('running'); setErr('');
      const r = await onExec?.(a.exec);
      if (r?.ok) setS('done'); else { setS('err'); setErr(r?.error || 'Action failed'); }
    } else if (a.copy) {
      navigator.clipboard?.writeText(body).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1600); }).catch(() => {});
    } else {
      setS('rejected'); // Reject / dismiss
    }
  };
  const btnStyle = (style) => style === 'primary'
    ? { color: '#fff', background: '#4172f5', border: 'none' }
    : style === 'danger'
      ? { color: '#ef4444', background: 'none', border: '1px solid rgba(239,68,68,0.4)' }
      : { color: c.text3, background: 'none', border: `1px solid ${c.cardBorder}` };

  return (
    <div style={{ border: `1px solid ${c.cardBorder}`, borderRadius: 12, overflow: 'hidden' }}>
      <div style={{ padding: '10px 16px', borderBottom: `1px solid ${c.cardBorder}`, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <span style={{ fontFamily: 'var(--mono)', fontSize: 9, letterSpacing: '0.14em', color: c.text3 }}>{(block.label || 'STAGED ACTION').toUpperCase()}</span>
        <span style={{ fontFamily: 'var(--mono)', fontSize: 10, letterSpacing: '0.06em', color: s === 'done' ? '#10b981' : '#f59e0b', border: `1px solid ${s === 'done' ? 'rgba(16,185,129,0.35)' : 'rgba(245,158,11,0.35)'}`, borderRadius: 7, padding: '4px 10px' }}>
          {s === 'done' ? '● Applied' : s === 'running' ? '● Applying…' : `● ${block.status || 'Awaiting verification'}`}
        </span>
      </div>
      <div style={{ padding: '16px 18px' }}>
        {block.title && (
          <div style={{ display: 'flex', gap: 9, alignItems: 'flex-start', marginBottom: changes.length || body ? 13 : 4 }}>
            <div style={{ width: 3, alignSelf: 'stretch', background: '#4172f5', borderRadius: 2, minHeight: 18 }} />
            <div style={{ fontFamily: 'var(--dmsans)', fontSize: 16, fontWeight: 600, color: c.text, lineHeight: 1.3 }}>{block.title}</div>
          </div>
        )}
        {changes.length > 0 && (
          <div style={{ background: c.subtle, border: `1px solid ${c.subtleBorder}`, borderRadius: 9, padding: '12px 14px', marginBottom: 14, fontFamily: 'var(--mono)', fontSize: 12.5, lineHeight: 1.8 }}>
            {changes.map((ch, i) => (
              <div key={i} style={{ color: c.text3 }}>
                {ch.field}: {ch.before != null && <span style={{ color: '#ef4444', textDecoration: 'line-through', opacity: 0.8 }}>{String(ch.before)}</span>}{ch.before != null && ' → '}<span style={{ color: c.text, fontWeight: 600 }}>{String(ch.after)}</span>
              </div>
            ))}
          </div>
        )}
        {body && <div style={{ fontFamily: 'var(--dmsans)', fontSize: 13.5, color: c.text2, lineHeight: 1.55, whiteSpace: 'pre-wrap', marginBottom: 14 }}>{body}</div>}
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          {s === 'done' ? (
            <span style={{ fontFamily: 'var(--mono)', fontSize: 10, letterSpacing: '0.08em', color: '#10b981' }}>✓ DONE</span>
          ) : actions.map((a, i) => (
            <button key={i} type="button" disabled={s === 'running'} onClick={() => onClick(a)}
              style={{ flex: a.style === 'primary' ? 1 : '0 0 auto', minWidth: a.style === 'primary' ? 160 : undefined, height: 44, fontFamily: 'var(--mono)', fontSize: 10, letterSpacing: '0.08em', borderRadius: 9, cursor: s === 'running' ? 'default' : 'pointer', opacity: s === 'running' ? 0.6 : 1, ...btnStyle(a.style) }}>
              {a.copy && copied ? 'COPIED ✓' : (s === 'running' && a.style === 'primary' ? 'APPLYING…' : a.label)}
            </button>
          ))}
        </div>
        {s === 'err' && <div style={{ marginTop: 10, fontFamily: 'var(--mono)', fontSize: 10, color: '#ef4444' }}>{err}</div>}
      </div>
      <div style={{ padding: '10px 18px', borderTop: `1px solid ${c.cardBorder}`, fontFamily: 'var(--mono)', fontSize: 10, letterSpacing: '0.04em', color: c.text4 }}>
        {block.note || 'Nothing executes without explicit human sign-off.'}
      </div>
    </div>
  );
}

// Company-wide announcement DRAFT (SOUL §broadcast). Always confirm-first: the
// user clicks Send to push it to every staff member's daemon (senior roles only,
// enforced server-side by /api/tasks broadcast).
function BlockBroadcast({ block, onBroadcast }) {
  const c = useC();
  const [state, setState] = useState('idle'); // idle | sending | sent | err
  const message = block.message || block.content || '';
  return (
    <div style={{ border: '1px solid rgba(245,158,11,0.3)', borderRadius: 12, overflow: 'hidden' }}>
      <div style={{ padding: '8px 16px', background: 'rgba(245,158,11,0.08)', borderBottom: '1px solid rgba(245,158,11,0.22)' }}>
        <span style={{ fontFamily: 'var(--mono)', fontSize: 9, letterSpacing: '0.12em', color: '#f59e0b' }}>⚡ BROADCAST — DRAFT (CONFIRM TO SEND)</span>
      </div>
      <div style={{ padding: '16px 18px' }}>
        {block.title && <div style={{ fontFamily: 'var(--dmsans)', fontSize: 15, fontWeight: 600, color: c.text, marginBottom: 4 }}>{block.title}</div>}
        {block.audience && <div style={{ fontFamily: 'var(--mono)', fontSize: 9, letterSpacing: '0.08em', color: c.text4, marginBottom: 10 }}>TO: {String(block.audience).toUpperCase()}</div>}
        <div style={{ fontFamily: 'var(--dmsans)', fontSize: 13.5, color: c.text2, lineHeight: 1.55, whiteSpace: 'pre-wrap', marginBottom: 16 }}>{message}</div>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          {state === 'sent' ? (
            <span style={{ fontFamily: 'var(--mono)', fontSize: 9, letterSpacing: '0.1em', color: '#10b981' }}>✓ BROADCAST SENT TO ALL STAFF</span>
          ) : (
            <>
              <button className="wd-btn" style={{ height: 42, padding: '0 18px', fontSize: 9, letterSpacing: '0.1em' }}
                disabled={state === 'sending'}
                onClick={async () => { setState('sending'); const ok = await onBroadcast?.(message); setState(ok ? 'sent' : 'err'); }}>
                {state === 'sending' ? 'SENDING…' : '⚡ SEND TO ALL STAFF'}
              </button>
              {state === 'err' && <span style={{ fontFamily: 'var(--mono)', fontSize: 9, color: '#ef4444' }}>Failed — senior role required</span>}
            </>
          )}
        </div>
      </div>
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

function renderBlock(block, i, { onConfirm, onCancel, onBroadcast, onExec, onExecPlan } = {}) {
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
    case 'action_confirm': return wrap(<BlockActionConfirm block={block} onConfirm={onConfirm} onCancel={onCancel} onExecPlan={onExecPlan} />);
    case 'action_done':    return wrap(<BlockActionDone block={block} />);
    case 'invoice_table':  return wrap(<BlockInvoiceTable block={block} />);
    case 'broadcast':      return wrap(<BlockBroadcast block={block} onBroadcast={onBroadcast} />);
    case 'staged_action':  return wrap(<BlockStagedAction block={block} onExec={onExec} />);
    default:               return wrap(<BlockText block={{ md: typeof block === 'string' ? block : JSON.stringify(block) }} />);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// CHAT API
// ─────────────────────────────────────────────────────────────────────────────

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

// The system prompt is built SERVER-side (api/_lib/prompt.js) from the
// authenticated session — the client only sends messages + the auth token.
// (A legacy direct-browser Anthropic path with a client-built prompt was
// removed here: it bypassed every server-side defense and nothing set its key.)
async function callDaemonAPI({ messages, authToken }) {
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

// Recover a daemon envelope that the model emitted as incomplete/unclosed JSON
// (it then got stored as a raw text block). Mirrors the backend's repair so old
// messages and any edge case render as real blocks instead of raw JSON text.
function recoverDaemonEnvelope(md) {
  if (typeof md !== 'string' || !md.trimStart().startsWith('{') || !md.includes('"blocks"')) return null;
  try { const p = JSON.parse(md); if (p && Array.isArray(p.blocks)) return p.blocks; } catch {}
  let s = md.slice(md.indexOf('{'));
  for (let a = 0; a < 5 && s.length > 1; a++) {
    let inStr = false, esc = false; const st = [];
    for (let i = 0; i < s.length; i++) {
      const ch = s[i];
      if (inStr) { if (esc) esc = false; else if (ch === '\\') esc = true; else if (ch === '"') inStr = false; continue; }
      if (ch === '"') inStr = true; else if (ch === '{' || ch === '[') st.push(ch); else if (ch === '}' || ch === ']') st.pop();
    }
    let r = inStr ? s + '"' : s; r = r.replace(/[,:]\s*$/, '');
    for (let i = st.length - 1; i >= 0; i--) r += st[i] === '{' ? '}' : ']';
    try { const p = JSON.parse(r); if (p && Array.isArray(p.blocks)) return p.blocks; } catch {}
    const lc = Math.max(s.lastIndexOf('}'), s.lastIndexOf(']')); if (lc <= 0) break; s = s.slice(0, lc + 1);
  }
  return null;
}

function dbMsgToDisplay(m) {
  if (m.role === 'user') return { role: 'user', text: m.content };
  try {
    const p = JSON.parse(m.content);
    let blocks = p.blocks || [];
    // Heal a stored message whose single text block is actually an unparsed envelope.
    if (blocks.length === 1 && blocks[0]?.type === 'text') {
      const rec = recoverDaemonEnvelope(blocks[0].md);
      if (rec) blocks = rec;
    }
    return { role: 'daemon', blocks };
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
  const [historyLoaded, setHistoryLoaded] = useState(false);
  const [feedback, setFeedback]       = useState({}); // msg index → 'up'|'down' once rated
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
    if (!authToken) { setHistoryLoaded(true); return; }
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
  }, [authToken]);

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
      const callParams = { messages: [...msgs, userMsg], authToken };
      let result;
      try {
        result = await callDaemonAPI(callParams);
      } catch {
        // One automatic retry after a short pause for transient errors.
        await new Promise(r => setTimeout(r, 1200));
        result = await callDaemonAPI(callParams);
      }
      const { blocks, suggestions: nextSugs } = result;
      setMsgs(m => [...m, { role: 'daemon', blocks: blocks || [] }]);
      setSuggestions(nextSugs || []);
    } catch (e) {
      setError(e.message || 'Something went wrong. Try again.');
    } finally {
      setThinking(false);
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [msgs, authToken, thinking]);

  // Rate the daemon's most recent answer → trains the daemon's style over time
  // (server distills repeated 👎/edits into durable LEARNED PREFERENCES).
  const brainUrl = (import.meta.env.VITE_BRAIN_API_URL || '').replace(/\/$/, '');
  const serverBacked = Boolean(authToken && !brainUrl);
  const sendFeedback = useCallback(async (idx, signal) => {
    if (!serverBacked || feedback[idx]) return;
    setFeedback(f => ({ ...f, [idx]: signal })); // optimistic
    try {
      await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${authToken}` },
        body: JSON.stringify({ action: 'feedback', messageId: 'latest', signal }),
      });
    } catch { /* non-blocking — feedback is best-effort */ }
  }, [serverBacked, feedback, authToken]);

  // Session startup: fires after history is loaded. Fresh session → [SESSION_START]
  // (full boot greeting); returning session with restored history → [SESSION_RESUME]
  // (brief "welcome back" delta, prior transcript passed as conversation context).
  useEffect(() => {
    if (startedRef.current || !authToken || !historyLoaded) return;
    startedRef.current = true;
    setThinking(true);
    const sentinel = hadHistoryRef.current ? '[SESSION_RESUME]' : '[SESSION_START]';
    const params = { messages: [...msgs, { role: 'user', text: sentinel }], authToken };
    callDaemonAPI(params)
      .then(({ blocks, suggestions: sugs }) => {
        setMsgs(m => [...m, { role: 'daemon', blocks: blocks || [] }]);
        setSuggestions(sugs || []);
      })
      .catch(() => {
        // SESSION_RESUME failures are silent — history is already visible and the
        // error would confuse users who haven't done anything wrong.
        if (sentinel === '[SESSION_RESUME]') return;
        setError('Failed to load Daemon. Try refreshing.');
      })
      .finally(() => setThinking(false));
  }, [authToken, historyLoaded]);

  const onConfirmAction = useCallback(async (actionId, exec) => {
    // If the daemon attached an executable spec (and a tool is connected), run it
    // for real via the action executor; otherwise fall back to the chat-confirm flow.
    if (exec?.name) {
      try {
        const r = await fetch('/api/tasks', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${authToken}` },
          body: JSON.stringify({ action: 'execute_action', name: exec.name, params: exec.params || {} }),
        });
        const d = await r.json();
        if (r.ok) {
          setMsgs(m => [...m, { role: 'daemon', blocks: [{ type: 'action_done', summary: `✓ Done — ${exec.name} executed.` }] }]);
          return;
        }
        setMsgs(m => [...m, { role: 'daemon', blocks: [{ type: 'alert', level: 'warning', content: d.error || 'Action failed.' }] }]);
        return;
      } catch {
        // network error → fall through to the conversational confirm
      }
    }
    send(`CONFIRMED — execute ${actionId}`);
  }, [send, authToken]);

  const onCancelAction = useCallback(() => {
    setSuggestions([]);
  }, []);

  // Run a staged action's tool exec (Verify & Apply) via the action executor.
  const onExec = useCallback(async (exec) => {
    if (!exec?.name) return { ok: false, error: 'No action' };
    try {
      const r = await fetch('/api/tasks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}) },
        body: JSON.stringify({ action: 'execute_action', name: exec.name, params: exec.params || {} }),
      });
      const d = await r.json().catch(() => ({}));
      return r.ok ? { ok: true, result: d.result } : { ok: false, error: d.error || `Error ${r.status}` };
    } catch { return { ok: false, error: 'Network error' }; }
  }, [authToken]);

  // Run a MULTI-STEP action plan (one confirm → a sequence of tool calls), then
  // append an action_done summary + an execution-log timeline from the results.
  const onExecPlan = useCallback(async (execs, block) => {
    try {
      const r = await fetch('/api/tasks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}) },
        body: JSON.stringify({ action: 'execute_actions', steps: execs }),
      });
      const d = await r.json().catch(() => ({}));
      const results = Array.isArray(d.results) ? d.results : [];
      const ok = results.filter(x => x.ok).length;
      const now = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      const events = results.map(x => ({ date: now, title: x.label || x.name || 'Step', body: x.ok ? 'Done.' : (x.error || 'Failed'), event_type: x.ok ? 'completion' : 'flag' }));
      const summary = `✓ Executed ${ok}/${results.length} step${results.length === 1 ? '' : 's'}${block?.title ? ` — ${block.title}` : ''}.`;
      setMsgs(m => [...m, { role: 'daemon', blocks: [{ type: 'action_done', summary }, ...(events.length ? [{ type: 'timeline', events }] : [])] }]);
    } catch {
      setMsgs(m => [...m, { role: 'daemon', blocks: [{ type: 'alert', level: 'warning', content: 'Could not execute the plan.' }] }]);
    }
  }, [authToken]);

  // Send a daemon-drafted company-wide broadcast (BlockBroadcast confirm).
  const onBroadcast = useCallback(async (message) => {
    if (!message?.trim()) return false;
    try {
      const r = await fetch('/api/tasks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}) },
        body: JSON.stringify({ action: 'broadcast', message }),
      });
      return r.ok;
    } catch { return false; }
  }, [authToken]);

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
      authToken,
    }).then(({ blocks, suggestions: sugs }) => {
      setMsgs([{ role: 'daemon', blocks: blocks || [] }]);
      setSuggestions(sugs || []);
    }).catch(e => {
      setError(e.message || 'Failed to load Daemon. Try refreshing.');
    }).finally(() => {
      startedRef.current = true;
      setThinking(false);
    });
  }, [thinking, authToken]);

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
                    {(m.blocks || []).map((block, bi) => renderBlock(block, bi, { onConfirm: onConfirmAction, onCancel: onCancelAction, onBroadcast, onExec, onExecPlan }))}
                    {m.text && <Md text={m.text} c={c} />}
                  </div>
                  {/* Rate the latest answer — feeds the daemon's self-improvement loop */}
                  {serverBacked && i === msgs.length - 1 && !thinking && (m.blocks?.length || m.text) && (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 2 }}>
                      {feedback[i] ? (
                        <span style={{ fontFamily: 'var(--mono)', fontSize: 10, color: c.text3, letterSpacing: '0.08em' }}>
                          {feedback[i] === 'up' ? 'THANKS — NOTED' : 'NOTED — I’LL ADJUST'}
                        </span>
                      ) : (
                        <>
                          <button title="Good answer" onClick={() => sendFeedback(i, 'up')}
                            style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 14, opacity: 0.45, padding: 2, lineHeight: 1 }}
                            onMouseEnter={e => e.currentTarget.style.opacity = 1} onMouseLeave={e => e.currentTarget.style.opacity = 0.45}>👍</button>
                          <button title="Needs work" onClick={() => sendFeedback(i, 'down')}
                            style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 14, opacity: 0.45, padding: 2, lineHeight: 1 }}
                            onMouseEnter={e => e.currentTarget.style.opacity = 1} onMouseLeave={e => e.currentTarget.style.opacity = 0.45}>👎</button>
                        </>
                      )}
                    </div>
                  )}
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
  const { profile, loading } = useAuth();

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

  // RequireOnboarded guarantees profile exists and onboarding is done before
  // this component renders, so the only remaining guard is the auth loading state.
  if (loading) {
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

// Brain Skill Library — the "Skills" pillar. Skills the brain has learned and
// passes to every daemon (and the Hermes agent via MCP). Grouped by pillar;
// experience-learned skills are badged so you can see the brain getting smarter.
const PILLAR_LABELS = {
  knowledge: 'Knowledge', research: 'Research', content: 'Content', growth: 'Growth',
  productivity: 'Productivity', devops: 'Ops', memory: 'Memory', crons: 'Cadence',
  soul: 'Identity', self_improvement: 'Self-Improvement', skills: 'Core',
};
function SkillsTab({ token, c, isMobile }) {
  const [skills, setSkills] = useState([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(null);
  const [discovering, setDiscovering] = useState(false);
  const [note, setNote] = useState(null);

  const load = useCallback(() => {
    if (!token) return Promise.resolve();
    return fetch('/api/brain?tab=skills', { headers: { Authorization: `Bearer ${token}` } })
      .then(r => r.json()).then(d => setSkills(d.skills || [])).catch(() => {});
  }, [token]);
  useEffect(() => { load().finally(() => setLoading(false)); }, [load]);

  const discover = async () => {
    setDiscovering(true); setNote(null);
    try {
      const r = await fetch('/api/brain', {
        method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ action: 'discover_skills' }),
      });
      const d = await r.json().catch(() => ({}));
      const added = d.added || [];
      setNote(added.length ? `Learned ${added.length} new skill${added.length > 1 ? 's' : ''}: ${added.map(a => a.name).join(', ')}` : (d.reason === 'cooldown' ? 'Recently discovered — try again later.' : 'No new skills found this time.'));
      await load();
    } catch { setNote('Discovery failed — try again.'); } finally { setDiscovering(false); }
  };

  const learned = skills.filter(s => s.learned_from === 'experience').length;
  const discovered = skills.filter(s => s.learned_from === 'discovered').length;
  const byPillar = {};
  for (const s of skills) (byPillar[s.pillar] ||= []).push(s);

  if (loading) return <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>{Array.from({ length: 5 }).map((_, i) => <SkeletonRow key={i} height={48} />)}</div>;

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, marginBottom: 12 }}>
        <BlockAlert block={{ level: 'info', title: 'THE SKILLS PILLAR', content: `The brain holds ${skills.length} skills and passes the relevant ones to every daemon at runtime — and to the Hermes agent over MCP. ${learned} learned from your approvals, ${discovered} discovered online by the brain itself.` }} />
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
        <button type="button" onClick={discover} disabled={discovering}
          style={{ padding: '9px 16px', borderRadius: 9, background: '#4172f5', border: 'none', color: '#fff', fontFamily: 'var(--inter)', fontSize: 13, fontWeight: 500, cursor: discovering ? 'default' : 'pointer', opacity: discovering ? 0.6 : 1 }}>
          {discovering ? 'Searching the web…' : '✦ Discover skills online'}
        </button>
        {note && <span style={{ fontFamily: 'var(--inter)', fontSize: 13, color: c.text2 }}>{note}</span>}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 20, marginTop: 18 }}>
        {Object.entries(byPillar).map(([pillar, list]) => (
          <div key={pillar}>
            <p style={{ fontFamily: 'var(--mono)', fontSize: 10, color: c.text3, letterSpacing: '0.12em', marginBottom: 9 }}>{(PILLAR_LABELS[pillar] || pillar).toUpperCase()}</p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {list.map(s => (
                <div key={s.id} onClick={() => setOpen(open === s.id ? null : s.id)}
                  style={{ padding: '12px 14px', background: c.card, border: `1px solid ${c.cardBorder}`, borderRadius: 10, cursor: 'pointer' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ fontFamily: 'var(--inter)', fontSize: 14, fontWeight: 500, color: c.text }}>{s.name}</span>
                    {s.learned_from === 'experience' && (
                      <span style={{ fontFamily: 'var(--mono)', fontSize: 8, letterSpacing: '0.06em', color: '#10b981', border: '1px solid rgba(16,185,129,0.35)', borderRadius: 4, padding: '1px 5px' }}>LEARNED</span>
                    )}
                    {s.learned_from === 'discovered' && (
                      <span style={{ fontFamily: 'var(--mono)', fontSize: 8, letterSpacing: '0.06em', color: '#8b5cf6', border: '1px solid rgba(139,92,246,0.4)', borderRadius: 4, padding: '1px 5px' }}>DISCOVERED</span>
                    )}
                    <span style={{ flex: 1 }} />
                    <span style={{ fontFamily: 'var(--mono)', fontSize: 9, color: c.text3 }}>{s.usage_count || 0}×</span>
                  </div>
                  <div style={{ fontFamily: 'var(--inter)', fontSize: 12, color: c.text3, marginTop: 3 }}>{s.trigger_description}</div>
                  {open === s.id && s.body && (
                    <div style={{ fontFamily: 'var(--inter)', fontSize: 13, color: c.text2, marginTop: 9, paddingTop: 9, borderTop: `1px solid ${c.cardBorder}`, whiteSpace: 'pre-wrap', lineHeight: 1.5 }}>
                      {s.body}
                      {s.source_url && <div style={{ marginTop: 8 }}><a href={s.source_url} target="_blank" rel="noreferrer" style={{ fontFamily: 'var(--mono)', fontSize: 11, color: '#4172f5' }}>source ↗</a></div>}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        ))}
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

// ── Knowledge graph tab — layered relationship map (People → Tasks → Risks) ───
function GraphTab({ token, c, isMobile }) {
  const [data, setData] = useState({ nodes: [], edges: [] });
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const r = await fetch('/api/brain?tab=graph', { headers: { Authorization: `Bearer ${token}` } });
      const d = await r.json();
      setData({ nodes: d.nodes || [], edges: d.edges || [] });
    } catch {} finally { setLoading(false); }
  }, [token]);
  useEffect(() => { if (token) load(); }, [token, load]);

  const rebuild = async () => {
    setBusy(true);
    try {
      await fetch('/api/brain', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify({ action: 'build_graph' }) });
      await load();
    } catch {} finally { setBusy(false); }
  };

  const byKey = Object.fromEntries(data.nodes.map(n => [n.node_key, n]));
  const SEV = { critical: '#ef4444', warning: '#f59e0b', info: c.text4 };
  const people = data.nodes.filter(n => n.node_type === 'person');
  const tasks  = data.nodes.filter(n => n.node_type === 'task').slice(0, 10);
  const risks  = data.nodes.filter(n => n.node_type === 'risk')
    .sort((a, b) => ({ critical: 0, warning: 1, info: 2 }[a.meta?.severity] ?? 3) - ({ critical: 0, warning: 1, info: 2 }[b.meta?.severity] ?? 3)).slice(0, 10);
  const patterns = data.nodes.filter(n => n.node_type === 'pattern');

  // Deterministic layout: 3 columns, evenly spaced rows.
  const COL = { person: 95, task: 430, risk: 765 };
  const HALF = 76, NODE_H = 34, ROW = 58, TOP = 26;
  const rows = Math.max(people.length, tasks.length, risks.length, 1);
  const H = TOP * 2 + (rows - 1) * ROW + NODE_H;
  const place = (arr) => { const map = {}; const span = (rows - 1) * ROW; arr.forEach((n, i) => { const y = TOP + NODE_H / 2 + (arr.length === 1 ? span / 2 : (span * i) / Math.max(arr.length - 1, 1)); map[n.node_key] = y; }); return map; };
  const yP = place(people), yT = place(tasks), yR = place(risks);
  const yOf = k => yP[k] ?? yT[k] ?? yR[k];
  const xOf = k => COL[byKey[k]?.node_type] ?? 0;
  const trunc = (s, n) => (s && s.length > n ? s.slice(0, n - 1) + '…' : s || '');

  // Only owns (person→task) + addresses (task→risk) as lines; affects shown on the risk node.
  const flowEdges = data.edges.filter(e => (e.rel === 'owns' || e.rel === 'addresses') && yOf(e.src_key) != null && yOf(e.dst_key) != null);
  const affectsBy = {}; // risk_key → [person labels]
  for (const e of data.edges) if (e.rel === 'affects') (affectsBy[e.src_key] ||= []).push(byKey[e.dst_key]?.label);

  const NodeRect = ({ k, fill, stroke, accent }) => {
    const n = byKey[k]; if (!n) return null;
    const x = xOf(k), y = yOf(k);
    return (
      <g>
        <rect x={x - HALF} y={y - NODE_H / 2} width={HALF * 2} height={NODE_H} rx={7} fill={fill} stroke={stroke} strokeWidth={1} />
        {accent && <rect x={x - HALF} y={y - NODE_H / 2} width={3} height={NODE_H} rx={1.5} fill={accent} />}
        <text x={x - HALF + 10} y={y + 3.5} fontFamily="var(--dmsans)" fontSize={10.5} fill={c.text} >{trunc(n.label, 22)}</text>
      </g>
    );
  };

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14, flexWrap: 'wrap', gap: 8 }}>
        <p style={{ fontFamily: 'var(--dmsans)', fontSize: 13, color: c.text3, lineHeight: 1.5, margin: 0, maxWidth: 560 }}>
          The Brain's relationship map — who <strong style={{ color: '#4172f5' }}>owns</strong> what, what those tasks <strong style={{ color: c.text2 }}>address</strong>, and which risks <strong style={{ color: '#ef4444' }}>affect</strong> whom.
        </p>
        <button type="button" onClick={rebuild} disabled={busy}
          style={{ padding: '7px 14px', background: 'none', border: `1px solid ${c.subtleBorder}`, borderRadius: 8, color: c.text2, fontFamily: 'var(--dmsans)', fontSize: 12.5, cursor: busy ? 'default' : 'pointer', whiteSpace: 'nowrap' }}>
          {busy ? 'Rebuilding…' : '↻ Rebuild graph'}
        </button>
      </div>

      {loading ? (
        <SkeletonRow height={260} />
      ) : data.nodes.length === 0 ? (
        <EmptyState icon="◌" title="Graph not built yet" subtitle="It rebuilds nightly. Click Rebuild graph to generate it now from your team's tasks, findings and patterns." />
      ) : (
        <>
          {/* Column headers */}
          <div style={{ display: 'flex', justifyContent: 'space-between', maxWidth: 880, margin: '0 auto 4px', padding: '0 4px' }}>
            {['PEOPLE', 'WORK', 'RISKS'].map(h => (
              <span key={h} style={{ fontFamily: 'var(--mono)', fontSize: 9, letterSpacing: '0.12em', color: c.text4, flex: 1, textAlign: 'center' }}>{h}</span>
            ))}
          </div>
          <div style={{ width: '100%', overflowX: 'auto', border: `1px solid ${c.cardBorder}`, borderRadius: 12, background: c.subtle }}>
            <svg viewBox={`0 0 860 ${H}`} width="100%" style={{ display: 'block', minWidth: 620 }}>
              {/* edges */}
              {flowEdges.map((e, i) => {
                const x1 = xOf(e.src_key) + HALF, y1 = yOf(e.src_key), x2 = xOf(e.dst_key) - HALF, y2 = yOf(e.dst_key);
                const mx = (x1 + x2) / 2;
                return <path key={i} d={`M ${x1} ${y1} C ${mx} ${y1}, ${mx} ${y2}, ${x2} ${y2}`} fill="none" stroke={e.rel === 'owns' ? 'rgba(65,114,245,0.35)' : c.text4} strokeWidth={1.2} opacity={0.7} />;
              })}
              {/* nodes */}
              {people.map(n => <NodeRect key={n.node_key} k={n.node_key} fill={c.bg} stroke="rgba(65,114,245,0.4)" accent="#4172f5" />)}
              {tasks.map(n => <NodeRect key={n.node_key} k={n.node_key} fill={c.bg} stroke={c.subtleBorder} accent={n.meta?.routed_by_brain ? '#4172f5' : c.text4} />)}
              {risks.map(n => {
                const sev = SEV[n.meta?.severity] || c.text4;
                const x = xOf(n.node_key), y = yOf(n.node_key);
                const aff = (affectsBy[n.node_key] || []).filter(Boolean);
                return (
                  <g key={n.node_key}>
                    <rect x={x - HALF} y={y - NODE_H / 2} width={HALF * 2} height={NODE_H} rx={7} fill={c.bg} stroke={sev} strokeWidth={1} />
                    <circle cx={x - HALF + 9} cy={y - NODE_H / 2 + 9} r={3} fill={sev} />
                    <text x={x - HALF + 18} y={y - 1} fontFamily="var(--dmsans)" fontSize={10} fill={c.text}>{trunc(n.label, 20)}</text>
                    {aff.length > 0 && <text x={x - HALF + 18} y={y + 11} fontFamily="var(--mono)" fontSize={7.5} fill={c.text4}>affects {aff.slice(0, 3).map(a => (a || '').split(' ')[0]).join(', ')}</text>}
                  </g>
                );
              })}
            </svg>
          </div>
          {patterns.length > 0 && (
            <div style={{ marginTop: 14 }}>
              <p style={{ fontFamily: 'var(--mono)', fontSize: 9, letterSpacing: '0.12em', color: c.text4, marginBottom: 8 }}>CROSS-STAFF PATTERNS</p>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 7 }}>
                {patterns.map(p => (
                  <span key={p.node_key} style={{ fontFamily: 'var(--dmsans)', fontSize: 11.5, color: c.text2, background: c.subtle, border: `1px solid ${c.subtleBorder}`, borderRadius: 14, padding: '4px 11px' }}>{trunc(p.label, 40)}</span>
                ))}
              </div>
            </div>
          )}
          <p style={{ fontFamily: 'var(--mono)', fontSize: 9, color: c.text4, marginTop: 10 }}>
            {data.nodes.length} nodes · {data.edges.length} relationships · rebuilt nightly
          </p>
        </>
      )}
    </div>
  );
}

function BrainPage() {
  const c = useC();
  const { isMobile } = useViewport();
  const { token } = useAuth();
  const [activeTab, setActiveTab] = useState('overview');

  const TABS = [
    { key: 'overview',      label: 'OVERVIEW' },
    { key: 'patterns',      label: 'PATTERNS' },
    { key: 'graph',         label: 'GRAPH' },
    { key: 'skills',        label: 'SKILLS' },
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
        {activeTab === 'graph'        && <GraphTab token={token} c={c} isMobile={isMobile} />}
        {activeTab === 'integrations' && <IntegrationsTab c={c} isMobile={isMobile} />}
        {activeTab === 'skills'       && <SkillsTab token={token} c={c} isMobile={isMobile} />}
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

const LOAD_STYLE = {
  low:    { color: '#10b981', label: 'AVAILABLE' },
  medium: { color: '#f59e0b', label: 'MODERATE LOAD' },
  high:   { color: '#ef4444', label: 'HIGH LOAD' },
};

function Initial({ name, color = '#4172f5' }) {
  return (
    <div title={name || ''} style={{ width: 20, height: 20, borderRadius: '50%', background: color, display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'var(--orbitron)', fontSize: 7, fontWeight: 700, color: '#fff', flexShrink: 0 }}>
      {(name || '?').charAt(0)}
    </div>
  );
}

function TaskCard({ task }) {
  const c = useC();
  const ps = PRIORITY_STYLES[task.priority] || PRIORITY_STYLES.P2;
  const assignee = task.assignee?.name || (typeof task.assignee === 'string' ? task.assignee : null);
  const from = task.from_staff?.name;
  return (
    <div style={{ padding: '12px 14px', background: task.blocked ? (c.d ? 'rgba(239,68,68,0.04)' : 'rgba(239,68,68,0.03)') : c.subtle, border: `1px solid ${task.blocked ? 'rgba(239,68,68,0.18)' : task.stale ? 'rgba(245,158,11,0.18)' : c.subtleBorder}`, borderRadius: 9 }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8, marginBottom: 9 }}>
        <span style={{ fontSize: 9, padding: '2px 7px', borderRadius: 5, background: ps.bg, border: `1px solid ${ps.border}`, color: ps.color, fontFamily: 'var(--mono)', letterSpacing: '0.06em', flexShrink: 0, marginTop: 2 }}>{task.priority}</span>
        <span style={{ fontFamily: 'var(--dmsans)', fontSize: 13, color: c.text2, lineHeight: 1.45 }}>{task.title}</span>
      </div>
      {task.routed_by_brain && (
        <div style={{ fontFamily: 'var(--mono)', fontSize: 9, color: '#4172f5', letterSpacing: '0.04em', marginBottom: 8 }}>
          ⤷ ROUTED BY BRAIN · {from || 'Company Brain'} → {assignee || '—'}
        </div>
      )}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
          {(task.blocked || task.stale) && (
            <span style={{ fontFamily: 'var(--mono)', fontSize: 9, color: task.blocked ? '#ef4444' : '#f59e0b', letterSpacing: '0.06em' }}>
              {task.blocked ? '⚠ FLAGGED' : '⏱ STALE'}
            </span>
          )}
          {task.due_date && <span style={{ fontFamily: 'var(--mono)', fontSize: 9, color: c.text4 }}>due {task.due_date}</span>}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          {from && <><Initial name={from} color={c.text4} /><span style={{ color: c.text4, fontSize: 10 }}>→</span></>}
          {assignee && <Initial name={assignee} />}
        </div>
      </div>
    </div>
  );
}

// List view for Tasks (IA §5.5) — flat sortable rows with all fields visible.
function TaskListView({ tasks }) {
  const c = useC();
  const STATUS_LABEL = { todo: 'To Do', pending: 'To Do', delivered: 'To Do', accepted: 'In Progress', in_progress: 'In Progress', flagged: 'Blocked', blocked: 'Blocked', handed_off: 'In Review', completed: 'Done', done: 'Done' };
  const th = { fontFamily: 'var(--mono)', fontSize: 10, letterSpacing: '0.06em', color: c.text4, textAlign: 'left', padding: '0 12px 8px', fontWeight: 600 };
  const td = { fontFamily: 'var(--dmsans)', fontSize: 13, color: c.text, padding: '11px 12px', borderTop: `1px solid ${c.cardBorder}`, verticalAlign: 'middle' };
  return (
    <div style={{ background: c.card, border: `1px solid ${c.cardBorder}`, borderRadius: 12, padding: '14px 8px', overflowX: 'auto' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 640 }}>
        <thead><tr><th style={th}>TASK</th><th style={th}>STATUS</th><th style={th}>PRIORITY</th><th style={th}>DUE</th><th style={th}>SOURCE</th><th style={th}>ASSIGNED BY</th></tr></thead>
        <tbody>
          {tasks.map((t, i) => {
            const ps = PRIORITY_STYLES[t.priority] || PRIORITY_STYLES.P2;
            return (
              <tr key={t.id || i}>
                <td style={{ ...td, color: c.text2 }}>{t.title}</td>
                <td style={td}><span style={{ fontFamily: 'var(--mono)', fontSize: 10, letterSpacing: '0.04em', color: t.blocked ? '#ef4444' : c.text3 }}>{(STATUS_LABEL[t.status] || t.status || '—').toUpperCase()}</span></td>
                <td style={td}><span style={{ fontSize: 9, padding: '2px 7px', borderRadius: 5, background: ps.bg, border: `1px solid ${ps.border}`, color: ps.color, fontFamily: 'var(--mono)', letterSpacing: '0.06em' }}>{t.priority}</span></td>
                <td style={{ ...td, color: t.due_date ? c.text3 : c.text4, fontFamily: 'var(--mono)', fontSize: 11 }}>{t.due_date || '—'}</td>
                <td style={{ ...td, color: c.text3, fontFamily: 'var(--mono)', fontSize: 11 }}>{t.source || '—'}</td>
                <td style={{ ...td, color: c.text3 }}>{t.from_staff?.name || (t.routed_by_brain ? 'Company Brain' : '—')}</td>
              </tr>
            );
          })}
          {tasks.length === 0 && <tr><td style={{ ...td, color: c.text4 }} colSpan={6}>No tasks match this filter.</td></tr>}
        </tbody>
      </table>
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

// ── Cross-daemon: a single pending event tagged to this user ──────────────────
function DaemonEventCard({ ev, onAccept, onFlag, onResolve, busy }) {
  const c = useC();
  const [flagging, setFlagging] = useState(false);
  const [reason, setReason] = useState('');
  const [suggestion, setSuggestion] = useState('');
  const p = ev.payload || {};
  const who = p.source === 'brain' ? 'The Company Brain' : (ev.from_staff?.name || 'A teammate');
  const META = {
    assignment: { accent: '#4172f5', tag: 'ASSIGNMENT', title: `${who} assigned you "${p.title}"`, body: p.brief },
    flag:       { accent: '#ef4444', tag: 'CAPACITY FLAG', title: `${who}'s daemon flagged a capacity risk: "${p.title}"`, body: [p.reason, p.suggestion && `Suggested: ${p.suggestion}`].filter(Boolean).join('\n\n') },
    handoff:    { accent: '#8b5cf6', tag: 'HANDOFF', title: `${who} handed off: "${p.title}"`, body: p.output },
    accepted:   { accent: '#10b981', tag: 'ACCEPTED', title: `${who}'s daemon accepted "${p.title}"`, body: null },
    broadcast:  { accent: '#f59e0b', tag: 'BROADCAST', title: `Company broadcast from ${who}`, body: p.message },
    availability:{ accent: c.text4, tag: 'AVAILABILITY', title: `${who} is now ${p.availability}`, body: p.reason },
  };
  const m = META[ev.type] || { accent: c.text4, tag: ev.type?.toUpperCase(), title: ev.type, body: null };

  return (
    <div style={{ padding: '13px 15px', background: c.subtle, border: `1px solid ${c.subtleBorder}`, borderLeft: `2px solid ${m.accent}`, borderRadius: 9 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
        <span style={{ fontFamily: 'var(--mono)', fontSize: 9, color: m.accent, letterSpacing: '0.1em' }}>{m.tag}</span>
        {ev.payload?.priority && <span style={{ fontFamily: 'var(--mono)', fontSize: 9, color: c.text4 }}>{ev.payload.priority}</span>}
      </div>
      <div style={{ fontFamily: 'var(--dmsans)', fontSize: 13, fontWeight: 500, color: c.text, marginBottom: m.body ? 5 : 0 }}>{m.title}</div>
      {m.body && <div style={{ fontFamily: 'var(--dmsans)', fontSize: 12.5, color: c.text3, lineHeight: 1.5, whiteSpace: 'pre-wrap' }}>{m.body}</div>}

      {ev.type === 'assignment' && !flagging && (
        <div style={{ display: 'flex', gap: 8, marginTop: 11 }}>
          <button disabled={busy} onClick={() => onAccept(ev.task_id)} style={{ padding: '7px 16px', background: '#4172f5', border: 'none', borderRadius: 7, color: '#fff', fontFamily: 'var(--dmsans)', fontSize: 12.5, fontWeight: 500, cursor: busy ? 'default' : 'pointer' }}>Accept</button>
          <button disabled={busy} onClick={() => setFlagging(true)} style={{ padding: '7px 16px', background: 'none', border: `1px solid ${c.subtleBorder}`, borderRadius: 7, color: c.text2, fontFamily: 'var(--dmsans)', fontSize: 12.5, cursor: 'pointer' }}>Flag a capacity risk</button>
          <button disabled={busy} onClick={() => onResolve(ev.id)} style={{ marginLeft: 'auto', padding: '7px 10px', background: 'none', border: 'none', color: c.text4, fontFamily: 'var(--dmsans)', fontSize: 12, cursor: 'pointer' }}>Dismiss</button>
        </div>
      )}
      {ev.type === 'assignment' && flagging && (
        <div style={{ marginTop: 11, display: 'flex', flexDirection: 'column', gap: 8 }}>
          <textarea value={reason} onChange={e => setReason(e.target.value)} placeholder="Why is this a capacity risk? (your daemon sends this back)" rows={2} style={{ width: '100%', padding: '9px 11px', background: c.bg, border: `1px solid ${c.subtleBorder}`, borderRadius: 7, color: c.text, fontFamily: 'var(--dmsans)', fontSize: 12.5, resize: 'vertical', boxSizing: 'border-box' }} />
          <input value={suggestion} onChange={e => setSuggestion(e.target.value)} placeholder="Suggested alternative (optional)" style={{ width: '100%', padding: '9px 11px', background: c.bg, border: `1px solid ${c.subtleBorder}`, borderRadius: 7, color: c.text, fontFamily: 'var(--dmsans)', fontSize: 12.5, boxSizing: 'border-box' }} />
          <div style={{ display: 'flex', gap: 8 }}>
            <button disabled={busy || !reason.trim()} onClick={() => onFlag(ev.task_id, reason, suggestion)} style={{ padding: '7px 16px', background: reason.trim() ? '#ef4444' : c.subtle, border: 'none', borderRadius: 7, color: reason.trim() ? '#fff' : c.text4, fontFamily: 'var(--dmsans)', fontSize: 12.5, fontWeight: 500, cursor: reason.trim() ? 'pointer' : 'default' }}>Send capacity flag</button>
            <button onClick={() => setFlagging(false)} style={{ padding: '7px 12px', background: 'none', border: 'none', color: c.text4, fontFamily: 'var(--dmsans)', fontSize: 12, cursor: 'pointer' }}>Cancel</button>
          </div>
        </div>
      )}
      {ev.type !== 'assignment' && (
        <button disabled={busy} onClick={() => onResolve(ev.id)} style={{ marginTop: 10, padding: '5px 12px', background: 'none', border: `1px solid ${c.subtleBorder}`, borderRadius: 7, color: c.text3, fontFamily: 'var(--dmsans)', fontSize: 12, cursor: 'pointer' }}>Got it</button>
      )}
    </div>
  );
}

// ── Cross-daemon: assign work; surfaces the capacity-risk decision (Scenario 2) ─
function AssignComposer({ members, token, onDone }) {
  const c = useC();
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState('');
  const [brief, setBrief] = useState('');
  const [assignee, setAssignee] = useState('');
  const [priority, setPriority] = useState('P2');
  const [risk, setRisk] = useState(null);   // {capacity, alternatives}
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  const reset = () => { setTitle(''); setBrief(''); setAssignee(''); setPriority('P2'); setRisk(null); setErr(''); };

  const submit = async (toId, force) => {
    setBusy(true); setErr('');
    try {
      const r = await fetch('/api/tasks', {
        method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ action: 'assign', to_user_id: toId, title, brief, priority, force: !!force }),
      });
      const d = await r.json();
      if (!r.ok) { setErr(d.error || 'Could not assign'); return; }
      if (d.outcome === 'risk') { setRisk(d); return; }   // surface decision
      reset(); setOpen(false); onDone();
    } catch { setErr('Network error'); } finally { setBusy(false); }
  };

  if (!open) {
    return (
      <button onClick={() => setOpen(true)} style={{ padding: '8px 16px', background: '#4172f5', border: 'none', borderRadius: 8, color: '#fff', fontFamily: 'var(--dmsans)', fontSize: 13, fontWeight: 500, cursor: 'pointer' }}>
        + Assign via daemon
      </button>
    );
  }

  const canSubmit = title.trim() && assignee && !busy;

  return (
    <div style={{ width: '100%', padding: 16, background: c.subtle, border: `1px solid ${c.subtleBorder}`, borderRadius: 11, marginBottom: 20 }}>
      <div style={{ fontFamily: 'var(--dmsans)', fontSize: 13, fontWeight: 600, color: c.text, marginBottom: 12 }}>Assign work — your daemon checks their capacity first</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
        <input value={title} onChange={e => setTitle(e.target.value)} placeholder="Task title" style={{ padding: '10px 12px', background: c.bg, border: `1px solid ${c.subtleBorder}`, borderRadius: 8, color: c.text, fontFamily: 'var(--dmsans)', fontSize: 13, boxSizing: 'border-box' }} />
        <textarea value={brief} onChange={e => setBrief(e.target.value)} placeholder="Brief / context (becomes the assignee's daemon context)" rows={2} style={{ padding: '10px 12px', background: c.bg, border: `1px solid ${c.subtleBorder}`, borderRadius: 8, color: c.text, fontFamily: 'var(--dmsans)', fontSize: 13, resize: 'vertical', boxSizing: 'border-box' }} />
        <div style={{ display: 'flex', gap: 9 }}>
          <select value={assignee} onChange={e => setAssignee(e.target.value)} style={{ flex: 1, padding: '10px 12px', background: c.bg, border: `1px solid ${c.subtleBorder}`, borderRadius: 8, color: assignee ? c.text : c.text4, fontFamily: 'var(--dmsans)', fontSize: 13 }}>
            <option value="">Assign to…</option>
            {members.map(m => <option key={m.id} value={m.id}>{m.name || m.title || 'Teammate'}</option>)}
          </select>
          <select value={priority} onChange={e => setPriority(e.target.value)} style={{ width: 90, padding: '10px 12px', background: c.bg, border: `1px solid ${c.subtleBorder}`, borderRadius: 8, color: c.text, fontFamily: 'var(--mono)', fontSize: 12 }}>
            {['P0','P1','P2','P3'].map(p => <option key={p} value={p}>{p}</option>)}
          </select>
        </div>
      </div>

      {err && <div style={{ marginTop: 10, fontFamily: 'var(--dmsans)', fontSize: 12.5, color: '#ef4444' }}>{err}</div>}

      {/* Capacity-risk decision surfaced by the assignee's daemon (Scenario 2) */}
      {risk && (
        <div style={{ marginTop: 13, padding: 13, background: 'rgba(239,68,68,0.05)', border: '1px solid rgba(239,68,68,0.25)', borderRadius: 9 }}>
          <div style={{ fontFamily: 'var(--mono)', fontSize: 9, color: '#ef4444', letterSpacing: '0.1em', marginBottom: 6 }}>⚠ ASSIGNMENT RISK DETECTED</div>
          <div style={{ fontFamily: 'var(--dmsans)', fontSize: 12.5, color: c.text2, lineHeight: 1.5, marginBottom: 11 }}>
            {(members.find(m => m.id === assignee)?.name) || 'They'} is at <strong style={{ color: '#ef4444' }}>high load</strong> — {risk.capacity?.reason}. Assigning now risks the deadline. Options:
          </div>
          <button disabled={busy} onClick={() => submit(assignee, true)} style={{ width: '100%', textAlign: 'left', padding: '9px 12px', marginBottom: 7, background: c.bg, border: `1px solid ${c.subtleBorder}`, borderRadius: 7, color: c.text2, fontFamily: 'var(--dmsans)', fontSize: 12.5, cursor: 'pointer' }}>
            Assign anyway — their daemon will flag the overload
          </button>
          {(risk.alternatives || []).filter(a => a.load !== 'high').slice(0, 3).map(a => (
            <button key={a.user_id} disabled={busy} onClick={() => { setAssignee(a.user_id); submit(a.user_id, false); }} style={{ width: '100%', textAlign: 'left', padding: '9px 12px', marginBottom: 7, background: c.bg, border: `1px solid ${c.subtleBorder}`, borderRadius: 7, color: c.text2, fontFamily: 'var(--dmsans)', fontSize: 12.5, cursor: 'pointer' }}>
              Reassign to <strong>{a.name}</strong> <span style={{ color: LOAD_STYLE[a.load]?.color }}>({a.openCount} open · {LOAD_STYLE[a.load]?.label.toLowerCase()})</span>
            </button>
          ))}
        </div>
      )}

      <div style={{ display: 'flex', gap: 8, marginTop: 13 }}>
        {!risk && (
          <button disabled={!canSubmit} onClick={() => submit(assignee, false)} style={{ padding: '8px 18px', background: canSubmit ? '#4172f5' : c.subtle, border: 'none', borderRadius: 8, color: canSubmit ? '#fff' : c.text4, fontFamily: 'var(--dmsans)', fontSize: 13, fontWeight: 500, cursor: canSubmit ? 'pointer' : 'default' }}>
            {busy ? 'Checking capacity…' : 'Assign'}
          </button>
        )}
        <button onClick={() => { reset(); setOpen(false); }} style={{ padding: '8px 14px', background: 'none', border: 'none', color: c.text4, fontFamily: 'var(--dmsans)', fontSize: 13, cursor: 'pointer' }}>Cancel</button>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// CALENDAR — unified Google + Microsoft + Notion-database view
// ─────────────────────────────────────────────────────────────────────────────

const CAL_PROVIDERS = [
  { id: 'google',    label: 'Google Calendar', color: '#1a73e8' },
  { id: 'microsoft', label: 'Microsoft 365',   color: '#0078d4' },
  { id: 'notion',    label: 'Notion (database)', color: '#191919' },
];

async function startOAuth(token, provider) {
  const r = await fetch('/api/workspace/settings', {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ action: 'oauth_start', provider }),
  });
  const d = await r.json().catch(() => ({}));
  if (d.url) window.location.href = d.url;
  else alert(d.error || `${provider} is not configured yet (missing client credentials).`);
}

function CalendarPage() {
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
  const provColor = (p) => (CAL_PROVIDERS.find(x => x.id === p) || {}).color || '#4172f5';

  return (
    <div style={{ padding: isMobile ? '20px 16px' : '28px 32px', overflowY: 'auto', height: '100%', background: c.bg }}>
      <div style={{ maxWidth: 760, margin: '0 auto' }}>
        <p className="wd-label-blue" style={{ marginBottom: 6 }}>SCHEDULING</p>
        <h1 style={{ fontFamily: 'var(--inter)', fontSize: isMobile ? 20 : 22, fontWeight: 600, color: c.text, letterSpacing: '-0.03em', marginBottom: 18 }}>Calendar</h1>

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
              <button type="button" onClick={createNl} style={{ padding: '9px 14px', borderRadius: 8, background: 'rgba(65,114,245,0.1)', border: '1px solid rgba(65,114,245,0.3)', color: '#4172f5', fontFamily: 'var(--dmsans)', fontSize: 13, fontWeight: 600, cursor: 'pointer', whiteSpace: 'nowrap' }}>Create</button>
            </div>
            <div style={{ display: 'flex', background: c.subtle, border: `1px solid ${c.subtleBorder}`, borderRadius: 8, padding: 2 }}>
              {['month', 'week', 'agenda'].map(v => (
                <button key={v} type="button" onClick={() => setView(v)}
                  style={{ padding: '6px 12px', borderRadius: 6, border: 'none', cursor: 'pointer', fontFamily: 'var(--dmsans)', fontSize: 12, fontWeight: 600, textTransform: 'capitalize', background: view === v ? '#4172f5' : 'transparent', color: view === v ? '#fff' : c.text3 }}>{v}</button>
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
                        style={{ ...mkGhostBtn(c, { color: '#4172f5', borderColor: 'rgba(65,114,245,0.3)' }), padding: '5px 10px', fontSize: 11, whiteSpace: 'nowrap', flexShrink: 0 }}>Prepare me</button>
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
function MonthCalendar({ c, events, provColor, onPrepare }) {
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
            style={{ minHeight: 58, borderRadius: 8, padding: 5, background: d ? (isToday(d) ? 'rgba(65,114,245,0.08)' : c.card) : 'transparent', border: d ? `1px solid ${sel === d ? '#4172f5' : isToday(d) ? 'rgba(65,114,245,0.3)' : c.cardBorder}` : 'none', cursor: d && byDay[d] ? 'pointer' : 'default' }}>
            {d && <>
              <div style={{ fontFamily: 'var(--mono)', fontSize: 10, color: isToday(d) ? '#4172f5' : c.text3, fontWeight: isToday(d) ? 700 : 400 }}>{d}</div>
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
              <button type="button" onClick={() => onPrepare(ev)} style={{ ...mkGhostBtn(c, { color: '#4172f5', borderColor: 'rgba(65,114,245,0.3)' }), padding: '5px 10px', fontSize: 11 }}>Prepare me</button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// Week view (IA §5.4) — the next 7 days as columns of events.
function WeekCalendar({ c, events, provColor, fmtTime, onPrepare }) {
  const start = new Date(); start.setHours(0, 0, 0, 0);
  const days = Array.from({ length: 7 }, (_, i) => { const d = new Date(start); d.setDate(start.getDate() + i); return d; });
  const evFor = (d) => events.filter(ev => new Date(ev.start).toDateString() === d.toDateString());
  return (
    <div style={{ display: 'flex', gap: 10, overflowX: 'auto', paddingBottom: 8 }}>
      {days.map((d, i) => {
        const evs = evFor(d);
        return (
          <div key={i} style={{ flex: '0 0 150px', minWidth: 150 }}>
            <p style={{ fontFamily: 'var(--mono)', fontSize: 10, color: i === 0 ? '#4172f5' : c.text3, letterSpacing: '0.08em', marginBottom: 8 }}>{d.toLocaleDateString([], { weekday: 'short', day: 'numeric' }).toUpperCase()}</p>
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

const DAEMON_SCHEDULES = [
  { label: 'Every hour',     cron: '0 * * * *' },
  { label: 'Every 6 hours',  cron: '0 */6 * * *' },
  { label: 'Daily (8am)',    cron: '0 8 * * *' },
  { label: 'Weekly (Mon)',   cron: '0 8 * * 1' },
];

function AutoDaemonsPage() {
  const c = useC();
  const { isMobile } = useViewport();
  const { token } = useAuth();
  const [agents, setAgents] = useState([]);
  const [members, setMembers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [selected, setSelected] = useState(null);   // detail payload
  const [form, setForm] = useState({ name: '', objective: '', schedule: '0 8 * * *' });
  const [daemonTab, setDaemonTab] = useState('mine'); // mine | team (IA §5.2)
  const [shareFor, setShareFor] = useState(null);     // agent being shared

  const api = useCallback(async (body) => {
    const r = await fetch('/api/agents', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify(body) });
    return r.json().catch(() => ({}));
  }, [token]);

  const load = useCallback(async () => {
    try {
      const r = await fetch('/api/agents', { headers: { Authorization: `Bearer ${token}` } });
      const d = await r.json().catch(() => ({}));
      setAgents(d.agents || []);
      setMembers(d.members || []);
    } finally { setLoading(false); }
  }, [token]);
  useEffect(() => { if (token) load(); }, [token, load]);

  const openDetail = async (id) => {
    const r = await fetch(`/api/agents?id=${id}`, { headers: { Authorization: `Bearer ${token}` } });
    setSelected(await r.json().catch(() => null));
  };

  const create = async () => {
    if (!form.name.trim() || !form.objective.trim()) return;
    setBusy(true);
    await api({ action: 'create', kind: 'knowledge', name: form.name.trim(), objective: form.objective.trim(), schedule: form.schedule });
    setForm({ name: '', objective: '', schedule: '0 8 * * *' }); setShowCreate(false);
    await load(); setBusy(false);
  };
  const runNow = async (id) => { setBusy(true); await api({ action: 'run', id }); await load(); if (selected?.agent?.id === id) await openDetail(id); setBusy(false); };
  const toggle = async (a) => { setBusy(true); await api({ action: a.status === 'active' ? 'pause' : 'resume', id: a.id }); await load(); setBusy(false); };
  const decide = async (action, actionId) => { setBusy(true); await api({ action, actionId }); if (selected?.agent?.id) await openDetail(selected.agent.id); setBusy(false); };

  const proposed = (selected?.actions || []).filter(a => a.status === 'proposed');
  const history  = (selected?.actions || []).filter(a => a.status !== 'proposed');

  return (
    <div style={{ padding: isMobile ? '20px 16px' : '28px 32px', overflowY: 'auto', height: '100%', background: c.bg }}>
      <div style={{ maxWidth: 860, margin: '0 auto' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', marginBottom: 8 }}>
          <div>
            <p className="wd-label-blue" style={{ marginBottom: 6 }}>AUTONOMOUS</p>
            <h1 style={{ fontFamily: 'var(--inter)', fontSize: isMobile ? 20 : 22, fontWeight: 600, color: c.text, letterSpacing: '-0.03em' }}>Daemons</h1>
          </div>
          <button type="button" onClick={() => { setShowCreate(s => !s); setSelected(null); }}
            style={{ padding: '9px 16px', borderRadius: 9, background: '#4172f5', border: 'none', color: '#fff', fontFamily: 'var(--inter)', fontSize: 13, fontWeight: 500, cursor: 'pointer' }}>
            {showCreate ? 'Cancel' : '+ New daemon'}
          </button>
        </div>
        <p style={{ fontFamily: 'var(--inter)', fontSize: 13, color: c.text3, marginBottom: 22, maxWidth: 560 }}>
          Autonomous workers that run on a schedule, read your Company Brain, and propose actions for you to approve — like an automation builder, but grounded in what your company already knows.
        </p>

        {/* Create form */}
        {showCreate && (
          <div style={{ background: c.card, border: `1px solid ${c.cardBorder}`, borderRadius: 12, padding: 18, marginBottom: 24 }}>
            <label style={{ fontFamily: 'var(--mono)', fontSize: 10, color: c.text3, letterSpacing: '0.1em' }}>NAME</label>
            <input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder="e.g. Outreach Daemon, Competitor Watch"
              style={{ width: '100%', margin: '6px 0 14px', padding: '10px 12px', borderRadius: 8, background: c.inputBg, border: `1px solid ${c.inputBorder}`, color: c.text, fontFamily: 'var(--inter)', fontSize: 14, boxSizing: 'border-box' }} />
            <label style={{ fontFamily: 'var(--mono)', fontSize: 10, color: c.text3, letterSpacing: '0.1em' }}>MISSION — what should it do, on its own?</label>
            <textarea value={form.objective} onChange={e => setForm(f => ({ ...f, objective: e.target.value }))} rows={3}
              placeholder="e.g. Find mid-market finance teams evaluating Ramp and draft a tailored intro for each."
              style={{ width: '100%', margin: '6px 0 14px', padding: '10px 12px', borderRadius: 8, background: c.inputBg, border: `1px solid ${c.inputBorder}`, color: c.text, fontFamily: 'var(--inter)', fontSize: 14, resize: 'vertical', boxSizing: 'border-box' }} />
            <label style={{ fontFamily: 'var(--mono)', fontSize: 10, color: c.text3, letterSpacing: '0.1em' }}>SCHEDULE</label>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', margin: '8px 0 16px' }}>
              {DAEMON_SCHEDULES.map(s => (
                <button key={s.cron} type="button" onClick={() => setForm(f => ({ ...f, schedule: s.cron }))}
                  style={{ padding: '7px 12px', borderRadius: 8, fontFamily: 'var(--inter)', fontSize: 13, cursor: 'pointer',
                    background: form.schedule === s.cron ? 'rgba(65,114,245,0.12)' : c.stat,
                    border: `1px solid ${form.schedule === s.cron ? '#4172f5' : c.cardBorder}`, color: form.schedule === s.cron ? '#4172f5' : c.text2 }}>
                  {s.label}
                </button>
              ))}
            </div>
            <button type="button" disabled={busy || !form.name.trim() || !form.objective.trim()} onClick={create}
              style={{ padding: '10px 18px', borderRadius: 9, background: '#4172f5', border: 'none', color: '#fff', fontFamily: 'var(--inter)', fontSize: 14, fontWeight: 500, cursor: 'pointer', opacity: (busy || !form.name.trim() || !form.objective.trim()) ? 0.5 : 1 }}>
              {busy ? 'Creating…' : 'Create daemon'}
            </button>
          </div>
        )}

        {/* Detail view */}
        {selected?.agent && (
          <div style={{ background: c.card, border: `1px solid ${c.cardBorder}`, borderRadius: 12, padding: 18, marginBottom: 24 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 6 }}>
              <h2 style={{ fontFamily: 'var(--inter)', fontSize: 17, fontWeight: 600, color: c.text }}>{selected.agent.name}</h2>
              <button type="button" onClick={() => setSelected(null)} style={{ background: 'none', border: 'none', color: c.text3, cursor: 'pointer', fontSize: 18 }}>×</button>
            </div>
            <p style={{ fontFamily: 'var(--inter)', fontSize: 13, color: c.text2, marginBottom: 14 }}>{selected.agent.objective}</p>
            {selected.my_access && selected.my_access !== 'owner' && (
              <p style={{ fontFamily: 'var(--mono)', fontSize: 9, color: '#4172f5', letterSpacing: '0.06em', marginBottom: 12 }}>SHARED WITH YOU · {selected.my_access.toUpperCase()} ACCESS</p>
            )}

            {proposed.length > 0 ? (
              <>
                <p style={{ fontFamily: 'var(--mono)', fontSize: 10, color: c.text3, letterSpacing: '0.12em', marginBottom: 10 }}>PROPOSED ACTIONS — APPROVE TO EXECUTE</p>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
                  {proposed.map(act => (
                    <div key={act.id} style={{ padding: '12px 14px', background: c.stat, border: `1px solid ${c.cardBorder}`, borderRadius: 9 }}>
                      <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 5 }}>
                        <span style={{ fontFamily: 'var(--mono)', fontSize: 8, letterSpacing: '0.08em', color: '#4172f5', textTransform: 'uppercase', border: '1px solid rgba(65,114,245,0.3)', borderRadius: 4, padding: '1px 5px' }}>{act.type}</span>
                        <span style={{ fontFamily: 'var(--inter)', fontSize: 14, fontWeight: 500, color: c.text }}>{act.title}</span>
                      </div>
                      {act.body && <p style={{ fontFamily: 'var(--inter)', fontSize: 13, color: c.text2, margin: '0 0 6px', whiteSpace: 'pre-wrap' }}>{act.body}</p>}
                      {act.rationale && <p style={{ fontFamily: 'var(--inter)', fontSize: 12, color: c.text3, fontStyle: 'italic', margin: '0 0 8px' }}>Why: {act.rationale}</p>}
                      {['user', 'editor', 'owner'].includes(selected.my_access) ? (
                      <div style={{ display: 'flex', gap: 8 }}>
                        <button type="button" disabled={busy} onClick={() => decide('approve_action', act.id)}
                          style={{ padding: '6px 14px', borderRadius: 7, background: '#10b981', border: 'none', color: '#fff', fontFamily: 'var(--inter)', fontSize: 13, cursor: 'pointer' }}>Approve</button>
                        <button type="button" disabled={busy} onClick={() => decide('reject_action', act.id)}
                          style={{ padding: '6px 14px', borderRadius: 7, background: 'transparent', border: `1px solid ${c.cardBorder}`, color: c.text2, fontFamily: 'var(--inter)', fontSize: 13, cursor: 'pointer' }}>Dismiss</button>
                      </div>
                      ) : (
                        <p style={{ fontFamily: 'var(--inter)', fontSize: 12, color: c.text4, margin: 0 }}>Viewer access — approvals go to the daemon's owner.</p>
                      )}
                    </div>
                  ))}
                </div>
              </>
            ) : (
              <p style={{ fontFamily: 'var(--inter)', fontSize: 13, color: c.text3 }}>No actions awaiting approval. Run the daemon to generate proposals.</p>
            )}

            {history.length > 0 && (
              <details style={{ marginTop: 16 }}>
                <summary style={{ fontFamily: 'var(--mono)', fontSize: 10, color: c.text3, letterSpacing: '0.12em', cursor: 'pointer' }}>HISTORY ({history.length})</summary>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 10 }}>
                  {history.map(a => (
                    <div key={a.id} style={{ display: 'flex', gap: 8, alignItems: 'center', fontFamily: 'var(--inter)', fontSize: 13, color: c.text2 }}>
                      <span style={{ color: a.status === 'done' ? '#10b981' : a.status === 'rejected' ? c.text3 : '#ef4444' }}>{a.status === 'done' ? '✓' : a.status === 'rejected' ? '–' : '×'}</span>
                      <span style={{ flex: 1, minWidth: 0, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{a.title}</span>
                      <span style={{ fontFamily: 'var(--mono)', fontSize: 9, color: c.text3 }}>{a.status}</span>
                    </div>
                  ))}
                </div>
              </details>
            )}
          </div>
        )}

        {/* Tabs: My Daemons / Team Daemons (IA §5.2) */}
        <div style={{ display: 'flex', gap: 4, borderBottom: `1px solid ${c.cardBorder}`, marginBottom: 18 }}>
          {[['mine', 'My Daemons'], ['team', 'Team Daemons']].map(([k, label]) => (
            <button key={k} type="button" onClick={() => { setDaemonTab(k); setSelected(null); }}
              style={{ padding: '9px 13px', background: 'none', border: 'none', borderBottom: `2px solid ${daemonTab === k ? '#4172f5' : 'transparent'}`, marginBottom: -1, cursor: 'pointer', fontFamily: 'var(--dmsans)', fontSize: 13, fontWeight: 600, color: daemonTab === k ? '#4172f5' : c.text3 }}>{label}</button>
          ))}
        </div>

        {/* List */}
        {loading ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>{Array.from({ length: 3 }).map((_, i) => <SkeletonRow key={i} height={64} />)}</div>
        ) : (() => {
          const list = agents.filter(a => daemonTab === 'mine' ? a.mine : !a.mine);
          if (list.length === 0) {
            return daemonTab === 'mine'
              ? (!showCreate && <EmptyState icon="◎" title="No daemons yet" subtitle="Create your first autonomous daemon — give it a mission and a schedule, and it will propose brain-grounded actions for you to approve." cta="+ New daemon" onCta={() => setShowCreate(true)} />)
              : <EmptyState icon="◎" title="No team daemons yet" subtitle="When a teammate shares a daemon with you, it will appear here." />;
          }
          return (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {list.map(a => (
              <div key={a.id} style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '14px 16px', background: c.card, border: `1px solid ${selected?.agent?.id === a.id ? '#4172f5' : c.cardBorder}`, borderRadius: 11, cursor: 'pointer' }}
                onClick={() => openDetail(a.id)}>
                <span style={{ width: 9, height: 9, borderRadius: '50%', flexShrink: 0, background: a.status === 'active' ? '#10b981' : c.text4 }} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontFamily: 'var(--inter)', fontSize: 15, fontWeight: 500, color: c.text }}>{a.name}
                    <span style={{ fontFamily: 'var(--mono)', fontSize: 8, color: c.text3, marginLeft: 8, letterSpacing: '0.06em' }}>{a.kind === 'knowledge' ? 'KNOWLEDGE' : 'OUTREACH'}</span>
                    {!a.mine && <span style={{ fontFamily: 'var(--mono)', fontSize: 8, color: '#4172f5', marginLeft: 6, letterSpacing: '0.06em', border: '1px solid rgba(65,114,245,0.3)', borderRadius: 4, padding: '1px 5px' }}>{(a.my_access || 'viewer').toUpperCase()}</span>}
                    {a.mine && a.shares?.length > 0 && <span style={{ fontFamily: 'var(--mono)', fontSize: 8, color: '#10b981', marginLeft: 6, letterSpacing: '0.06em', border: '1px solid rgba(16,185,129,0.3)', borderRadius: 4, padding: '1px 5px' }}>SHARED</span>}
                  </div>
                  <div style={{ fontFamily: 'var(--inter)', fontSize: 12, color: c.text3, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', marginTop: 2 }}>{a.objective}</div>
                </div>
                {a.mine && (
                  <button type="button" onClick={e => { e.stopPropagation(); setShareFor(a); }}
                    style={{ padding: '6px 12px', borderRadius: 7, background: 'rgba(65,114,245,0.08)', border: '1px solid rgba(65,114,245,0.25)', color: '#4172f5', fontFamily: 'var(--inter)', fontSize: 12, cursor: 'pointer', flexShrink: 0 }}>Share</button>
                )}
                {/* User-level access (and above) may trigger a run; viewers cannot. */}
                {(a.mine || ['user', 'editor', 'owner'].includes(a.my_access)) && (
                  <button type="button" disabled={busy} onClick={e => { e.stopPropagation(); runNow(a.id); }}
                    style={{ padding: '6px 12px', borderRadius: 7, background: c.stat, border: `1px solid ${c.cardBorder}`, color: c.text2, fontFamily: 'var(--inter)', fontSize: 12, cursor: 'pointer', flexShrink: 0 }}>Run now</button>
                )}
                {(a.mine || ['editor', 'owner'].includes(a.my_access)) && (
                  <button type="button" disabled={busy} onClick={e => { e.stopPropagation(); toggle(a); }}
                    style={{ padding: '6px 12px', borderRadius: 7, background: 'transparent', border: `1px solid ${c.cardBorder}`, color: c.text3, fontFamily: 'var(--inter)', fontSize: 12, cursor: 'pointer', flexShrink: 0 }}>{a.status === 'active' ? 'Pause' : 'Resume'}</button>
                )}
              </div>
            ))}
          </div>
          );
        })()}
      </div>
      {shareFor && <ShareDaemonDialog c={c} agent={shareFor} members={members} api={api} onClose={() => setShareFor(null)} onChanged={load} />}
    </div>
  );
}

// Share dialog for Team Daemons (IA §5.2.3): add people or company-wide at an
// access level (Viewer/User/Editor/Owner), and revoke existing shares.
function ShareDaemonDialog({ c, agent, members, api, onClose, onChanged }) {
  const [who, setWho] = useState('');         // user_id or 'company'
  const [level, setLevel] = useState('viewer');
  const [busy, setBusy] = useState(false);
  const shares = agent.shares || [];
  const LEVELS = [['viewer', 'Viewer — see it & its output'], ['user', 'User — also run it'], ['editor', 'Editor — also edit config'], ['owner', 'Owner — full control']];
  const add = async () => {
    if (!who) return;
    setBusy(true);
    await api({ action: 'share', id: agent.id, ...(who === 'company' ? { company_wide: true } : { user_id: who }), access_level: level });
    setBusy(false); setWho(''); onChanged?.();
  };
  const revoke = async (s) => {
    setBusy(true);
    await api({ action: 'unshare', id: agent.id, ...(s.company_wide ? { company_wide: true } : { user_id: s.shared_with }) });
    setBusy(false); onChanged?.();
  };
  const ip = { padding: '9px 11px', borderRadius: 8, background: c.subtle, border: `1px solid ${c.subtleBorder}`, color: c.text, fontFamily: 'var(--dmsans)', fontSize: 13, outline: 'none' };
  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 200, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
      <div onClick={e => e.stopPropagation()} style={{ width: 440, maxWidth: '100%', background: c.card, border: `1px solid ${c.cardBorder}`, borderRadius: 14, padding: 20 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
          <h3 style={{ fontFamily: 'var(--inter)', fontSize: 16, fontWeight: 600, color: c.text, margin: 0 }}>Share “{agent.name}”</h3>
          <button type="button" onClick={onClose} style={{ background: 'none', border: 'none', color: c.text3, cursor: 'pointer', fontSize: 20 }}>×</button>
        </div>
        <p style={{ fontFamily: 'var(--dmsans)', fontSize: 12.5, color: c.text3, margin: '0 0 14px' }}>Give people access like a shared doc. You stay the owner.</p>
        <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
          <select value={who} onChange={e => setWho(e.target.value)} style={{ ...ip, flex: 1, cursor: 'pointer' }}>
            <option value="">Add a person…</option>
            <option value="company">Everyone at the company</option>
            {members.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
          </select>
        </div>
        <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
          <select value={level} onChange={e => setLevel(e.target.value)} style={{ ...ip, flex: 1, cursor: 'pointer' }}>
            {LEVELS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
          <button type="button" onClick={add} disabled={busy || !who} style={{ padding: '9px 18px', borderRadius: 8, background: '#4172f5', border: 'none', color: '#fff', fontFamily: 'var(--dmsans)', fontSize: 13, fontWeight: 600, cursor: 'pointer', opacity: busy || !who ? 0.6 : 1 }}>Add</button>
        </div>
        {shares.length > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <p style={{ fontFamily: 'var(--mono)', fontSize: 9.5, letterSpacing: '0.1em', color: c.text4, margin: 0 }}>SHARED WITH</p>
            {shares.map((s, i) => (
              <div key={i} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 11px', background: c.subtle, border: `1px solid ${c.subtleBorder}`, borderRadius: 8 }}>
                <span style={{ fontFamily: 'var(--dmsans)', fontSize: 13, color: c.text }}>{s.name} <span style={{ fontFamily: 'var(--mono)', fontSize: 9, color: c.text4, marginLeft: 4 }}>{s.access_level.toUpperCase()}</span></span>
                <button type="button" onClick={() => revoke(s)} style={{ background: 'none', border: 'none', color: '#ef4444', fontFamily: 'var(--dmsans)', fontSize: 12, cursor: 'pointer' }}>Remove</button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function TasksPage() {
  const c = useC();
  const { isMobile } = useViewport();
  const { token } = useAuth();
  const [data, setData]     = useState(null);
  const [events, setEvents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError]   = useState(null);
  const [busy, setBusy]     = useState(false);
  const [view, setView]     = useState('kanban'); // kanban | list (IA §5.5)
  const [pri, setPri]       = useState('all');

  const load = useCallback(async () => {
    try {
      const [tRes, eRes] = await Promise.all([
        fetch('/api/tasks', { headers: { Authorization: `Bearer ${token}` } }),
        fetch('/api/tasks?events=1', { headers: { Authorization: `Bearer ${token}` } }),
      ]);
      if (!tRes.ok) throw new Error((await tRes.json().catch(() => ({}))).error || 'Failed to load');
      setData(await tRes.json());
      setEvents((await eRes.json().catch(() => ({}))).events || []);
      setError(null);
    } catch (e) { setError(e.message); } finally { setLoading(false); }
  }, [token]);

  useEffect(() => { if (token) load(); }, [token, load]);

  const act = async (body, optimistic) => {
    setBusy(true);
    optimistic?.();
    try {
      await fetch('/api/tasks', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify(body) });
      await load();
    } catch {} finally { setBusy(false); }
  };
  const accept      = (taskId)      => act({ action: 'accept', task_id: taskId });
  const flag        = (taskId, reason, suggestion) => act({ action: 'flag', task_id: taskId, reason, suggestion });
  const resolveEv   = (id)          => act({ action: 'resolve_event', event_id: id }, () => setEvents(prev => prev.filter(e => e.id !== id)));

  const tasks   = data?.tasks || [];
  const members = data?.members || [];
  const cols = { todo: [], inProgress: [], review: [], done: [] };
  const bucket = { todo: 'todo', pending: 'todo', delivered: 'todo', accepted: 'inProgress', in_progress: 'inProgress', flagged: 'review', handed_off: 'review', completed: 'done', done: 'done', blocked: 'review' };
  const normTasks = tasks
    .map(t => ({ ...t, priority: t.priority?.toUpperCase?.() || 'P2', blocked: t.status === 'blocked' || t.status === 'flagged' }))
    .filter(t => pri === 'all' || t.priority === pri);
  for (const t of normTasks) (cols[bucket[t.status] || 'todo']).push(t);
  const total = tasks.length;
  const done  = cols.done.length;
  const pct   = total > 0 ? Math.round((done / total) * 100) : 0;

  return (
    <div style={{ padding: isMobile ? '20px 16px' : '28px 32px', overflowY: 'auto', height: '100%', background: c.bg, transition: 'background 0.2s' }}>
      <div style={{ maxWidth: 1020, margin: '0 auto' }}>
        <div style={{ display: 'flex', alignItems: isMobile ? 'flex-start' : 'flex-end', flexDirection: isMobile ? 'column' : 'row', justifyContent: 'space-between', marginBottom: 20, gap: isMobile ? 12 : 0 }}>
          <div>
            <p className="wd-label-blue" style={{ marginBottom: 6 }}>CROSS-DAEMON TASKS</p>
            <h1 style={{ fontFamily: 'var(--inter)', fontSize: isMobile ? 20 : 22, fontWeight: 600, color: c.text, letterSpacing: '-0.03em' }}>Tasks</h1>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            {/* View toggle (Kanban / List) + priority filter — IA §5.5 */}
            <div style={{ display: 'flex', background: c.subtle, border: `1px solid ${c.subtleBorder}`, borderRadius: 8, padding: 2 }}>
              {['kanban', 'list'].map(v => (
                <button key={v} type="button" onClick={() => setView(v)}
                  style={{ padding: '5px 12px', borderRadius: 6, border: 'none', cursor: 'pointer', fontFamily: 'var(--dmsans)', fontSize: 12, fontWeight: 600, textTransform: 'capitalize',
                    background: view === v ? '#4172f5' : 'transparent', color: view === v ? '#fff' : c.text3 }}>{v}</button>
              ))}
            </div>
            <select value={pri} onChange={e => setPri(e.target.value)}
              style={{ padding: '7px 10px', borderRadius: 8, background: c.subtle, border: `1px solid ${c.subtleBorder}`, color: c.text, fontFamily: 'var(--dmsans)', fontSize: 12.5, cursor: 'pointer', outline: 'none' }}>
              <option value="all">All priorities</option><option value="P0">P0</option><option value="P1">P1</option><option value="P2">P2</option><option value="P3">P3</option>
            </select>
            {total > 0 && (
              <div style={{ padding: '7px 14px', background: c.stat, border: `1px solid ${c.statBorder}`, borderRadius: 9 }}>
                <span style={{ fontFamily: 'var(--mono)', fontSize: 10, color: '#f59e0b', letterSpacing: '0.08em' }}>{done}/{total} · {pct}%</span>
              </div>
            )}
          </div>
        </div>

        {!loading && !error && members.length > 0 && (
          <AssignComposer members={members} token={token} onDone={load} />
        )}

        {/* Cross-daemon events tagged to this user */}
        {events.length > 0 && (
          <div style={{ marginBottom: 28 }}>
            <p style={{ fontFamily: 'var(--mono)', fontSize: 10, color: c.text3, letterSpacing: '0.12em', marginBottom: 11 }}>FROM YOUR TEAM'S DAEMONS</p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
              {events.map(ev => (
                <DaemonEventCard key={ev.id} ev={ev} busy={busy} onAccept={accept} onFlag={flag} onResolve={resolveEv} />
              ))}
            </div>
          </div>
        )}

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
          <EmptyState icon="✓" title="No tasks yet" subtitle="Assign work via your daemon above, or connect Jira/Linear." />
        ) : view === 'list' ? (
          <TaskListView tasks={normTasks} />
        ) : (
          <div style={{ display: 'flex', gap: 16, overflowX: isMobile ? 'auto' : 'visible', paddingBottom: isMobile ? 16 : 0 }}>
            {[
              { title: 'TO DO',       tasks: cols.todo },
              { title: 'IN PROGRESS', tasks: cols.inProgress },
              { title: 'IN REVIEW',   tasks: cols.review },
              { title: 'DONE',        tasks: cols.done },
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
  const applyDraft = useCallback((item) => {
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

  // Self-improvement code proposals: approve (→ file a GitHub issue via the
  // workspace's OAuth connection) or dismiss. Routed here by the brain.
  const [proposalState, setProposalState] = useState({}); // id → filing|filed|dismissed|err:msg
  const codeProposalAct = useCallback(async (item, action) => {
    setProposalState(s => ({ ...s, [item.id]: action === 'file_code_issue' ? 'filing' : 'dismissing' }));
    try {
      const r = await fetch('/api/brain', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify({ action, itemId: item.id }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) { setProposalState(s => ({ ...s, [item.id]: 'err:' + (d.error || r.status) })); return; }
      setProposalState(s => ({ ...s, [item.id]: action === 'file_code_issue' ? 'filed' : 'dismissed' }));
      markRead(item.id);
    } catch { setProposalState(s => ({ ...s, [item.id]: 'err:network' })); }
  }, [token, markRead]);

  // Tabs per IA §5.6: All · Approvals · Messages · Broadcasts · Alerts.
  const FILTERS = [
    { key: 'all',        label: 'ALL',        fn: () => true },
    { key: 'approvals',  label: 'APPROVALS',  fn: i => i.type === 'approval' || i.metadata?.event_type === 'approval' || i.metadata?.needs_approval },
    { key: 'messages',   label: 'MESSAGES',   fn: i => i.type === 'message' || ['assignment', 'accepted', 'flag', 'availability'].includes(i.metadata?.event_type) },
    { key: 'broadcasts', label: 'BROADCASTS', fn: i => i.type === 'broadcast' || i.metadata?.event_type === 'broadcast' },
    { key: 'alerts',     label: 'ALERTS',     fn: i => !!i.level || i.type === 'alert' || !!i.metadata?.severity },
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
              const isCodeProposal = !!item.metadata?.code_proposal;
              const ps             = proposalState[item.id];
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
                          <div style={{ fontFamily: 'var(--mono)', fontSize: 9, letterSpacing: '0.1em', color: '#4172f5', marginBottom: 7 }}>{isCodeProposal ? '⚙ CODE PROPOSAL — REVIEW' : '✎ DRAFT — READY TO POST'}</div>
                          <div style={{ fontFamily: 'var(--dmsans)', fontSize: 13.5, color: c.text, lineHeight: 1.55, whiteSpace: 'pre-wrap' }}>{item.draft}</div>
                          <div style={{ marginTop: 11, display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                            {isCodeProposal ? (
                              ps === 'filed' ? <span style={{ fontFamily: 'var(--mono)', fontSize: 9, letterSpacing: '0.08em', color: '#22c55e' }}>✓ GITHUB ISSUE FILED</span>
                              : ps === 'dismissed' ? <span style={{ fontFamily: 'var(--mono)', fontSize: 9, letterSpacing: '0.08em', color: c.text4 }}>DISMISSED</span>
                              : (<>
                                  <button type="button" disabled={ps === 'filing'} onClick={(e) => { e.stopPropagation(); codeProposalAct(item, 'file_code_issue'); }}
                                    style={{ fontFamily: 'var(--mono)', fontSize: 9, letterSpacing: '0.08em', color: '#fff', background: '#4172f5', border: 'none', borderRadius: 6, padding: '6px 11px', cursor: ps === 'filing' ? 'default' : 'pointer', opacity: ps === 'filing' ? 0.6 : 1 }}>
                                    {ps === 'filing' ? 'FILING…' : '✓ APPROVE & FILE ISSUE'}
                                  </button>
                                  <button type="button" onClick={(e) => { e.stopPropagation(); codeProposalAct(item, 'dismiss_code_proposal'); }}
                                    style={{ fontFamily: 'var(--mono)', fontSize: 9, letterSpacing: '0.08em', color: c.text3, background: 'none', border: `1px solid ${c.cardBorder}`, borderRadius: 6, padding: '6px 11px', cursor: 'pointer' }}>
                                    DISMISS
                                  </button>
                                  {typeof ps === 'string' && ps.startsWith('err:') && <span style={{ fontFamily: 'var(--mono)', fontSize: 9, color: '#ef4444' }}>{ps.slice(4)}</span>}
                                </>)
                            ) : (<>
                              <button type="button" onClick={(e) => { e.stopPropagation(); applyDraft(item); }}
                                style={{ fontFamily: 'var(--mono)', fontSize: 9, letterSpacing: '0.08em', color: '#fff', background: '#4172f5', border: 'none', borderRadius: 6, padding: '6px 11px', cursor: 'pointer' }}>
                                ✎ REFINE IN DAEMON
                              </button>
                              <button type="button" onClick={(e) => { e.stopPropagation(); copyDraft(item); }}
                                style={{ fontFamily: 'var(--mono)', fontSize: 9, letterSpacing: '0.08em', color: c.text3, background: 'none', border: `1px solid ${c.cardBorder}`, borderRadius: 6, padding: '6px 11px', cursor: 'pointer' }}>
                                {copiedId === item.id ? 'COPIED ✓' : 'COPY'}
                              </button>
                            </>)}
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

const SETTINGS_TABS = [
  { id: 'workspace', label: 'Workspace' },
  { id: 'billing',   label: 'Billing & Plan' },
  { id: 'ai',        label: 'AI & Model' },
  { id: 'security',  label: 'Security' },
  { id: 'notifs',    label: 'Notifications' },
  { id: 'data',      label: 'Data' },
  { id: 'danger',    label: 'Danger Zone' },
];

function SettingsPage() {
  const c = useC();
  const { token } = useAuth();
  const [tab, setTab]         = useState('workspace');
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

        <div style={{ marginBottom: 22 }}>
          <p className="wd-label-blue" style={{ marginBottom: 6 }}>SETTINGS</p>
          <h1 style={{ fontFamily: 'var(--inter)', fontSize: 24, fontWeight: 700, color: c.text, margin: 0, letterSpacing: '-0.03em' }}>Settings</h1>
        </div>

        {/* Tab bar (IA §8) */}
        <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', borderBottom: `1px solid ${c.cardBorder}`, marginBottom: 28 }}>
          {SETTINGS_TABS.map(t => (
            <button key={t.id} type="button" onClick={() => setTab(t.id)}
              style={{ padding: '9px 13px', background: 'none', border: 'none', borderBottom: `2px solid ${tab === t.id ? '#4172f5' : 'transparent'}`, marginBottom: -1, cursor: 'pointer', fontFamily: 'var(--dmsans)', fontSize: 13, fontWeight: 600, color: tab === t.id ? '#4172f5' : c.text3 }}>{t.label}</button>
          ))}
        </div>

        {tab === 'workspace' && <WorkspaceSettings c={c} token={token} />}
        {tab === 'billing'   && <BillingSettings c={c} />}
        {tab === 'security'  && <SecuritySettings c={c} />}
        {tab === 'notifs'    && <WorkspaceNotifSettings c={c} token={token} />}
        {tab === 'data'      && <DataSettings c={c} />}
        {tab === 'danger'    && <DangerZoneSettings c={c} token={token} />}

        {tab === 'ai' && <>
        <p style={{ fontFamily: 'var(--dmsans)', fontSize: 14, color: c.text3, margin: '0 0 22px', lineHeight: 1.6 }}>
          Connect any AI provider. Your whole team shares these keys — no per-user setup.
        </p>

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
        </>}
      </div>
    </div>
  );
}

// ── Settings tab bodies (IA §8) ───────────────────────────────────────────────
function SettingsCard({ c, children }) {
  return <div style={{ background: c.card, border: `1px solid ${c.cardBorder}`, borderRadius: 12, padding: 20, display: 'flex', flexDirection: 'column', gap: 14 }}>{children}</div>;
}
function SettingsRow({ c, label, children }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
      <label style={{ fontFamily: 'var(--dmsans)', fontSize: 12, fontWeight: 600, color: c.text3 }}>{label}</label>
      {children}
    </div>
  );
}
function settingsInput(c) {
  return { padding: '10px 12px', borderRadius: 8, background: c.subtle, border: `1px solid ${c.subtleBorder}`, color: c.text, fontFamily: 'var(--dmsans)', fontSize: 14, outline: 'none', width: '100%', boxSizing: 'border-box' };
}
function SaveBtn({ c, busy, onClick, label = 'Save changes' }) {
  return <button type="button" onClick={onClick} disabled={busy} style={{ padding: '9px 20px', borderRadius: 8, cursor: busy ? 'default' : 'pointer', background: '#4172f5', border: '1px solid #4172f5', color: '#fff', fontFamily: 'var(--dmsans)', fontSize: 13, fontWeight: 600, opacity: busy ? 0.6 : 1, alignSelf: 'flex-start' }}>{busy ? 'Saving…' : label}</button>;
}
function InfoBanner({ c, text }) {
  return <div style={{ padding: '12px 14px', borderRadius: 9, background: 'rgba(65,114,245,0.07)', border: '1px solid rgba(65,114,245,0.2)', fontFamily: 'var(--dmsans)', fontSize: 12.5, color: c.text3, lineHeight: 1.55 }}>{text}</div>;
}

const TIMEZONES = ['UTC', 'Africa/Lagos', 'America/New_York', 'America/Los_Angeles', 'Europe/London', 'Europe/Berlin', 'Asia/Dubai', 'Asia/Kolkata', 'Asia/Singapore'];

function WorkspaceSettings({ c, token }) {
  const [f, setF] = useState({ name: '', timezone: '', email_domain: '', default_member_level: 1 });
  const [busy, setBusy] = useState(false);
  const [ok, setOk] = useState(false);
  useEffect(() => {
    fetch('/api/workspace/settings?workspace=true', { headers: { Authorization: `Bearer ${token}` } })
      .then(r => r.json()).then(d => setF({ name: d.name || '', timezone: d.timezone || 'UTC', email_domain: d.email_domain || '', default_member_level: d.default_member_level ?? 1 })).catch(() => {});
  }, [token]);
  const save = async () => {
    setBusy(true); setOk(false);
    const r = await fetch('/api/workspace/settings', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify({ action: 'update_workspace', ...f }) }).catch(() => null);
    setBusy(false); if (r?.ok) setOk(true);
  };
  const ip = settingsInput(c);
  return (
    <SettingsCard c={c}>
      {ok && <InfoBanner c={c} text="✓ Workspace settings saved." />}
      <SettingsRow c={c} label="Company name"><input value={f.name} onChange={e => setF(s => ({ ...s, name: e.target.value }))} style={ip} /></SettingsRow>
      <SettingsRow c={c} label="Work email domain — auto-approves invite links from the same domain"><input value={f.email_domain} onChange={e => setF(s => ({ ...s, email_domain: e.target.value }))} placeholder="acmecorp.com" style={ip} /></SettingsRow>
      <SettingsRow c={c} label="Timezone — used for scheduling daemons & calendar"><select value={f.timezone} onChange={e => setF(s => ({ ...s, timezone: e.target.value }))} style={{ ...ip, cursor: 'pointer' }}>{TIMEZONES.map(t => <option key={t} value={t}>{t}</option>)}</select></SettingsRow>
      <SettingsRow c={c} label="Default daemon level for new members"><select value={f.default_member_level} onChange={e => setF(s => ({ ...s, default_member_level: Number(e.target.value) }))} style={{ ...ip, cursor: 'pointer' }}><option value={1}>Level 1 — Copilot (recommended)</option><option value={2}>Level 2 — Assistant</option><option value={3}>Level 3 — Autonomous</option></select></SettingsRow>
      <SaveBtn c={c} busy={busy} onClick={save} />
    </SettingsCard>
  );
}

function BillingSettings({ c }) {
  const PLANS = [
    ['Free', 'WorkDaemon-hosted · 50k tokens/mo · 1 integration · read-only (L1)'],
    ['Pro', 'BYOK · all integrations · L1 + L2'],
    ['Enterprise', 'BYOK/BYOS · L1–L3 · SSO · custom integrations'],
  ];
  return (
    <SettingsCard c={c}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <span style={{ fontFamily: 'var(--dmsans)', fontSize: 14, fontWeight: 700, color: c.text }}>Current plan</span>
        <span style={{ fontFamily: 'var(--mono)', fontSize: 10, letterSpacing: '0.06em', color: '#10b981', border: '1px solid rgba(16,185,129,0.3)', borderRadius: 6, padding: '3px 9px' }}>FREE</span>
      </div>
      {PLANS.map(([n, d]) => (
        <div key={n} style={{ padding: '12px 14px', background: c.subtle, border: `1px solid ${c.subtleBorder}`, borderRadius: 9 }}>
          <div style={{ fontFamily: 'var(--dmsans)', fontSize: 13.5, fontWeight: 600, color: c.text }}>{n}</div>
          <div style={{ fontFamily: 'var(--dmsans)', fontSize: 12.5, color: c.text3, marginTop: 3 }}>{d}</div>
        </div>
      ))}
      <InfoBanner c={c} text="In-app checkout & invoices arrive when billing goes live (Stripe). For now, all tiers run on your own provider keys (BYOK) configured in the AI & Model tab." />
    </SettingsCard>
  );
}

function SecuritySettings({ c }) {
  return (
    <SettingsCard c={c}>
      <SettingsRow c={c} label="Single sign-on (SSO)"><InfoBanner c={c} text="Enterprise tier. Provider metadata + callback URL configured here once your IdP (Okta / Azure AD / Google) is connected." /></SettingsRow>
      <SettingsRow c={c} label="Bring your own store (BYOS)"><InfoBanner c={c} text="Point the Company Brain at your own vector DB (Qdrant / Weaviate / Pinecone / pgvector) with a connection string. Available on Enterprise." /></SettingsRow>
      <SettingsRow c={c} label="Enforce 2FA"><InfoBanner c={c} text="Require two-factor auth for all workspace members. Coming with the auth hardening release." /></SettingsRow>
    </SettingsCard>
  );
}

function WorkspaceNotifSettings({ c, token }) {
  const [f, setF] = useState({ broadcast_perms: 'admins', digest: 'off' });
  const ip = settingsInput(c);
  return (
    <SettingsCard c={c}>
      <SettingsRow c={c} label="Who can send company-wide broadcasts"><select value={f.broadcast_perms} onChange={e => setF(s => ({ ...s, broadcast_perms: e.target.value }))} style={{ ...ip, cursor: 'pointer' }}><option value="admins">Admins only</option><option value="all">All members</option></select></SettingsRow>
      <SettingsRow c={c} label="Digest mode — batch alerts instead of real-time"><select value={f.digest} onChange={e => setF(s => ({ ...s, digest: e.target.value }))} style={{ ...ip, cursor: 'pointer' }}><option value="off">Off (real-time)</option><option value="hourly">Hourly</option><option value="daily">Daily</option></select></SettingsRow>
      <InfoBanner c={c} text="Per-member alert toggles & quiet hours live on each member's Profile. Workspace-wide channels & digest scheduling apply on top." />
    </SettingsCard>
  );
}

function DataSettings({ c }) {
  return (
    <SettingsCard c={c}>
      <SettingsRow c={c} label="Data retention"><InfoBanner c={c} text="Indexed Brain content and audit logs are retained while your workspace is active. On cancellation a 90-day grace period applies before deletion." /></SettingsRow>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <button type="button" disabled title="Available on paid tiers" style={{ ...mkGhostBtn(c), padding: '9px 14px', fontSize: 13, opacity: 0.55, cursor: 'not-allowed' }}>Export company data</button>
        <button type="button" disabled title="Requires typed confirmation; enabled with billing" style={{ ...mkGhostBtn(c, { color: '#ef4444', borderColor: 'rgba(239,68,68,0.25)' }), padding: '9px 14px', fontSize: 13, opacity: 0.55, cursor: 'not-allowed' }}>Purge Brain data</button>
      </div>
    </SettingsCard>
  );
}

function DangerZoneSettings({ c }) {
  return (
    <div style={{ background: c.card, border: '1px solid rgba(239,68,68,0.3)', borderRadius: 12, padding: 20, display: 'flex', flexDirection: 'column', gap: 14 }}>
      <InfoBanner c={c} text="These actions are irreversible. Workspace transfer and deletion require typed confirmation and are gated behind admin auth — wired up with the billing/ownership release so they can't be triggered by accident." />
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <button type="button" disabled style={{ ...mkGhostBtn(c), padding: '9px 14px', fontSize: 13, opacity: 0.55, cursor: 'not-allowed' }}>Transfer ownership</button>
        <button type="button" disabled style={{ padding: '9px 14px', borderRadius: 8, background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.3)', color: '#ef4444', fontFamily: 'var(--dmsans)', fontSize: 13, fontWeight: 600, opacity: 0.55, cursor: 'not-allowed' }}>Delete workspace</button>
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
// SKILLS — capability library (IA §5.3). Attachable to every Daemon.
// ─────────────────────────────────────────────────────────────────────────────
function SkillsPage() {
  const c = useC();
  const { isMobile } = useViewport();
  const { token } = useAuth();
  const [skills, setSkills]   = useState([]);
  const [loading, setLoading] = useState(true);
  const [adding, setAdding]   = useState(false);
  const [form, setForm]       = useState({ name: '', trigger_description: '' });
  const [busy, setBusy]       = useState(false);
  const [banner, setBanner]   = useState(null);

  const load = useCallback(async () => {
    if (!token) return;
    try {
      const r = await fetch('/api/brain?tab=skills', { headers: { Authorization: `Bearer ${token}` } });
      const d = await r.json();
      setSkills(d.skills || []);
    } catch {}
    setLoading(false);
  }, [token]);
  useEffect(() => { load(); }, [load]);

  const save = async () => {
    if (!form.name.trim()) return;
    setBusy(true);
    try {
      const r = await fetch('/api/brain', {
        method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ action: 'add_skill', name: form.name, trigger_description: form.trigger_description }),
      });
      const d = await r.json();
      if (r.ok) { setAdding(false); setForm({ name: '', trigger_description: '' }); setBanner({ ok: true, text: `Added “${d.skill?.name}”.` }); load(); }
      else setBanner({ ok: false, text: d.error === 'Admin only' ? 'Only workspace admins can add shared skills.' : (d.error || 'Could not add skill.') });
    } catch { setBanner({ ok: false, text: 'Network error.' }); }
    setBusy(false);
  };

  // Group by category so the library reads as sections (IA §5.3 grid).
  const groups = {};
  for (const s of skills) { const k = s.category || s.pillar || 'General'; (groups[k] = groups[k] || []).push(s); }
  const cats = Object.keys(groups).sort();

  const srcBadge = (s) => s.learned_from === 'custom' ? { t: 'CUSTOM', col: '#a855f7' }
    : s.learned_from === 'web' || s.source_url ? { t: 'LEARNED', col: '#4172f5' }
    : { t: 'BUILT-IN', col: c.text4 };

  return (
    <div style={{ padding: isMobile ? '20px 16px' : '28px 32px', overflowY: 'auto', height: '100%', background: c.bg, transition: 'background 0.2s' }}>
      <div style={{ maxWidth: 980, margin: '0 auto' }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>
          <div>
            <p className="wd-label-blue" style={{ marginBottom: 6 }}>CAPABILITIES</p>
            <h1 style={{ fontFamily: 'var(--inter)', fontSize: isMobile ? 20 : 24, fontWeight: 700, color: c.text, margin: 0, letterSpacing: '-0.03em' }}>Skills</h1>
            <p style={{ fontFamily: 'var(--dmsans)', fontSize: 14, color: c.text3, marginTop: 6, lineHeight: 1.6, maxWidth: 600 }}>
              Reusable capabilities your Daemons draw on — personal and autonomous. The Company Brain keeps this library sharp and applies the right skill automatically per task.
            </p>
          </div>
          <button type="button" onClick={() => { setAdding(a => !a); setBanner(null); }}
            style={{ padding: '9px 16px', borderRadius: 9, cursor: 'pointer', whiteSpace: 'nowrap', flexShrink: 0,
              background: 'rgba(65,114,245,0.1)', border: '1px solid rgba(65,114,245,0.3)',
              fontFamily: 'var(--dmsans)', fontSize: 13, fontWeight: 600, color: '#4172f5' }}>
            + Custom skill
          </button>
        </div>

        {banner && (
          <div style={{ marginTop: 16, padding: '11px 14px', borderRadius: 9, fontFamily: 'var(--dmsans)', fontSize: 13,
            background: banner.ok ? 'rgba(16,185,129,0.08)' : 'rgba(239,68,68,0.08)',
            border: `1px solid ${banner.ok ? 'rgba(16,185,129,0.3)' : 'rgba(239,68,68,0.3)'}`,
            color: banner.ok ? '#10b981' : '#ef4444' }}>{banner.ok ? '✓ ' : '✗ '}{banner.text}</div>
        )}

        {adding && (
          <div style={{ marginTop: 16, padding: 16, background: c.card, border: `1px solid ${c.cardBorder}`, borderRadius: 12, display: 'flex', flexDirection: 'column', gap: 10 }}>
            <input autoFocus value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder="Skill name — e.g. Weekly metrics digest"
              style={{ padding: '10px 12px', borderRadius: 8, background: c.subtle, border: `1px solid ${c.subtleBorder}`, color: c.text, fontFamily: 'var(--dmsans)', fontSize: 14, outline: 'none' }} />
            <textarea value={form.trigger_description} onChange={e => setForm(f => ({ ...f, trigger_description: e.target.value }))} rows={3}
              placeholder="What it does and when to use it — e.g. Every Friday, check Linear for overdue tickets and draft a message to the PM."
              style={{ padding: '10px 12px', borderRadius: 8, background: c.subtle, border: `1px solid ${c.subtleBorder}`, color: c.text, fontFamily: 'var(--dmsans)', fontSize: 14, outline: 'none', resize: 'vertical' }} />
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button type="button" onClick={() => setAdding(false)} style={{ ...mkGhostBtn(c), padding: '8px 14px', fontSize: 13 }}>Cancel</button>
              <button type="button" onClick={save} disabled={busy || !form.name.trim()}
                style={{ padding: '8px 18px', borderRadius: 8, cursor: busy ? 'default' : 'pointer', background: '#4172f5', border: '1px solid #4172f5', color: '#fff', fontFamily: 'var(--dmsans)', fontSize: 13, fontWeight: 600, opacity: busy || !form.name.trim() ? 0.6 : 1 }}>
                {busy ? 'Saving…' : 'Add skill'}
              </button>
            </div>
          </div>
        )}

        {loading ? (
          <div style={{ marginTop: 22, display: 'grid', gridTemplateColumns: isMobile ? '1fr' : 'repeat(3, 1fr)', gap: 12 }}>
            {Array.from({ length: 6 }).map((_, i) => <SkeletonRow key={i} height={120} />)}
          </div>
        ) : skills.length === 0 ? (
          <div style={{ marginTop: 40, textAlign: 'center' }}>
            <p style={{ fontFamily: 'var(--dmsans)', fontSize: 15, color: c.text3 }}>No skills yet — add a custom one to get started.</p>
          </div>
        ) : cats.map(cat => (
          <div key={cat} style={{ marginTop: 26 }}>
            <p className="wd-label-blue" style={{ marginBottom: 10 }}>{cat.toUpperCase()}</p>
            <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : 'repeat(3, 1fr)', gap: 12 }}>
              {groups[cat].map(s => {
                const b = srcBadge(s);
                return (
                  <div key={s.id} style={{ padding: 15, background: c.card, border: `1px solid ${c.cardBorder}`, borderRadius: 12, display: 'flex', flexDirection: 'column', gap: 8 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
                      <div style={{ width: 30, height: 30, borderRadius: 8, background: 'rgba(65,114,245,0.1)', border: '1px solid rgba(65,114,245,0.25)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, color: '#4172f5' }}>
                        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><path d="M14.7 6.3a1 1 0 000 1.4l1.6 1.6a1 1 0 001.4 0l3.77-3.77a6 6 0 01-7.94 7.94l-6.91 6.91a2.12 2.12 0 01-3-3l6.91-6.91a6 6 0 017.94-7.94l-3.76 3.76z" /></svg>
                      </div>
                      <div style={{ fontFamily: 'var(--dmsans)', fontSize: 14, fontWeight: 600, color: c.text, lineHeight: 1.2 }}>{s.name}</div>
                    </div>
                    <div style={{ fontFamily: 'var(--dmsans)', fontSize: 12.5, color: c.text3, lineHeight: 1.5, flex: 1 }}>{s.trigger_description || '—'}</div>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                      <span style={{ fontFamily: 'var(--mono)', fontSize: 9, letterSpacing: '0.06em', color: b.col, border: `1px solid ${b.col}33`, borderRadius: 5, padding: '2px 6px' }}>{b.t}</span>
                      <span style={{ fontFamily: 'var(--mono)', fontSize: 9.5, color: c.text4 }}>{s.usage_count > 0 ? `used ${s.usage_count}×` : 'ready'}</span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// PROFILE — identity + daemon config + notifications + security (IA §7)
// ─────────────────────────────────────────────────────────────────────────────
const PERM_LABELS = { 1: 'Copilot — reads, summarises, suggests', 2: 'Assistant — drafts actions for your approval', 3: 'Autonomous — executes and reports back' };
const ROLE_TYPES = ['CEO/Founder', 'PM', 'Developer', 'Designer', 'HR', 'Finance', 'Sales', 'Other'];
const ALERT_TYPES = [
  ['task_assigned', 'Task assigned to me'],
  ['action_done', 'Daemon action completed'],
  ['broadcast', 'Broadcast received'],
  ['approval', 'Approval needed'],
  ['proactive', 'Proactive alert flagged'],
];

function ProfileField({ label, children }) {
  const c = useC();
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
      <label style={{ fontFamily: 'var(--dmsans)', fontSize: 12, fontWeight: 600, color: c.text3 }}>{label}</label>
      {children}
    </div>
  );
}

function ProfilePage() {
  const c = useC();
  const { isMobile } = useViewport();
  const navigate = useNavigate();
  const { user, profile, token, refreshProfile } = useAuth();

  const inputSt = { padding: '10px 12px', borderRadius: 8, background: c.subtle, border: `1px solid ${c.subtleBorder}`, color: c.text, fontFamily: 'var(--dmsans)', fontSize: 14, outline: 'none', width: '100%', boxSizing: 'border-box' };
  const cardSt  = { background: c.card, border: `1px solid ${c.cardBorder}`, borderRadius: 12, padding: isMobile ? 16 : 20, display: 'flex', flexDirection: 'column', gap: 14, marginTop: 14 };
  const sectionLabel = (t) => <p className="wd-label-blue" style={{ margin: '26px 0 0' }}>{t}</p>;

  const [form, setForm] = useState({ name: '', title: '', role: '', daemon_name: '', context_brief: '' });
  const [prefs, setPrefs] = useState({});
  const [busy, setBusy] = useState(false);
  const [banner, setBanner] = useState(null);

  useEffect(() => {
    if (!profile) return;
    setForm({
      name: profile.name || '', title: profile.title || '', role: profile.role || '',
      daemon_name: profile.daemon_name || '', context_brief: profile.context_brief || '',
    });
    setPrefs(profile.notif_prefs || { email: true, task_assigned: true, approval: true });
  }, [profile]);

  const permLevel = profile?.permission_level ?? 2;
  const company   = profile?.workspaces?.name || '—';
  const initial   = (form.name || user?.email || '?').charAt(0).toUpperCase();

  const save = async (extra = {}) => {
    setBusy(true);
    try {
      const r = await fetch('/api/auth/me', {
        method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ ...form, notif_prefs: prefs, ...extra }),
      });
      if (r.ok) { setBanner({ ok: true, text: 'Saved.' }); await refreshProfile?.(); }
      else { const d = await r.json().catch(() => ({})); setBanner({ ok: false, text: d.error || 'Could not save.' }); }
    } catch { setBanner({ ok: false, text: 'Network error.' }); }
    setBusy(false);
  };

  const sendReset = async () => {
    if (!user?.email) return;
    setBusy(true);
    const { error } = await supabase.auth.resetPasswordForEmail(user.email, { redirectTo: `${window.location.origin}/login` });
    setBanner(error ? { ok: false, text: error.message } : { ok: true, text: `Password reset link sent to ${user.email}.` });
    setBusy(false);
  };

  const togglePref = (k) => setPrefs(p => ({ ...p, [k]: !p[k] }));

  return (
    <div style={{ padding: isMobile ? '20px 16px' : '28px 32px', overflowY: 'auto', height: '100%', background: c.bg, transition: 'background 0.2s' }}>
      <div style={{ maxWidth: 680, margin: '0 auto' }}>
        <p className="wd-label-blue" style={{ marginBottom: 6 }}>PROFILE</p>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          <div style={{ width: 52, height: 52, borderRadius: 14, background: '#4172f5', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'var(--orbitron)', fontSize: 20, fontWeight: 700, color: '#fff', flexShrink: 0 }}>{initial}</div>
          <div>
            <h1 style={{ fontFamily: 'var(--inter)', fontSize: isMobile ? 19 : 23, fontWeight: 700, color: c.text, margin: 0, letterSpacing: '-0.03em' }}>{form.name || 'Your profile'}</h1>
            <p style={{ fontFamily: 'var(--dmsans)', fontSize: 13, color: c.text3, marginTop: 3 }}>{[form.title, company].filter(Boolean).join(' · ')}</p>
          </div>
        </div>

        {banner && (
          <div style={{ marginTop: 16, padding: '11px 14px', borderRadius: 9, fontFamily: 'var(--dmsans)', fontSize: 13,
            background: banner.ok ? 'rgba(16,185,129,0.08)' : 'rgba(239,68,68,0.08)',
            border: `1px solid ${banner.ok ? 'rgba(16,185,129,0.3)' : 'rgba(239,68,68,0.3)'}`,
            color: banner.ok ? '#10b981' : '#ef4444' }}>{banner.ok ? '✓ ' : '✗ '}{banner.text}</div>
        )}

        {/* Identity */}
        {sectionLabel('IDENTITY')}
        <div style={cardSt}>
          <ProfileField label="Full name"><input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} style={inputSt} /></ProfileField>
          <ProfileField label="Role title"><input value={form.title} onChange={e => setForm(f => ({ ...f, title: e.target.value }))} placeholder="e.g. CEO & Founder" style={inputSt} /></ProfileField>
          <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr', gap: 14 }}>
            <ProfileField label="Email (read-only)"><input value={user?.email || ''} readOnly style={{ ...inputSt, opacity: 0.6, cursor: 'not-allowed' }} /></ProfileField>
            <ProfileField label="Company (read-only)"><input value={company} readOnly style={{ ...inputSt, opacity: 0.6, cursor: 'not-allowed' }} /></ProfileField>
          </div>
        </div>

        {/* Daemon configuration */}
        {sectionLabel('DAEMON CONFIGURATION')}
        <div style={cardSt}>
          <ProfileField label="Daemon display name"><input value={form.daemon_name} onChange={e => setForm(f => ({ ...f, daemon_name: e.target.value }))} placeholder={`${(form.name || 'Your').split(' ')[0]}'s Daemon`} style={inputSt} /></ProfileField>
          <ProfileField label="Role type — shapes your daemon's focus">
            <select value={ROLE_TYPES.includes(form.role) ? form.role : 'Other'} onChange={e => setForm(f => ({ ...f, role: e.target.value }))} style={{ ...inputSt, cursor: 'pointer' }}>
              {ROLE_TYPES.map(r => <option key={r} value={r}>{r}</option>)}
            </select>
          </ProfileField>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, padding: '11px 13px', background: c.subtle, border: `1px solid ${c.subtleBorder}`, borderRadius: 9 }}>
            <div>
              <div style={{ fontFamily: 'var(--dmsans)', fontSize: 13, fontWeight: 600, color: c.text }}>Permission level {permLevel}</div>
              <div style={{ fontFamily: 'var(--dmsans)', fontSize: 12, color: c.text3, marginTop: 2 }}>{PERM_LABELS[permLevel]}</div>
            </div>
            {permLevel < 3 && (
              <button type="button" onClick={() => setBanner({ ok: true, text: 'Upgrade request noted — an admin will review it in Team settings.' })}
                style={{ ...mkGhostBtn(c, { color: '#4172f5', borderColor: 'rgba(65,114,245,0.3)' }), padding: '7px 12px', fontSize: 12, whiteSpace: 'nowrap' }}>Request upgrade</button>
            )}
          </div>
          <ProfileField label="Daemon context brief — read at the start of every session">
            <textarea value={form.context_brief} onChange={e => setForm(f => ({ ...f, context_brief: e.target.value }))} rows={3}
              placeholder="e.g. I'm leading the Q3 launch. Prefer concise updates. Flag only blockers, not status."
              style={{ ...inputSt, resize: 'vertical' }} />
          </ProfileField>
          <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
            <button type="button" onClick={() => save()} disabled={busy}
              style={{ padding: '9px 20px', borderRadius: 8, cursor: busy ? 'default' : 'pointer', background: '#4172f5', border: '1px solid #4172f5', color: '#fff', fontFamily: 'var(--dmsans)', fontSize: 13, fontWeight: 600, opacity: busy ? 0.6 : 1 }}>
              {busy ? 'Saving…' : 'Save changes'}
            </button>
          </div>
        </div>

        {/* Notifications */}
        {sectionLabel('NOTIFICATIONS')}
        <div style={cardSt}>
          {[['email', 'Email notifications'], ...ALERT_TYPES].map(([k, label]) => (
            <div key={k} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
              <span style={{ fontFamily: 'var(--dmsans)', fontSize: 13.5, color: c.text }}>{label}</span>
              <button type="button" onClick={() => togglePref(k)}
                style={{ width: 40, height: 23, borderRadius: 12, border: 'none', cursor: 'pointer', flexShrink: 0, position: 'relative', transition: 'background 0.15s', background: prefs[k] ? '#4172f5' : c.subtleBorder }}>
                <span style={{ position: 'absolute', top: 2, left: prefs[k] ? 19 : 2, width: 19, height: 19, borderRadius: '50%', background: '#fff', transition: 'left 0.15s' }} />
              </button>
            </div>
          ))}
          <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
            <button type="button" onClick={() => save()} disabled={busy} style={{ ...mkGhostBtn(c), padding: '8px 16px', fontSize: 13 }}>Save notifications</button>
          </div>
        </div>

        {/* Personal integrations */}
        {sectionLabel('PERSONAL INTEGRATIONS')}
        <div style={{ ...cardSt, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
          <span style={{ fontFamily: 'var(--dmsans)', fontSize: 13.5, color: c.text3 }}>Connect tools so your daemon can act on your behalf.</span>
          <button type="button" onClick={() => navigate('/app/integrations')} style={{ ...mkGhostBtn(c, { color: '#4172f5', borderColor: 'rgba(65,114,245,0.3)' }), padding: '8px 14px', fontSize: 13, whiteSpace: 'nowrap' }}>Manage →</button>
        </div>

        {/* Security */}
        {sectionLabel('SECURITY')}
        <div style={{ ...cardSt, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 30 }}>
          <div>
            <div style={{ fontFamily: 'var(--dmsans)', fontSize: 13.5, fontWeight: 600, color: c.text }}>Password</div>
            <div style={{ fontFamily: 'var(--dmsans)', fontSize: 12, color: c.text3, marginTop: 2 }}>We'll email you a secure reset link.</div>
          </div>
          <button type="button" onClick={sendReset} disabled={busy} style={{ ...mkGhostBtn(c), padding: '8px 14px', fontSize: 13, whiteSpace: 'nowrap' }}>Reset password</button>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// TEAM — members + daemon permission levels (admin, IA §6.2)
// ─────────────────────────────────────────────────────────────────────────────
const LEVEL_SHORT = { 1: 'L1 · Copilot', 2: 'L2 · Assistant', 3: 'L3 · Autonomous' };

function TeamPage() {
  const c = useC();
  const { isMobile } = useViewport();
  const { token, profile } = useAuth();
  const [team, setTeam] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(null);
  const [banner, setBanner] = useState(null);
  const inviteCode = profile?.workspaces?.invite_code;

  const load = useCallback(async () => {
    if (!token) return;
    try {
      const r = await fetch('/api/brain?tab=team', { headers: { Authorization: `Bearer ${token}` } });
      const d = await r.json();
      setTeam(d.team || []);
    } catch {}
    setLoading(false);
  }, [token]);
  useEffect(() => { load(); }, [load]);

  const setLevel = async (user_id, level) => {
    setBusy(user_id);
    setTeam(t => t.map(m => m.user_id === user_id ? { ...m, permission_level: level } : m));
    await fetch('/api/brain', {
      method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ action: 'set_permission_level', user_id, permission_level: level }),
    }).catch(() => {});
    setBusy(null);
  };

  const copyInvite = () => {
    if (!inviteCode) return;
    const link = `${window.location.origin}/join/${inviteCode}`;
    navigator.clipboard?.writeText(link);
    setBanner({ ok: true, text: 'Invite link copied to clipboard.' });
  };

  const th = { fontFamily: 'var(--mono)', fontSize: 10, letterSpacing: '0.06em', color: c.text4, textAlign: 'left', padding: '0 12px 8px', fontWeight: 600 };
  const td = { fontFamily: 'var(--dmsans)', fontSize: 13, color: c.text, padding: '12px', borderTop: `1px solid ${c.cardBorder}`, verticalAlign: 'middle' };

  return (
    <div style={{ padding: isMobile ? '20px 16px' : '28px 32px', overflowY: 'auto', height: '100%', background: c.bg, transition: 'background 0.2s' }}>
      <div style={{ maxWidth: 900, margin: '0 auto' }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>
          <div>
            <p className="wd-label-blue" style={{ marginBottom: 6 }}>ADMIN</p>
            <h1 style={{ fontFamily: 'var(--inter)', fontSize: isMobile ? 20 : 24, fontWeight: 700, color: c.text, margin: 0, letterSpacing: '-0.03em' }}>Team</h1>
            <p style={{ fontFamily: 'var(--dmsans)', fontSize: 14, color: c.text3, marginTop: 6 }}>Manage members and their daemon permission levels.</p>
          </div>
          <button type="button" onClick={copyInvite} disabled={!inviteCode}
            style={{ padding: '9px 16px', borderRadius: 9, cursor: inviteCode ? 'pointer' : 'not-allowed', whiteSpace: 'nowrap', flexShrink: 0,
              background: 'rgba(65,114,245,0.1)', border: '1px solid rgba(65,114,245,0.3)', fontFamily: 'var(--dmsans)', fontSize: 13, fontWeight: 600, color: '#4172f5', opacity: inviteCode ? 1 : 0.5 }}>
            + Invite member
          </button>
        </div>

        {banner && (
          <div style={{ marginTop: 16, padding: '11px 14px', borderRadius: 9, fontFamily: 'var(--dmsans)', fontSize: 13, background: 'rgba(16,185,129,0.08)', border: '1px solid rgba(16,185,129,0.3)', color: '#10b981' }}>✓ {banner.text}</div>
        )}

        <div style={{ marginTop: 20, background: c.card, border: `1px solid ${c.cardBorder}`, borderRadius: 12, padding: '14px 8px', overflowX: 'auto' }}>
          {loading ? (
            Array.from({ length: 4 }).map((_, i) => <SkeletonRow key={i} height={48} />)
          ) : (
            <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 560 }}>
              <thead><tr><th style={th}>MEMBER</th><th style={th}>ROLE</th><th style={th}>DAEMON LEVEL</th><th style={th}>STATUS</th><th style={th}>ACTIVITY</th></tr></thead>
              <tbody>
                {team.map(m => (
                  <tr key={m.user_id}>
                    <td style={td}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                        <div style={{ width: 28, height: 28, borderRadius: 8, background: '#4172f5', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'var(--orbitron)', fontSize: 11, fontWeight: 700, color: '#fff', flexShrink: 0 }}>{m.name.charAt(0).toUpperCase()}</div>
                        <span style={{ fontWeight: 600 }}>{m.name}</span>
                        {m.workspace_role === 'admin' && <span style={{ fontFamily: 'var(--mono)', fontSize: 8.5, color: '#4172f5', border: '1px solid rgba(65,114,245,0.3)', borderRadius: 4, padding: '1px 5px' }}>ADMIN</span>}
                      </div>
                    </td>
                    <td style={{ ...td, color: c.text3 }}>{m.title || '—'}</td>
                    <td style={td}>
                      <select value={m.permission_level} disabled={busy === m.user_id} onChange={e => setLevel(m.user_id, Number(e.target.value))}
                        style={{ padding: '6px 10px', borderRadius: 7, background: c.subtle, border: `1px solid ${c.subtleBorder}`, color: c.text, fontFamily: 'var(--dmsans)', fontSize: 12.5, cursor: 'pointer', outline: 'none' }}>
                        <option value={1}>{LEVEL_SHORT[1]}</option><option value={2}>{LEVEL_SHORT[2]}</option><option value={3}>{LEVEL_SHORT[3]}</option>
                      </select>
                    </td>
                    <td style={td}>
                      <span style={{ fontFamily: 'var(--mono)', fontSize: 10, letterSpacing: '0.04em', color: m.status === 'active' ? '#10b981' : '#f59e0b' }}>{m.status.toUpperCase()}</span>
                    </td>
                    <td style={{ ...td, color: c.text4, fontFamily: 'var(--mono)', fontSize: 11 }}>{m.interaction_count > 0 ? `${m.interaction_count} turns` : '—'}</td>
                  </tr>
                ))}
                {team.length === 0 && <tr><td style={{ ...td, color: c.text4 }} colSpan={5}>No members yet.</td></tr>}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// AUDIT LOG — company-wide daemon actions (admin, IA §6.4)
// ─────────────────────────────────────────────────────────────────────────────
function AuditPage() {
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
          <Route path="daemons"      element={<AutoDaemonsPage />} />
          <Route path="skills"       element={<SkillsPage />} />
          <Route path="calendar"     element={<CalendarPage />} />
          <Route path="brain"        element={<AdminRoute isAdmin={isAdmin}><BrainPage /></AdminRoute>} />
          <Route path="tasks"        element={<TasksPage />} />
          <Route path="inbox"        element={<InboxPage />} />
          <Route path="integrations" element={<IntegrationsPage />} />
          <Route path="overview"     element={<AdminRoute isAdmin={isAdmin}><OverviewPage /></AdminRoute>} />
          <Route path="team"         element={<AdminRoute isAdmin={isAdmin}><TeamPage /></AdminRoute>} />
          <Route path="audit"        element={<AdminRoute isAdmin={isAdmin}><AuditPage /></AdminRoute>} />
          <Route path="profile"      element={<ProfilePage />} />
          <Route path="settings"     element={<SettingsPage />} />
        </Routes>
      </div>
    </div>
  );
}
