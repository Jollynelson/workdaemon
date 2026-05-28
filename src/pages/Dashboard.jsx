import { useState, useEffect, useRef, useCallback } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import Sidebar from '../components/layout/Sidebar.jsx';
import DaemonMark from '../components/brand/DaemonMark.jsx';
import { useTheme, useViewport } from '../context/ThemeContext.jsx';
import { useAuth } from '../context/AuthContext.jsx';
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
    text:         d ? '#e8e8e8'                    : '#1a1a1a',
    text2:        d ? 'rgba(232,232,232,0.65)'     : 'rgba(26,26,26,0.65)',
    text3:        d ? 'rgba(232,232,232,0.38)'     : 'rgba(26,26,26,0.42)',
    text4:        d ? 'rgba(232,232,232,0.18)'     : 'rgba(26,26,26,0.22)',
    bg:           d ? '#191919'                    : '#ffffff',
    surface:      d ? '#252525'                    : '#fafafa',
    card:         d ? '#252525'                    : '#ffffff',
    cardBorder:   d ? 'rgba(255,255,255,0.07)'     : 'rgba(0,0,0,0.08)',
    cardShadow:   d ? 'none'                       : '0 1px 3px rgba(0,0,0,0.06)',
    stat:         d ? '#252525'                    : '#fafafa',
    statBorder:   d ? 'rgba(255,255,255,0.07)'     : 'rgba(0,0,0,0.08)',
    statShadow:   d ? 'none'                       : '0 1px 4px rgba(0,0,0,0.06)',
    row:          d ? 'rgba(255,255,255,0.04)'     : 'rgba(0,0,0,0.025)',
    rowBorder:    d ? 'rgba(255,255,255,0.07)'     : 'rgba(0,0,0,0.07)',
    subtle:       d ? 'rgba(255,255,255,0.03)'     : 'rgba(0,0,0,0.02)',
    subtleBorder: d ? 'rgba(255,255,255,0.07)'     : 'rgba(0,0,0,0.07)',
    headerBg:     d ? '#191919'                    : '#ffffff',
    headerBorder: d ? 'rgba(255,255,255,0.07)'     : 'rgba(0,0,0,0.08)',
    inputBg:      d ? 'rgba(255,255,255,0.05)'     : '#ffffff',
    inputBorder:  d ? 'rgba(255,255,255,0.1)'      : 'rgba(0,0,0,0.12)',
    thinkingBg:   d ? 'rgba(255,255,255,0.04)'     : 'rgba(0,0,0,0.03)',
    thinkingBorder: d ? 'rgba(255,255,255,0.08)'   : 'rgba(0,0,0,0.08)',
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

function BlockText({ block }) {
  const c = useC();
  if (block.md) return <Md text={block.md} c={c} />;
  return <div style={{ fontFamily: 'var(--dmsans)', fontSize: 15, color: c.text2, lineHeight: 1.75 }}>{block.content}</div>;
}

