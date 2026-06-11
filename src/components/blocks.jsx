// Extracted from the former 5,000-line src/pages/Dashboard.jsx (2026-06-10 split).
import { useState } from 'react';
import { useViewport } from '../context/ThemeContext.jsx';
import { useC, CHART_COLORS, ACCENT_COLORS } from '../lib/theme.jsx';
import { Md } from '../components/ui.jsx';
import { BarChart, Bar, LineChart, Line, AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts';

export function BlockBoot({ block }) {
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
              <span style={{ fontFamily: 'var(--mono)', fontSize: 12, color: statusColor[s] || '#3b6ef7', width: 14, flexShrink: 0, marginTop: 1 }}>{statusIcon[s] || '·'}</span>
              <span style={{ fontFamily: 'var(--mono)', fontSize: 10, color: c.text3, width: 130, flexShrink: 0, letterSpacing: '0.05em', paddingTop: 1 }}>{line.label}</span>
              <span style={{ fontFamily: 'var(--dmsans)', fontSize: 13, color: c.text2, flex: 1, lineHeight: 1.4 }}>{line.detail}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function BlockText({ block }) {
  const c = useC();
  if (block.md) return <Md text={block.md} c={c} />;
  return <div style={{ fontFamily: 'var(--dmsans)', fontSize: 15, color: c.text2, lineHeight: 1.75 }}>{block.content}</div>;
}

export function BlockStatGrid({ block }) {
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

export function BlockChartBar({ block }) {
  const c = useC();
  return (
    <div>
      {block.title && <p style={{ fontFamily: 'var(--mono)', fontSize: 10, color: c.text3, letterSpacing: '0.1em', marginBottom: 12 }}>{block.title.toUpperCase()}</p>}
      <ResponsiveContainer width="100%" height={180}>
        <BarChart data={block.data || []} margin={{ top: 4, right: 4, bottom: 4, left: -20 }}>
          <CartesianGrid stroke={c.d ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.06)'} vertical={false} />
          <XAxis dataKey="name" tick={{ fontFamily: 'var(--mono)', fontSize: 9, fill: c.text3 }} axisLine={false} tickLine={false} />
          <YAxis tick={{ fontFamily: 'var(--mono)', fontSize: 9, fill: c.text4 }} axisLine={false} tickLine={false} />
          <Tooltip contentStyle={{ background: c.surface, border: `1px solid ${c.cardBorder}`, borderRadius: 8, fontFamily: 'var(--mono)', fontSize: 11, color: c.text }} labelStyle={{ color: c.text3 }} itemStyle={{ color: '#3b6ef7' }} />
          {(block.keys || ['value']).map((k, i) => <Bar key={k} dataKey={k} fill={CHART_COLORS[i % CHART_COLORS.length]} radius={[3, 3, 0, 0]} />)}
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

export function BlockChartLine({ block }) {
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
          <Tooltip contentStyle={{ background: c.surface, border: `1px solid ${c.cardBorder}`, borderRadius: 8, fontFamily: 'var(--mono)', fontSize: 11, color: c.text }} labelStyle={{ color: c.text3 }} itemStyle={{ color: '#3b6ef7' }} />
          {(block.keys || ['value']).map((k, i) => (
            <DataComp key={k} dataKey={k} stroke={CHART_COLORS[i % CHART_COLORS.length]} strokeWidth={2} dot={false}
              {...(block.filled ? { fill: `${CHART_COLORS[i % CHART_COLORS.length]}18`, fillOpacity: 1 } : {})} />
          ))}
        </ChartComp>
      </ResponsiveContainer>
    </div>
  );
}

export function BlockAlert({ block }) {
  const c = useC();
  const styles = {
    info:     { leftBorder: '#3b6ef7', title: '#3b6ef7', icon: 'ℹ', tintClass: 'wd-block-alert-info' },
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

export function BlockPeopleList({ block }) {
  const c = useC();
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {(block.people || []).map((p, i) => (
        <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '11px 14px', background: c.row, border: `1px solid ${c.rowBorder}`, borderRadius: 9 }}>
          <div style={{ width: 34, height: 34, borderRadius: '50%', background: '#3b6ef7', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'var(--orbitron)', fontSize: 11, fontWeight: 700, color: '#fff', flexShrink: 0 }}>
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

export function BlockTimeline({ block }) {
  const c = useC();
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
      {(block.events || []).map((ev, i) => (
        <div key={i} style={{ display: 'flex', gap: 14, paddingBottom: i < block.events.length - 1 ? 16 : 0 }}>
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', flexShrink: 0 }}>
            <div style={{ width: 9, height: 9, borderRadius: '50%', background: ev.accent ? '#3b6ef7' : c.rowBorder, border: `2px solid ${ev.accent ? '#3b6ef7' : c.subtleBorder}`, marginTop: 4, flexShrink: 0 }} />
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

export function BlockProgressBars({ block }) {
  const c = useC();
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      {(block.items || []).map((item, i) => {
        const pct = item.value != null ? item.value
          : item.target > 0 ? Math.round((item.current / item.target) * 100) : 0;
        const barColor = item.color || (item.status === 'danger' ? '#ef4444' : item.status === 'warn' ? '#f59e0b' : '#3b6ef7');
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

export function BlockKanban({ block }) {
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

export function BlockActionConfirm({ block, onConfirm, onCancel, onExecPlan }) {
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
                  {step && typeof step === 'object' && step.exec && <span style={{ marginLeft: 7, fontFamily: 'var(--mono)', fontSize: 8.5, letterSpacing: '0.06em', color: '#3b6ef7', background: 'rgba(59,110,247,0.09)', border: '1px solid rgba(59,110,247,0.2)', borderRadius: 5, padding: '1px 6px', whiteSpace: 'nowrap' }}>⚙ {step.exec.name}</span>}
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

export function BlockActionDone({ block }) {
  const c = useC();
  return (
    <div style={{ padding: '12px 16px', background: c.d ? 'rgba(16,185,129,0.08)' : 'rgba(16,185,129,0.06)', border: '1px solid rgba(16,185,129,0.22)', borderLeft: '3px solid #10b981', borderRadius: '0 10px 10px 0' }}>
      <div style={{ fontFamily: 'var(--dmsans)', fontSize: 13, color: '#10b981', lineHeight: 1.6 }}>{block.summary}</div>
    </div>
  );
}

// Just-in-time connect card (IA §9.3 "Connect to act") — the daemon needs a
// tool that isn't connected for THIS request; one click takes the user to the
// Integrations page. Always rendered AFTER whatever the daemon could answer
// from public data, never as a substitute for it.
const CONNECT_LABELS = { google: 'Google (Gmail · Calendar · Drive)', notion: 'Notion', slack: 'Slack', github: 'GitHub' };
export function BlockConnect({ block }) {
  const c = useC();
  const label = CONNECT_LABELS[block.provider] || (block.provider ? block.provider[0].toUpperCase() + block.provider.slice(1) : 'a tool');
  return (
    <div style={{ padding: '14px 16px', background: 'rgba(59,110,247,0.06)', border: '1px solid rgba(59,110,247,0.22)', borderRadius: 12, display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>
      <div style={{ width: 34, height: 34, borderRadius: 9, background: 'rgba(59,110,247,0.12)', border: '1px solid rgba(59,110,247,0.28)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#3b6ef7', flexShrink: 0 }}>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
          <path d="M9 17H7A5 5 0 0 1 7 7h2" /><path d="M15 7h2a5 5 0 1 1 0 10h-2" /><line x1="8" x2="16" y1="12" y2="12" />
        </svg>
      </div>
      <div style={{ flex: 1, minWidth: 200 }}>
        <div style={{ fontFamily: 'var(--dmsans)', fontSize: 14, fontWeight: 600, color: c.text }}>{block.title || `Connect ${label}`}</div>
        {block.reason && <div style={{ fontFamily: 'var(--dmsans)', fontSize: 12.5, color: c.text3, marginTop: 2, lineHeight: 1.5 }}>{block.reason}</div>}
      </div>
      <a href="/app/integrations" style={{
        padding: '8px 16px', borderRadius: 8, background: '#3b6ef7', color: '#fff',
        fontFamily: 'var(--dmsans)', fontSize: 13, fontWeight: 600, whiteSpace: 'nowrap', flexShrink: 0,
      }}>
        Connect {label.split(' ')[0]}
      </a>
    </div>
  );
}

// Adaptive action card — the daemon proposes something the user approves in one
// click; the buttons adapt to the conversation (Verify & Apply / Reject for a
// tool mutation, Copy / Email for produced content). A button's `exec` runs a
// real tool via /api/tasks execute_action; `copy` copies `body`; neither dismisses.
export function BlockStagedAction({ block, onExec }) {
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
    ? { color: '#fff', background: '#3b6ef7', border: 'none' }
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
            <div style={{ width: 3, alignSelf: 'stretch', background: '#3b6ef7', borderRadius: 2, minHeight: 18 }} />
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
export function BlockBroadcast({ block, onBroadcast }) {
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

export function BlockInvoiceTable({ block }) {
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

export function renderBlock(block, i, { onConfirm, onCancel, onBroadcast, onExec, onExecPlan } = {}) {
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
    case 'connect':        return wrap(<BlockConnect block={block} />);
    default:               return wrap(<BlockText block={{ md: typeof block === 'string' ? block : JSON.stringify(block) }} />);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// CHAT API
// ─────────────────────────────────────────────────────────────────────────────