function BlockStatGrid({ block }) {
  const c = useC();
  const { isMobile } = useViewport();
  return (
    <div style={{ display: 'grid', gridTemplateColumns: isMobile ? 'repeat(2, 1fr)' : 'repeat(auto-fit, minmax(140px, 1fr))', gap: 10 }}>
      {(block.stats || []).map((s, i) => (
        <div key={i} style={{ padding: '14px 16px', background: c.stat, border: `1px solid ${c.statBorder}`, borderRadius: 10, boxShadow: c.statShadow }}>
          <div style={{ fontFamily: 'var(--mono)', fontSize: 10, color: c.text3, letterSpacing: '0.1em', marginBottom: 6 }}>{(s.label || '').toUpperCase()}</div>
          <div style={{ fontFamily: 'var(--orbitron)', fontSize: 22, fontWeight: 700, color: s.accent ? ACCENT_COLORS[s.accent] : c.text, letterSpacing: '-0.01em', marginBottom: 4 }}>{s.value}</div>
          {s.unit   && <div style={{ fontFamily: 'var(--dmsans)', fontSize: 12, color: c.text3 }}>{s.unit}</div>}
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
    info:    { bg: c.d ? 'rgba(255,255,255,0.04)'  : 'rgba(0,0,0,0.02)',      border: 'rgba(65,114,245,0.22)',  leftBorder: '#4172f5', title: '#4172f5', icon: 'ℹ' },
    success: { bg: c.d ? 'rgba(16,185,129,0.08)'   : 'rgba(16,185,129,0.07)', border: 'rgba(16,185,129,0.22)',  leftBorder: '#10b981', title: '#10b981', icon: '✓' },
    warning: { bg: c.d ? 'rgba(245,158,11,0.08)'   : 'rgba(245,158,11,0.07)', border: 'rgba(245,158,11,0.22)',  leftBorder: '#f59e0b', title: '#f59e0b', icon: '⚠' },
    danger:  { bg: c.d ? 'rgba(239,68,68,0.08)'    : 'rgba(239,68,68,0.06)',  border: 'rgba(239,68,68,0.22)',   leftBorder: '#ef4444', title: '#ef4444', icon: '×' },
  };
  const s = styles[block.level] || styles.info;
  return (
    <div style={{ padding: '13px 16px', background: s.bg, border: `1px solid ${s.border}`, borderLeft: `3px solid ${s.leftBorder}`, borderRadius: '0 10px 10px 0' }}>
      {block.title && (
        <div style={{ fontFamily: 'var(--mono)', fontSize: 11, color: s.title, letterSpacing: '0.08em', marginBottom: 6, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 6 }}>
          <span>{s.icon}</span> {block.title}
        </div>
      )}
      <div style={{ fontFamily: 'var(--dmsans)', fontSize: 14, color: c.text2, lineHeight: 1.6 }}>{block.content}</div>
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
      {(block.items || []).map((item, i) => (
        <div key={i}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
            <span style={{ fontFamily: 'var(--dmsans)', fontSize: 13, color: c.text2 }}>{item.label}</span>
            <span style={{ fontFamily: 'var(--mono)', fontSize: 11, color: c.text3 }}>{item.value}{item.unit || '%'}</span>
          </div>
          <div style={{ height: 5, background: c.d ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.08)', borderRadius: 3, overflow: 'hidden' }}>
            <div style={{ height: '100%', width: `${Math.min(item.value, 100)}%`, background: item.color || '#4172f5', borderRadius: 3, animation: 'wd-progress 0.8s ease both' }} />
          </div>
        </div>
      ))}
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

function BlockActionConfirm({ block }) {
  const c = useC();
  const [done, setDone] = useState(false);
  if (done) return <BlockAlert block={{ level: 'success', content: block.success || 'Action completed.' }} />;
  return (
    <div style={{ padding: '14px 16px', background: c.stat, border: `1px solid ${c.statBorder}`, borderRadius: 10 }}>
      <p style={{ fontFamily: 'var(--dmsans)', fontSize: 14, color: c.text2, marginBottom: 14, lineHeight: 1.5 }}>{block.prompt}</p>
      <div style={{ display: 'flex', gap: 8 }}>
        <button className="wd-btn"       style={{ flex: 1, height: 40, fontSize: 9 }} onClick={() => setDone(true)}>{block.confirmLabel || 'CONFIRM'}</button>
        <button className="wd-btn-ghost" style={{ flex: 1, height: 40, justifyContent: 'center' }} onClick={() => setDone(true)}>{block.cancelLabel || 'Cancel'}</button>
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

function renderBlock(block, i) {
  const wrapCard = (content, noWrap = false) => (
    <div key={i} style={noWrap ? {} : {}}>
      {block.label && <p style={{ fontFamily: 'var(--mono)', fontSize: 10, color: 'var(--text-3)', letterSpacing: '0.1em', marginBottom: 10 }}>{block.label.toUpperCase()}</p>}
      {content}
    </div>
  );
  switch (block.type) {
    case 'text':           return wrapCard(<BlockText block={block} />, true);
    case 'stat_grid':      return wrapCard(<BlockStatGrid block={block} />, true);
    case 'chart_bar':      return wrapCard(<BlockChartBar block={block} />);
    case 'chart_line':     return wrapCard(<BlockChartLine block={block} />);
    case 'alert':          return <div key={i}><BlockAlert block={block} /></div>;
    case 'kanban':         return wrapCard(<BlockKanban block={block} />);
    case 'people_list':    return wrapCard(<BlockPeopleList block={block} />, true);
    case 'timeline':       return wrapCard(<BlockTimeline block={block} />);
    case 'progress_bars':  return wrapCard(<BlockProgressBars block={block} />);
    case 'action_confirm': return <div key={i}><BlockActionConfirm block={block} /></div>;
    case 'invoice_table':  return wrapCard(<BlockInvoiceTable block={block} />, true);
    default:               return wrapCard(<BlockText block={{ content: JSON.stringify(block) }} />, true);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// CHAT API
// ─────────────────────────────────────────────────────────────────────────────

const DAEMON_SYSTEM_PROMPT = (context) => `You are a Company Brain Daemon — an AI assistant with full context of ${context.company || 'this company'} across all their connected tools.

The user's role is: ${context.role || 'team member'}.

Respond concisely and directly. You have access to data from connected integrations (Notion, Slack, Jira, GitHub, Gmail, etc.). Surface specific names, numbers, and deadlines when relevant. Flag blockers and risks proactively.

Keep responses focused and actionable. Use **bold** for emphasis on critical items.`;

async function callDaemonAPI({ messages, context, apiKey, authToken }) {
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
        max_tokens: 1024,
        system: DAEMON_SYSTEM_PROMPT(context),
        messages: messages
          .filter(m => m.role === 'user' || (m.role === 'daemon' && m.text))
          .map(m => ({
            role: m.role === 'user' ? 'user' : 'assistant',
            content: m.text || '',
          })),
      }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error?.message || `API error ${res.status}`);
    }
    const data = await res.json();
    return {
      blocks: [{ type: 'text', md: data.content[0]?.text || '' }],
      suggestions: [],
    };
  }

  // Backend endpoint
  const res = await fetch('/api/chat', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
    },
    body: JSON.stringify({
      messages: messages
        .filter(m => m.role === 'user' || (m.role === 'daemon' && m.text))
        .map(m => ({ role: m.role === 'user' ? 'user' : 'assistant', content: m.text || '' })),
      systemPrompt: DAEMON_SYSTEM_PROMPT(context),
    }),
  });
  if (!res.ok) throw new Error(`Server error ${res.status}`);
  return res.json();
}

// ─────────────────────────────────────────────────────────────────────────────
// CHAT VIEW
// ─────────────────────────────────────────────────────────────────────────────

function ChatView({ context, onBack, onMenu }) {
  const c = useC();
  const { isMobile } = useViewport();
  const { token: authToken } = useAuth();
  const [msgs, setMsgs]             = useState([]);
  const [suggestions, setSuggestions] = useState([]);
  const [input, setInput]           = useState('');
  const [thinking, setThinking]     = useState(false);
  const [error, setError]           = useState('');
  const [apiKey, setApiKey]         = useState(() => sessionStorage.getItem('wd_apiKey') || '');
  const [showApiModal, setShowApiModal] = useState(false);
  const bottomRef = useRef(null);
  const inputRef  = useRef(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [msgs, thinking]);

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
      const history = [...msgs, userMsg];
      const { blocks, suggestions: nextSugs } = await callDaemonAPI({
        messages: history,
        context,
        apiKey,
        authToken,
      });
      setMsgs(m => [...m, { role: 'daemon', blocks }]);
      setSuggestions(nextSugs || []);
    } catch (e) {
      setError(e.message || 'Something went wrong. Try again.');
    } finally {
      setThinking(false);
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [msgs, context, apiKey, thinking]);

  const saveApiKey = (key) => {
    setApiKey(key);
    if (key) sessionStorage.setItem('wd_apiKey', key);
    else sessionStorage.removeItem('wd_apiKey');
    setShowApiModal(false);
  };

  const isLong = suggestions.some(s => s.length > 36);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden', background: c.bg, transition: 'background 0.2s' }}>

      {/* Header */}
      <div style={{ padding: isMobile ? '0 12px' : '0 24px', height: 52, display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderBottom: `1px solid ${c.headerBorder}`, background: c.headerBg, flexShrink: 0, gap: 8 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: isMobile ? 8 : 14, minWidth: 0, flex: 1 }}>
          {isMobile && (
            <button type="button" onClick={onMenu} style={{ width: 32, height: 32, borderRadius: 8, background: 'none', border: 'none', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 4, cursor: 'pointer', padding: 0, flexShrink: 0, color: c.text3 }}>
              <span style={{ width: 16, height: 1.5, background: 'currentColor', borderRadius: 1, display: 'block' }} />
              <span style={{ width: 16, height: 1.5, background: 'currentColor', borderRadius: 1, display: 'block' }} />
              <span style={{ width: 11, height: 1.5, background: 'currentColor', borderRadius: 1, display: 'block', alignSelf: 'flex-start' }} />
            </button>
          )}
          {onBack && <div style={{ width: 1, height: 16, background: c.cardBorder, flexShrink: 0 }} />}
          {onBack && (
          <button type="button" onClick={onBack} style={{ fontFamily: 'var(--mono)', fontSize: isMobile ? 9 : 13, color: c.text3, background: 'none', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4, padding: 0, letterSpacing: isMobile ? '0.08em' : 0, flexShrink: 0 }}
            onMouseEnter={e => { e.currentTarget.style.color = c.text2; }}
            onMouseLeave={e => { e.currentTarget.style.color = c.text3; }}>
            ← BACK
          </button>
          )}
          <div style={{ width: 1, height: 16, background: c.cardBorder, flexShrink: 0 }} />
          <DaemonMark size={16} glow={c.d} />
          <div style={{ fontFamily: 'var(--dmsans)', fontSize: isMobile ? 13 : 14, fontWeight: 600, color: c.text, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {context.roleLabel}
          </div>
          {!isMobile && context.company && (
            <>
              <div style={{ width: 1, height: 14, background: c.cardBorder, flexShrink: 0 }} />
              <div style={{ fontFamily: 'var(--dmsans)', fontSize: 13, color: c.text3, whiteSpace: 'nowrap' }}>{context.company}</div>
            </>
          )}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
          {!isMobile && (
            <button className="wd-btn-ghost" onClick={() => setShowApiModal(true)} style={{ fontSize: 11, fontFamily: 'var(--dmsans)', letterSpacing: 0, padding: '6px 12px' }}>
              {apiKey ? '🔑 API key set' : '+ API Key'}
            </button>
          )}
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: isMobile ? '5px 10px' : '6px 12px', borderRadius: 20, background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)' }}>
            <span className="wd-dot" style={{ width: 5, height: 5, background: apiKey ? '#10b981' : '#f59e0b' }} />
            {!isMobile && <span style={{ fontFamily: 'var(--dmsans)', fontSize: 11, fontWeight: 500, color: 'rgba(232,232,232,0.7)', letterSpacing: '0.01em' }}>{apiKey ? 'Live AI' : 'Add key'}</span>}
          </div>
        </div>
      </div>

      {/* Messages */}
      <div style={{ flex: 1, overflowY: 'auto', padding: isMobile ? '16px 14px 0' : '28px 28px 0' }}>
        <div style={{ maxWidth: 780, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: isMobile ? 18 : 24 }}>

          {/* Welcome state */}
          {msgs.length === 0 && !thinking && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12, paddingTop: 24 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <DaemonMark size={16} glow={c.d} />
                <span style={{ fontFamily: 'var(--mono)', fontSize: 10, color: c.text3, letterSpacing: '0.1em' }}>
                  {context.roleLabel?.toUpperCase()} DAEMON
                </span>
              </div>
              <div style={{ fontFamily: 'var(--dmsans)', fontSize: 15, color: c.text, lineHeight: 1.75 }}>
                {!apiKey
                  ? <>Add your <strong style={{ color: c.text }}>Anthropic API key</strong> above to start querying your company brain. Your key is stored in this browser session only.</>
                  : <>Your Company Brain is ready. Ask me anything — sprint status, pipeline, team workload, blockers, or what needs your attention right now.</>
                }
              </div>
            </div>
          )}

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
                    <span style={{ fontFamily: 'var(--mono)', fontSize: 10, color: c.text3, letterSpacing: '0.1em' }}>
                      {context.roleLabel?.toUpperCase()} DAEMON
                    </span>
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                    {(m.blocks || []).map((block, bi) => renderBlock(block, bi))}
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
              placeholder={apiKey ? (isMobile ? 'Ask your Daemon...' : 'Ask anything — Enter to send') : 'Add API key to start chatting'}
              value={input}
              onChange={e => setInput(e.target.value)}
              disabled={thinking || !apiKey}
              style={{ flex: 1, borderRadius: 24, padding: isMobile ? '11px 16px' : '13px 20px', height: isMobile ? 46 : 50, fontSize: isMobile ? 14 : 15 }}
            />
            <button type="submit" disabled={!input.trim() || thinking || !apiKey} style={{
              width: isMobile ? 44 : 50, height: isMobile ? 44 : 50, borderRadius: 14,
              background: input.trim() && !thinking && apiKey ? '#4172f5' : c.d ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.04)',
              border: 'none', color: input.trim() && !thinking && apiKey ? '#fff' : c.text3,
              fontSize: isMobile ? 18 : 20, cursor: input.trim() && !thinking && apiKey ? 'pointer' : 'not-allowed',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              transition: 'all 0.15s', flexShrink: 0,
              boxShadow: input.trim() && !thinking && apiKey ? '0 4px 16px rgba(65,114,245,0.28)' : 'none',
            }}>↑</button>
          </form>
        </div>
      </div>

      {/* API key modal */}
      {showApiModal && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)', backdropFilter: 'blur(6px)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 200 }} onClick={() => setShowApiModal(false)}>
          <div style={{ background: c.surface, border: `1px solid ${c.cardBorder}`, borderRadius: 16, padding: '28px 32px', width: 420, boxShadow: '0 40px 80px rgba(0,0,0,0.4)' }} onClick={e => e.stopPropagation()}>
            <p className="wd-label-blue" style={{ marginBottom: 8 }}>ANTHROPIC API KEY</p>
            <h3 style={{ fontFamily: 'var(--dmsans)', fontSize: 20, fontWeight: 600, color: c.text, marginBottom: 6 }}>Connect your AI</h3>
            <p style={{ fontFamily: 'var(--dmsans)', fontSize: 13, color: c.text3, lineHeight: 1.6, marginBottom: 20 }}>Your key is stored in this browser session only — never sent to WorkDaemon servers.</p>
            <input className="wd-input" type="password" placeholder="sk-ant-..." defaultValue={apiKey} id="apiKeyInput" style={{ marginBottom: 14 }} autoFocus />
            <div style={{ display: 'flex', gap: 10 }}>
              <button className="wd-btn" style={{ flex: 1, height: 42, fontSize: 9 }} onClick={() => saveApiKey(document.getElementById('apiKeyInput').value.trim())}>SAVE KEY</button>
              <button className="wd-btn-ghost" style={{ height: 42, padding: '0 18px', justifyContent: 'center' }} onClick={() => { saveApiKey(''); }}>Clear</button>
            </div>
            <p style={{ fontFamily: 'var(--mono)', fontSize: 9, color: c.text4, letterSpacing: '0.08em', textAlign: 'center', marginTop: 14 }}>SESSION ONLY · NEVER LEAVES YOUR BROWSER</p>
          </div>
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// DAEMON PAGE
// ─────────────────────────────────────────────────────────────────────────────

function DaemonPage({ onMenu, onChatChange }) {
  const c = useC();
  const { isMobile } = useViewport();
  const { profile } = useAuth();

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

  // If user completed onboarding with role + industry, skip the picker
  const hasProfile = !!(profile?.role && profile?.industry);
  const [started, setStarted]               = useState(hasProfile);

  useEffect(() => { onChatChange?.(started); }, [started]);

  if (started) {
    return (
      <div style={{ height: '100%', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        <ChatView
          context={{ roleLabel: selectedRole.label, company: company || undefined, role: selectedRole.id, industry: selectedPreset.id }}
          onBack={hasProfile ? null : () => setStarted(false)}
          onMenu={onMenu}
        />
      </div>
    );
  }

  return (
    <div style={{ padding: isMobile ? '20px 16px' : '32px', overflowY: 'auto', height: '100%', background: c.bg, transition: 'background 0.2s' }}>
      <div style={{ maxWidth: 640, margin: '0 auto' }}>
        <p className="wd-label-blue" style={{ marginBottom: 10 }}>MY DAEMON</p>
        <h1 style={{ fontFamily: 'var(--dmsans)', fontSize: isMobile ? 22 : 28, fontWeight: 600, color: c.text, letterSpacing: '-0.02em', marginBottom: 6 }}>Choose your context.</h1>
        <p style={{ fontFamily: 'var(--dmsans)', fontSize: isMobile ? 14 : 15, color: c.text3, marginBottom: isMobile ? 24 : 32, lineHeight: 1.6 }}>
          Your Daemon loads full context for your role. Pick an industry and role to begin.
        </p>

        {/* Company name */}
        <div style={{ marginBottom: 20 }}>
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
        <div style={{ marginBottom: 12 }}>
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
        <div style={{ marginBottom: 8 }}>
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

        <button className="wd-btn" onClick={() => setStarted(true)} style={{ width: '100%' }}>
          LAUNCH {selectedRole.label.toUpperCase()} DAEMON  →
        </button>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// COMPANY BRAIN
// ─────────────────────────────────────────────────────────────────────────────

function BrainPage() {
  const c = useC();
  const { isMobile } = useViewport();
  const { token } = useAuth();
  const { data, loading, error } = useFetch('/api/brain', token);
  const [activeTab, setActiveTab] = useState('overview');
  const tabs = ['OVERVIEW', 'INTEGRATIONS', 'KNOWLEDGE GRAPH', 'USERS', 'SECURITY'];

  const stats = data?.stats || [];
  const integrations = data?.integrations || [];

  return (
    <div style={{ padding: isMobile ? '20px 16px' : '28px 32px', overflowY: 'auto', height: '100%', background: c.bg, transition: 'background 0.2s' }}>
      <div style={{ maxWidth: 820 }}>
        <p className="wd-label-blue" style={{ marginBottom: 8 }}>COMPANY BRAIN</p>
        <h1 style={{ fontFamily: 'var(--dmsans)', fontSize: isMobile ? 20 : 24, fontWeight: 600, color: c.text, letterSpacing: '-0.02em', marginBottom: 6 }}>Knowledge Infrastructure</h1>
        <p style={{ fontFamily: 'var(--dmsans)', fontSize: 13, color: c.text3, marginBottom: 20 }}>Admin-only view · All data encrypted · AES-256-GCM</p>

        {/* Stats */}
        <div style={{ display: 'grid', gridTemplateColumns: isMobile ? 'repeat(2, 1fr)' : 'repeat(4, 1fr)', gap: 10, marginBottom: 24 }}>
          {loading
            ? Array.from({ length: 4 }).map((_, i) => <SkeletonRow key={i} height={80} />)
            : stats.length > 0
              ? stats.map((s, i) => (
                  <div key={i} style={{ padding: '14px 16px', background: c.stat, border: `1px solid ${c.statBorder}`, borderRadius: 10, boxShadow: c.statShadow }}>
                    <div style={{ fontFamily: 'var(--mono)', fontSize: 9, color: c.text3, letterSpacing: '0.1em', marginBottom: 6 }}>{s.label?.toUpperCase()}</div>
                    <div style={{ fontFamily: 'var(--orbitron)', fontSize: isMobile ? 16 : 18, fontWeight: 700, color: c.text, marginBottom: 3 }}>{s.value}</div>
                    <div style={{ fontFamily: 'var(--mono)', fontSize: 9, color: c.text3 }}>{s.unit}</div>
                  </div>
                ))
              : [{ label: 'Documents', value: '—' }, { label: 'Integrations', value: '—' }, { label: 'Graph Nodes', value: '—' }, { label: 'Query P99', value: '—' }].map((s, i) => (
                  <div key={i} style={{ padding: '14px 16px', background: c.stat, border: `1px solid ${c.statBorder}`, borderRadius: 10 }}>
                    <div style={{ fontFamily: 'var(--mono)', fontSize: 9, color: c.text3, letterSpacing: '0.1em', marginBottom: 6 }}>{s.label.toUpperCase()}</div>
                    <div style={{ fontFamily: 'var(--orbitron)', fontSize: 18, fontWeight: 700, color: c.text4 }}>{s.value}</div>
                  </div>
                ))
          }
        </div>

        {/* Tabs */}
        <div style={{ display: 'flex', gap: 4, marginBottom: 24, borderBottom: `1px solid ${c.cardBorder}`, overflowX: 'auto', WebkitOverflowScrolling: 'touch' }}>
          {tabs.map(t => (
            <button key={t} type="button" onClick={() => setActiveTab(t.toLowerCase().replace(/ /g, '_'))}
              style={{ padding: '8px 12px', background: 'none', border: 'none', borderBottom: `2px solid ${activeTab === t.toLowerCase().replace(/ /g, '_') ? '#4172f5' : 'transparent'}`, fontFamily: 'var(--mono)', fontSize: 10, letterSpacing: '0.08em', color: activeTab === t.toLowerCase().replace(/ /g, '_') ? '#4172f5' : c.text3, cursor: 'pointer', marginBottom: -1, transition: 'all 0.15s', whiteSpace: 'nowrap', flexShrink: 0 }}
            >{t}</button>
          ))}
        </div>

        {error && <BlockAlert block={{ level: 'danger', content: `Failed to load brain data: ${error}` }} />}

        {activeTab === 'overview' && !loading && !error && (
          data?.chart
            ? <BlockChartLine block={{ title: 'Documents Indexed — Last 14 Days', filled: true, keys: ['docs'], data: data.chart }} />
            : <EmptyState icon="◈" title="No brain data yet" subtitle="Connect your integrations to start indexing documents and building your knowledge graph." />
        )}

        {activeTab === 'integrations' && (
          loading ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {Array.from({ length: 4 }).map((_, i) => <SkeletonRow key={i} height={64} />)}
            </div>
          ) : integrations.length > 0 ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {integrations.map(intg => (
                <div key={intg.name} style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '14px 18px', background: intg.status === 'connected' ? (c.d ? 'rgba(16,185,129,0.04)' : 'rgba(16,185,129,0.04)') : c.subtle, border: `1px solid ${intg.status === 'connected' ? 'rgba(16,185,129,0.15)' : c.subtleBorder}`, borderRadius: 10 }}>
                  <div style={{ width: 32, height: 32, borderRadius: 8, background: c.subtle, border: `1px solid ${c.subtleBorder}`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'var(--orbitron)', fontSize: 11, fontWeight: 700, color: c.text3, flexShrink: 0 }}>{intg.icon || intg.name?.charAt(0)}</div>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontFamily: 'var(--dmsans)', fontSize: 13, fontWeight: 500, color: c.text, marginBottom: 2 }}>{intg.name}</div>
                    <div style={{ fontFamily: 'var(--mono)', fontSize: 10, color: c.text4, letterSpacing: '0.06em' }}>{intg.status === 'connected' ? `${intg.docs || 0} docs · synced ${intg.lastSync || 'recently'}` : 'Not connected'}</div>
                  </div>
                  <span style={{ padding: '4px 10px', borderRadius: 6, fontFamily: 'var(--mono)', fontSize: 9, letterSpacing: '0.08em', background: intg.status === 'connected' ? (c.d ? 'rgba(16,185,129,0.1)' : 'rgba(16,185,129,0.09)') : c.subtle, border: `1px solid ${intg.status === 'connected' ? 'rgba(16,185,129,0.25)' : c.subtleBorder}`, color: intg.status === 'connected' ? '#10b981' : '#4172f5', cursor: 'pointer' }}>
                    {intg.status === 'connected' ? 'CONNECTED' : 'CONNECT'}
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <EmptyState icon="⚡" title="No integrations connected" subtitle="Connect Notion, Slack, GitHub, Gmail, Jira and more to start building your knowledge graph." cta="GO TO INTEGRATIONS" onCta={() => {}} />
          )
        )}

        {(activeTab === 'users' || activeTab === 'knowledge_graph' || activeTab === 'security') && (
          <BlockAlert block={{ level: 'info', content: `${activeTab.replace(/_/g, ' ')} — coming in the next release.` }} />
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
  const { data, loading, error } = useFetch('/api/tasks', token);

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
            <h1 style={{ fontFamily: 'var(--dmsans)', fontSize: isMobile ? 20 : 22, fontWeight: 600, color: c.text, letterSpacing: '-0.02em' }}>Task Board</h1>
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
  const { data, loading, error } = useFetch('/api/inbox', token);
  const [filter, setFilter] = useState('all');

  const FILTERS = [
    { key: 'all',      label: 'ALL',      fn: () => true },
    { key: 'mentions', label: 'MENTIONS', fn: i => i.source === 'Slack' },
    { key: 'alerts',   label: 'ALERTS',   fn: i => !!i.level },
    { key: 'updates',  label: 'UPDATES',  fn: i => ['Jira', 'GitHub', 'Linear'].includes(i.source) },
  ];

  const items   = data?.items || [];
  const unread  = items.filter(i => i.unread).length;
  const visible = items.filter(FILTERS.find(f => f.key === filter)?.fn ?? (() => true));
  const LEVEL_COLOR = { danger: '#ef4444', warning: '#f59e0b' };

  return (
    <div style={{ padding: isMobile ? '20px 16px' : '28px 32px', overflowY: 'auto', height: '100%', background: c.bg, transition: 'background 0.2s' }}>
      <div style={{ maxWidth: 680, margin: '0 auto' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
          <div>
            <p className="wd-label-blue" style={{ marginBottom: 6 }}>INBOX</p>
            <h1 style={{ fontFamily: 'var(--dmsans)', fontSize: isMobile ? 20 : 22, fontWeight: 600, color: c.text, letterSpacing: '-0.02em', display: 'flex', alignItems: 'center', gap: 10 }}>
              Messages
              {unread > 0 && <span style={{ fontSize: 13, fontWeight: 500, fontFamily: 'var(--mono)', color: '#4172f5', background: 'rgba(65,114,245,0.09)', border: '1px solid rgba(65,114,245,0.22)', borderRadius: 20, padding: '2px 10px', letterSpacing: '0.05em' }}>{unread} new</span>}
            </h1>
          </div>
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
              return (
                <div key={item.id || idx} style={{
                  padding: '13px 15px',
                  background: item.unread ? (lc ? c.d ? `rgba(${item.level === 'danger' ? '239,68,68' : '245,158,11'},0.05)` : `rgba(${item.level === 'danger' ? '239,68,68' : '245,158,11'},0.03)` : c.row) : c.subtle,
                  border: `1px solid ${item.unread ? (lc ? `rgba(${item.level === 'danger' ? '239,68,68' : '245,158,11'},0.2)` : c.rowBorder) : c.subtleBorder}`,
                  borderLeft: lc && item.unread ? `3px solid ${lc}` : undefined,
                  borderRadius: lc && item.unread ? '0 9px 9px 0' : 9,
                  display: 'flex', gap: 12, cursor: 'pointer', transition: 'background 0.15s',
                }}>
                  <div style={{ width: 30, height: 30, borderRadius: 8, background: srcColor, display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'var(--orbitron)', fontSize: 10, fontWeight: 700, color: '#fff', flexShrink: 0 }}>{item.icon || item.source?.charAt(0)}</div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                      <span style={{ fontFamily: 'var(--dmsans)', fontSize: 14, fontWeight: item.unread ? 500 : 400, color: item.unread ? c.text : c.text2 }}>{item.title}</span>
                      {item.unread && <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#4172f5', flexShrink: 0 }} />}
                    </div>
                    <div style={{ fontFamily: 'var(--dmsans)', fontSize: 13, color: c.text3, lineHeight: 1.4, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{item.body}</div>
                    <div style={{ marginTop: 5, fontFamily: 'var(--mono)', fontSize: 9, color: c.text4, letterSpacing: '0.07em' }}>{item.source} · {item.time}</div>
                  </div>
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
        <h1 style={{ fontFamily: 'var(--dmsans)', fontSize: isMobile ? 20 : 22, fontWeight: 600, color: c.text, letterSpacing: '-0.02em', marginBottom: 24 }}>Company Overview</h1>

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

// Auto-aliases stay current without any code changes on our end
const POPULAR_MODELS = [
  { id: 'anthropic/claude-sonnet-4-6',        name: 'Claude Sonnet',     provider: 'Anthropic', alias: true },
  { id: 'anthropic/claude-opus-4',             name: 'Claude Opus',       provider: 'Anthropic', alias: true },
  { id: 'anthropic/claude-haiku-4-5',         name: 'Claude Haiku',      provider: 'Anthropic', alias: true },
  { id: 'openai/gpt-4.1',                     name: 'GPT-4.1',           provider: 'OpenAI',    alias: true },
  { id: 'openai/gpt-4o-mini',                 name: 'GPT-4o mini',       provider: 'OpenAI',    alias: true },
  { id: 'openai/o3',                          name: 'o3',                provider: 'OpenAI',    alias: true },
  { id: 'google/gemini-2.5-pro',              name: 'Gemini 2.5 Pro',    provider: 'Google',    alias: true },
  { id: 'google/gemini-2.5-flash',            name: 'Gemini 2.5 Flash',  provider: 'Google',    alias: true },
  { id: 'meta-llama/llama-3.3-70b-instruct',  name: 'Llama 3.3 70B',    provider: 'Meta' },
  { id: 'mistralai/mistral-large',            name: 'Mistral Large',     provider: 'Mistral' },
  { id: 'deepseek/deepseek-r1',              name: 'DeepSeek R1',        provider: 'DeepSeek' },
  { id: 'x-ai/grok-3',                       name: 'Grok 3',            provider: 'xAI' },
];

const PROVIDER_COLORS = {
  Anthropic: '#d97706', OpenAI: '#10b981', Google: '#4172f5',
  Meta: '#6366f1', Mistral: '#ec4899', DeepSeek: '#06b6d4', xAI: '#f59e0b',
};

function SettingsPage() {
  const c = useC();
  const { token, profile } = useAuth();

  const [isAdmin, setIsAdmin]     = useState(false);
  const [currentModel, setCurrentModel] = useState(null);
  const [hasKey, setHasKey]       = useState(false);
  const [keyHint, setKeyHint]     = useState('');

  const [keyInput, setKeyInput]   = useState('');
  const [showKey, setShowKey]     = useState(false);
  const [selectedModel, setSelectedModel] = useState('');
  const [modelSearch, setModelSearch] = useState('');
  const [allModels, setAllModels] = useState([]);
  const [modelsLoading, setModelsLoading] = useState(false);
  const [saving, setSaving]       = useState(false);
  const [saved, setSaved]         = useState(false);
  const [saveErr, setSaveErr]     = useState('');

  // Load current settings + admin status
  useEffect(() => {
    if (!token) return;
    fetch('/api/workspace/settings', { headers: { Authorization: `Bearer ${token}` } })
      .then(r => r.json())
      .then(d => {
        setCurrentModel(d.model || '');
        setSelectedModel(d.model || '');
        setHasKey(d.hasKey);
        setKeyHint(d.keyHint || '');
      })
      .catch(() => {});

    // Check admin via workspace_members
    fetch('/api/auth/me', { headers: { Authorization: `Bearer ${token}` } })
      .then(r => r.json())
      .then(d => {
        // profile already loaded, but we need to check role
        // We'll fetch workspace_members via a simple check — if settings POST works, they're admin
        setIsAdmin(true); // will be gated server-side; optimistically show UI, server rejects if not admin
      })
      .catch(() => {});
  }, [token]);

  // Load all OpenRouter models directly (public endpoint, no auth needed)
  const loadModels = () => {
    if (allModels.length || modelsLoading) return;
    setModelsLoading(true);
    fetch('https://openrouter.ai/api/v1/models')
      .then(r => r.json())
      .then(d => {
        const models = (d.data || [])
          .filter(m => m.id && m.name)
          .map(m => ({
            id: m.id,
            name: m.name,
            context: m.context_length,
            provider: m.id.split('/')[0],
          }))
          .sort((a, b) => a.name.localeCompare(b.name));
        setAllModels(models);
      })
      .catch(() => {})
      .finally(() => setModelsLoading(false));
  };

  const save = async () => {
    setSaving(true);
    setSaved(false);
    setSaveErr('');
    try {
      const body = { model: selectedModel };
      if (keyInput) body.key = keyInput;
      const r = await fetch('/api/workspace/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify(body),
      });
      const d = await r.json();
      if (!r.ok) { setSaveErr(d.error || 'Save failed'); return; }
      setCurrentModel(selectedModel);
      setHasKey(hasKey || !!keyInput);
      if (keyInput) { setKeyHint(`sk-or-...${keyInput.slice(-4)}`); setKeyInput(''); }
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } catch { setSaveErr('Network error'); }
    finally { setSaving(false); }
  };

  const removeKey = async () => {
    if (!window.confirm('Remove OpenRouter key? The Daemon will stop working until a new key is added.')) return;
    setSaving(true);
    setSaveErr('');
    try {
      const r = await fetch('/api/workspace/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ key: '' }),
      });
      if (r.ok) { setHasKey(false); setKeyHint(''); }
    } catch {}
    setSaving(false);
  };

  const displayModels = modelSearch.trim()
    ? allModels.filter(m =>
        m.name.toLowerCase().includes(modelSearch.toLowerCase()) ||
        m.id.toLowerCase().includes(modelSearch.toLowerCase()) ||
        m.provider.toLowerCase().includes(modelSearch.toLowerCase())
      )
    : allModels;

  const sectionHead = (label) => (
    <p style={{ fontFamily: 'var(--dmsans)', fontSize: 11, fontWeight: 600, letterSpacing: '0.09em', color: c.text3, textTransform: 'uppercase', marginBottom: 14 }}>{label}</p>
  );

  const row = (children, extraStyle = {}) => (
    <div style={{ background: c.card, border: `1px solid ${c.cardBorder}`, borderRadius: 10, padding: '18px 20px', marginBottom: 10, ...extraStyle }}>
      {children}
    </div>
  );

  const inputStyle = (focused) => ({
    width: '100%', padding: '10px 14px', boxSizing: 'border-box',
    background: focused ? (c.d ? 'rgba(255,255,255,0.07)' : '#fff') : c.inputBg,
    border: `1px solid ${focused ? 'rgba(65,114,245,0.5)' : c.inputBorder}`,
    borderRadius: 7, color: c.text, fontSize: 14, fontFamily: 'var(--dmsans)',
    outline: 'none', transition: 'all 0.15s',
    boxShadow: focused ? '0 0 0 2px rgba(65,114,245,0.15)' : 'none',
  });

  return (
    <div style={{ height: '100%', overflowY: 'auto', background: c.bg, transition: 'background 0.2s' }}>
      <div style={{ maxWidth: 680, margin: '0 auto', padding: '48px 32px 80px' }}>

        {/* Header */}
        <div style={{ marginBottom: 40 }}>
          <p className="wd-label-blue" style={{ marginBottom: 6 }}>SETTINGS</p>
          <h1 style={{ fontFamily: 'var(--dmsans)', fontSize: 24, fontWeight: 700, color: c.text, margin: 0 }}>Workspace Settings</h1>
          <p style={{ fontFamily: 'var(--dmsans)', fontSize: 14, color: c.text3, marginTop: 6 }}>
            Configure the AI model for your entire workspace. All team members share the same model and API key.
          </p>
        </div>

        {/* Current model badge (visible to everyone) */}
        {currentModel && row(
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div>
              <p style={{ fontFamily: 'var(--dmsans)', fontSize: 12, color: c.text3, marginBottom: 4 }}>Active model</p>
              <p style={{ fontFamily: 'var(--dmsans)', fontSize: 15, fontWeight: 600, color: c.text }}>
                {POPULAR_MODELS.find(m => m.id === currentModel)?.name || currentModel.split('/')[1] || currentModel}
              </p>
              <p style={{ fontFamily: 'var(--mono)', fontSize: 11, color: c.text3, marginTop: 2 }}>{currentModel}</p>
            </div>
            <div style={{
              padding: '4px 10px', borderRadius: 20,
              background: 'rgba(16,185,129,0.1)', border: '1px solid rgba(16,185,129,0.25)',
              fontFamily: 'var(--dmsans)', fontSize: 11, fontWeight: 600, color: '#10b981',
            }}>ACTIVE</div>
          </div>
        )}

        {/* Admin-only section */}
        {isAdmin && (
          <>
            {/* OpenRouter Key */}
            <div style={{ marginTop: 32, marginBottom: 6 }}>{sectionHead('OpenRouter API Key')}</div>

            {row(<>
              <p style={{ fontFamily: 'var(--dmsans)', fontSize: 13, color: c.text2, marginBottom: 14, lineHeight: 1.55 }}>
                Get your key at{' '}
                <a href="https://openrouter.ai/keys" target="_blank" rel="noreferrer"
                  style={{ color: '#4172f5', textDecoration: 'none' }}>openrouter.ai/keys</a>.
                {' '}It's shared across your whole workspace — all members' Daemon queries use this key.
              </p>

              {hasKey && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12, padding: '8px 12px', background: c.d ? 'rgba(16,185,129,0.06)' : 'rgba(16,185,129,0.04)', border: '1px solid rgba(16,185,129,0.18)', borderRadius: 7 }}>
                  <span style={{ fontSize: 12, color: '#10b981' }}>✓</span>
                  <span style={{ fontFamily: 'var(--mono)', fontSize: 12, color: c.text2, flex: 1 }}>{keyHint}</span>
                  <button type="button" onClick={removeKey} style={{ fontFamily: 'var(--dmsans)', fontSize: 11, color: '#ef4444', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}>Remove</button>
                </div>
              )}

              <KeyInput
                value={keyInput}
                onChange={setKeyInput}
                show={showKey}
                onToggleShow={() => setShowKey(s => !s)}
                placeholder={hasKey ? 'Paste new key to replace…' : 'sk-or-v1-…'}
                inputStyle={inputStyle}
                c={c}
              />
            </>)}

            {/* Model selector */}
            <div style={{ marginTop: 32, marginBottom: 6 }}>{sectionHead('Company Model')}</div>

            {row(<>
              <p style={{ fontFamily: 'var(--dmsans)', fontSize: 13, color: c.text2, marginBottom: 16, lineHeight: 1.55 }}>
                Pick from 300+ models on OpenRouter. Everyone in your workspace uses this model.
              </p>

              {/* Popular quick-select */}
              <p style={{ fontFamily: 'var(--dmsans)', fontSize: 11, color: c.text3, marginBottom: 10, letterSpacing: '0.06em', textTransform: 'uppercase' }}>Popular</p>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 6, marginBottom: 20 }}>
                {POPULAR_MODELS.map(m => {
                  const sel = selectedModel === m.id;
                  const pColor = PROVIDER_COLORS[m.provider] || '#4172f5';
                  return (
                    <button key={m.id} type="button" onClick={() => setSelectedModel(m.id)}
                      style={{
                        padding: '10px 12px', textAlign: 'left', cursor: 'pointer',
                        background: sel ? `${pColor}14` : c.subtle,
                        border: `1px solid ${sel ? pColor + '44' : c.subtleBorder}`,
                        borderRadius: 8, transition: 'all 0.12s',
                      }}
                    >
                      <div style={{ fontFamily: 'var(--dmsans)', fontSize: 12, fontWeight: 600, color: sel ? pColor : c.text, marginBottom: 2 }}>{m.name}</div>
                      <div style={{ fontFamily: 'var(--dmsans)', fontSize: 10, color: c.text3 }}>{m.provider}</div>
                    </button>
                  );
                })}
              </div>

              {/* Full model search */}
              <p style={{ fontFamily: 'var(--dmsans)', fontSize: 11, color: c.text3, marginBottom: 10, letterSpacing: '0.06em', textTransform: 'uppercase' }}>All models</p>
              <ModelSearch
                value={modelSearch}
                onChange={setModelSearch}
                onFocus={loadModels}
                loading={modelsLoading}
                models={displayModels}
                selected={selectedModel}
                onSelect={setSelectedModel}
                inputStyle={inputStyle}
                c={c}
              />
            </>)}

            {/* Custom model ID */}
            {row(
              <div>
                <p style={{ fontFamily: 'var(--dmsans)', fontSize: 13, fontWeight: 600, color: c.text, marginBottom: 4 }}>Custom model ID</p>
                <p style={{ fontFamily: 'var(--dmsans)', fontSize: 12, color: c.text3, marginBottom: 12 }}>Paste any OpenRouter model ID directly.</p>
                <CustomModelInput value={selectedModel} onChange={setSelectedModel} inputStyle={inputStyle} c={c} />
              </div>
            )}

            {/* Save bar */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 24 }}>
              <button
                type="button"
                onClick={save}
                disabled={saving || (!keyInput && !selectedModel)}
                style={{
                  padding: '10px 24px', borderRadius: 8, cursor: saving ? 'wait' : 'pointer',
                  background: '#4172f5', border: 'none',
                  fontFamily: 'var(--dmsans)', fontSize: 13, fontWeight: 600, color: '#fff',
                  opacity: saving || (!keyInput && !selectedModel) ? 0.5 : 1,
                  transition: 'opacity 0.15s',
                }}
              >
                {saving ? 'Saving…' : 'Save Settings'}
              </button>
              {saved && <span style={{ fontFamily: 'var(--dmsans)', fontSize: 13, color: '#10b981' }}>✓ Saved</span>}
              {saveErr && <span style={{ fontFamily: 'var(--dmsans)', fontSize: 13, color: '#ef4444' }}>{saveErr}</span>}
            </div>
          </>
        )}

        {!isAdmin && !currentModel && (
          <div style={{ marginTop: 24, fontFamily: 'var(--dmsans)', fontSize: 14, color: c.text3 }}>
            No model configured yet. Ask your workspace admin to set up an OpenRouter key.
          </div>
        )}
      </div>
    </div>
  );
}

function KeyInput({ value, onChange, show, onToggleShow, placeholder, inputStyle, c }) {
  const [focused, setFocused] = useState(false);
  return (
    <div style={{ position: 'relative' }}>
      <input
        type={show ? 'text' : 'password'}
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        style={{ ...inputStyle(focused), paddingRight: 44 }}
        autoComplete="off"
        spellCheck={false}
      />
      <button type="button" onClick={onToggleShow}
        style={{ position: 'absolute', right: 12, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer', color: c.text3, fontSize: 13, padding: 0 }}>
        {show ? 'hide' : 'show'}
      </button>
    </div>
  );
}

function ModelSearch({ value, onChange, onFocus, loading, models, selected, onSelect, inputStyle, c }) {
  const [focused, setFocused] = useState(false);
  const [open, setOpen] = useState(false);

  return (
    <div style={{ position: 'relative' }}>
      <input
        value={value}
        onChange={e => { onChange(e.target.value); setOpen(true); }}
        onFocus={() => { setFocused(true); setOpen(true); onFocus(); }}
        onBlur={() => { setFocused(false); setTimeout(() => setOpen(false), 180); }}
        placeholder="Search models…"
        style={{ ...inputStyle(focused), borderRadius: open && models.length ? '7px 7px 0 0' : 7 }}
      />
      {open && (
        <div style={{
          position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 60,
          background: c.card, border: `1px solid rgba(65,114,245,0.35)`,
          borderTop: 'none', borderRadius: '0 0 8px 8px',
          maxHeight: 280, overflowY: 'auto',
          boxShadow: '0 8px 24px rgba(0,0,0,0.25)',
        }}>
          {loading && <div style={{ padding: '12px 16px', fontFamily: 'var(--dmsans)', fontSize: 13, color: c.text3 }}>Loading models…</div>}
          {!loading && models.length === 0 && <div style={{ padding: '12px 16px', fontFamily: 'var(--dmsans)', fontSize: 13, color: c.text3 }}>No matches</div>}
          {models.slice(0, 80).map(m => {
            const sel = selected === m.id;
            const pColor = PROVIDER_COLORS[m.provider] || '#4172f5';
            return (
              <button key={m.id} type="button" onMouseDown={() => { onSelect(m.id); onChange(''); setOpen(false); }}
                style={{
                  width: '100%', textAlign: 'left', padding: '9px 14px',
                  background: sel ? `${pColor}10` : 'transparent',
                  border: 'none', borderBottom: `1px solid ${c.cardBorder}`,
                  cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 10,
                }}>
                <span style={{ fontFamily: 'var(--dmsans)', fontSize: 12, fontWeight: 500, color: sel ? pColor : c.text, flex: 1 }}>{m.name}</span>
                <span style={{ fontFamily: 'var(--mono)', fontSize: 10, color: c.text3 }}>{m.provider}</span>
                {m.context && <span style={{ fontFamily: 'var(--dmsans)', fontSize: 10, color: c.text4 }}>{(m.context / 1000).toFixed(0)}k</span>}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

function CustomModelInput({ value, onChange, inputStyle, c }) {
  const [focused, setFocused] = useState(false);
  const isCustom = value && !POPULAR_MODELS.find(m => m.id === value);
  return (
    <input
      value={isCustom ? value : ''}
      onChange={e => onChange(e.target.value)}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      placeholder="anthropic/claude-sonnet-4-6"
      style={inputStyle(focused)}
    />
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
          <Route path="integrations" element={<PlaceholderPage label="INTEGRATIONS" title="Your Integrations" />} />
          <Route path="overview"     element={<AdminRoute isAdmin={isAdmin}><OverviewPage /></AdminRoute>} />
          <Route path="team"         element={<AdminRoute isAdmin={isAdmin}><PlaceholderPage label="ADMIN" title="Team Management" /></AdminRoute>} />
          <Route path="audit"        element={<AdminRoute isAdmin={isAdmin}><PlaceholderPage label="ADMIN" title="Audit Log" /></AdminRoute>} />
          <Route path="settings"     element={<SettingsPage />} />
        </Routes>
      </div>
    </div>
  );
}
