// Extracted from the former 5,000-line src/pages/Dashboard.jsx (2026-06-10 split).
import { useState, useEffect, useCallback } from 'react';
import { useViewport } from '../../context/ThemeContext.jsx';
import { useAuth } from '../../context/AuthContext.jsx';
import { useC } from '../../lib/theme.jsx';
import { SkeletonRow, EmptyState } from '../../components/ui.jsx';
import { BlockAlert } from '../../components/blocks.jsx';

export const BRAIN_FIELDS = [
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

export function CompanyContextForm({ token, c, isMobile }) {
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
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 20, padding: '12px 16px', borderRadius: 10, background: filled > 0 ? 'rgba(16,185,129,0.05)' : 'rgba(59,110,247,0.05)', border: `1px solid ${filled > 0 ? 'rgba(16,185,129,0.2)' : 'rgba(59,110,247,0.15)'}` }}>
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
          style={{ padding: '10px 24px', borderRadius: 8, border: 'none', cursor: saving ? 'wait' : 'pointer', background: saving ? 'rgba(59,110,247,0.5)' : '#3b6ef7', fontFamily: 'var(--dmsans)', fontSize: 13, fontWeight: 600, color: '#fff', transition: 'all 0.15s' }}
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

export const HUNT_MODES = [
  { key: 'threat',      label: 'THREAT HUNT',      icon: '◈', color: '#ef4444', desc: 'Churn, cash flow, legal, staff risk' },
  { key: 'waste',       label: 'WASTE HUNT',        icon: '⊗', color: '#f59e0b', desc: 'Redundancies, inefficiencies, unused tools' },
  { key: 'opportunity', label: 'OPPORTUNITY HUNT',  icon: '◇', color: '#10b981', desc: 'Upsells, partnerships, underutilised talent' },
  { key: 'performance', label: 'PERFORMANCE HUNT',  icon: '▣', color: '#3b6ef7', desc: 'Team performance, burnout, overload signals' },
  { key: 'knowledge',   label: 'KNOWLEDGE HUNT',    icon: '○', color: '#8b5cf6', desc: 'Knowledge gaps, missing documentation' },
];

export const SEVERITY_STYLE = {
  critical: { bg: 'rgba(239,68,68,0.08)',  border: 'rgba(239,68,68,0.25)',  color: '#ef4444', leftBorder: '#ef4444' },
  warning:  { bg: 'rgba(245,158,11,0.07)', border: 'rgba(245,158,11,0.22)', color: '#f59e0b', leftBorder: '#f59e0b' },
  info:     { bg: 'rgba(59,110,247,0.06)', border: 'rgba(59,110,247,0.18)', color: '#3b6ef7', leftBorder: '#3b6ef7' },
};

export function HuntFindingCard({ finding, onResolve, c }) {
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

export function HuntTab({ token, c, isMobile }) {
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
            background: scanning ? 'rgba(59,110,247,0.4)' : '#3b6ef7',
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

export const ACCESS_LEVELS = ['junior', 'manager', 'director', 'executive'];
export const ACCESS_TOOLS = {
  junior:    ['Slack', 'Notion', 'Google Drive'],
  manager:   ['Slack', 'Notion', 'Google Drive', 'CRM', 'Project Tools'],
  director:  ['Slack', 'Notion', 'Google Drive', 'CRM', 'Finance', 'HR System'],
  executive: ['All Tools — Full Company Access'],
};
export const ACCESS_COLOR = { junior: '#8b5cf6', manager: '#3b6ef7', director: '#f59e0b', executive: '#10b981' };

export function AgentProfileCard({ agent, token, onUpdated, c }) {
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

  const ac = ACCESS_COLOR[agent.access_level] || '#3b6ef7';
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
                style={{ padding: '5px 12px', borderRadius: 6, background: '#3b6ef7', border: 'none', fontFamily: 'var(--dmsans)', fontSize: 11, fontWeight: 600, color: '#fff', cursor: saving ? 'wait' : 'pointer' }}>
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
export const PILLAR_LABELS = {
  knowledge: 'Knowledge', research: 'Research', content: 'Content', growth: 'Growth',
  productivity: 'Productivity', devops: 'Ops', memory: 'Memory', crons: 'Cadence',
  soul: 'Identity', self_improvement: 'Self-Improvement', skills: 'Core',
};
export function SkillsTab({ token, c, isMobile }) {
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
          style={{ padding: '9px 16px', borderRadius: 9, background: '#3b6ef7', border: 'none', color: '#fff', fontFamily: 'var(--inter)', fontSize: 13, fontWeight: 500, cursor: discovering ? 'default' : 'pointer', opacity: discovering ? 0.6 : 1 }}>
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
                      {s.source_url && <div style={{ marginTop: 8 }}><a href={s.source_url} target="_blank" rel="noreferrer" style={{ fontFamily: 'var(--mono)', fontSize: 11, color: '#3b6ef7' }}>source ↗</a></div>}
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

export function AgentsTab({ token, c, isMobile }) {
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
      <div style={{ padding: '12px 16px', borderRadius: 9, background: 'rgba(59,110,247,0.05)', border: '1px solid rgba(59,110,247,0.15)', marginBottom: 20 }}>
        <p style={{ fontFamily: 'var(--dmsans)', fontSize: 12, color: c.text2, lineHeight: 1.6, margin: 0 }}>
          <strong style={{ color: '#3b6ef7' }}>Access levels</strong> control what tools and data each Daemon agent can see.
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

export const TOOL_CATALOG = [
  { name: 'Notion',          icon: 'N',  category: 'Knowledge',     color: '#191919', hunt: ['knowledge','waste'] },
  { name: 'Slack',           icon: 'S',  category: 'Communication', color: '#4a154b', hunt: ['threat','performance','knowledge'] },
  { name: 'Google Drive',    icon: 'G',  category: 'Knowledge',     color: '#3b6ef7', hunt: ['knowledge'] },
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

export function IntegrationsTab({ c, isMobile }) {
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
                        <span key={h} style={{ fontFamily: 'var(--mono)', fontSize: 8, color: mode?.color || '#3b6ef7', background: `${mode?.color || '#3b6ef7'}12`, border: `1px solid ${mode?.color || '#3b6ef7'}25`, borderRadius: 3, padding: '1px 5px', letterSpacing: '0.07em' }}>
                          {mode?.icon} {h}
                        </span>
                      );
                    })}
                  </div>
                </div>
                <span style={{ fontFamily: 'var(--mono)', fontSize: 9, letterSpacing: '0.08em', color: '#3b6ef7', background: 'rgba(59,110,247,0.08)', border: '1px solid rgba(59,110,247,0.2)', borderRadius: 5, padding: '4px 10px', cursor: 'pointer' }}>
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
export function GraphTab({ token, c, isMobile }) {
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
          The Brain's relationship map — who <strong style={{ color: '#3b6ef7' }}>owns</strong> what, what those tasks <strong style={{ color: c.text2 }}>address</strong>, and which risks <strong style={{ color: '#ef4444' }}>affect</strong> whom.
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
                return <path key={i} d={`M ${x1} ${y1} C ${mx} ${y1}, ${mx} ${y2}, ${x2} ${y2}`} fill="none" stroke={e.rel === 'owns' ? 'rgba(59,110,247,0.35)' : c.text4} strokeWidth={1.2} opacity={0.7} />;
              })}
              {/* nodes */}
              {people.map(n => <NodeRect key={n.node_key} k={n.node_key} fill={c.bg} stroke="rgba(59,110,247,0.4)" accent="#3b6ef7" />)}
              {tasks.map(n => <NodeRect key={n.node_key} k={n.node_key} fill={c.bg} stroke={c.subtleBorder} accent={n.meta?.routed_by_brain ? '#3b6ef7' : c.text4} />)}
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

// ── GOALS — the brain's self-upgrading ambition engine ────────────────────────
// Company goals written at workspace creation; staff-daemon goals at onboarding.
// The daily review measures progress from real activity, raises the bar on wins,
// adjusts mis-aimed goals, adds new ones, and escalates stalls.
const AMBITION_STYLE = {
  moonshot: { col: '#a855f7', label: 'MOONSHOT' },
  stretch:  { col: '#f59e0b', label: 'STRETCH' },
  baseline: { col: '#10b981', label: 'BASELINE' },
};
const GOAL_STATUS_STYLE = {
  active:   { col: '#3b6ef7', label: 'ACTIVE' },
  achieved: { col: '#10b981', label: 'ACHIEVED' },
  missed:   { col: '#ef4444', label: 'MISSED' },
};

function GoalCard({ g, c, onStatus }) {
  const amb = AMBITION_STYLE[g.ambition] || AMBITION_STYLE.stretch;
  const st = GOAL_STATUS_STYLE[g.status] || GOAL_STATUS_STYLE.active;
  const pct = Math.max(0, Math.min(100, g.progress || 0));
  const due = g.due_at ? new Date(g.due_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : null;
  const overdue = g.status === 'active' && g.due_at && new Date(g.due_at) < new Date();
  return (
    <div style={{ padding: '14px 16px', background: c.card, border: `1px solid ${c.cardBorder}`, borderRadius: 12, opacity: g.status === 'active' ? 1 : 0.75 }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 10 }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 7, flexWrap: 'wrap', marginBottom: 4 }}>
            <span style={{ fontFamily: 'var(--mono)', fontSize: 8.5, letterSpacing: '0.08em', color: amb.col, border: `1px solid ${amb.col}40`, borderRadius: 5, padding: '2px 6px' }}>{amb.label}</span>
            {g.status !== 'active' && <span style={{ fontFamily: 'var(--mono)', fontSize: 8.5, letterSpacing: '0.08em', color: st.col, border: `1px solid ${st.col}40`, borderRadius: 5, padding: '2px 6px' }}>{st.label}</span>}
            {g.parent_goal_id && <span style={{ fontFamily: 'var(--mono)', fontSize: 8.5, letterSpacing: '0.08em', color: c.text4 }}>↑ BAR RAISED</span>}
            {g.owner_name && <span style={{ fontFamily: 'var(--mono)', fontSize: 8.5, letterSpacing: '0.08em', color: c.text4 }}>{g.owner_name.toUpperCase()}</span>}
          </div>
          <div style={{ fontFamily: 'var(--dmsans)', fontSize: 14.5, fontWeight: 600, color: c.text, lineHeight: 1.35 }}>{g.title}</div>
          {(g.metric || g.target) && (
            <div style={{ fontFamily: 'var(--dmsans)', fontSize: 12.5, color: c.text3, marginTop: 3 }}>
              {g.target ? <>Target: <span style={{ color: c.text2, fontWeight: 600 }}>{g.target}</span></> : null}
              {g.metric ? <span> · measured by {g.metric}</span> : null}
              {due ? <span style={{ color: overdue ? '#ef4444' : c.text4 }}> · due {due}</span> : null}
            </div>
          )}
          {g.review_note && <div style={{ fontFamily: 'var(--dmsans)', fontSize: 12, color: c.text3, marginTop: 6, fontStyle: 'italic' }}>Brain: {g.review_note}</div>}
        </div>
        {onStatus && g.status === 'active' && (
          <button type="button" onClick={() => onStatus(g, 'retired')} title="Retire this goal"
            style={{ background: 'none', border: 'none', color: c.text4, cursor: 'pointer', fontFamily: 'var(--mono)', fontSize: 9, letterSpacing: '0.06em', padding: '2px 4px', flexShrink: 0 }}>
            RETIRE
          </button>
        )}
      </div>
      <div style={{ marginTop: 10, display: 'flex', alignItems: 'center', gap: 10 }}>
        <div style={{ flex: 1, height: 5, background: c.subtle, borderRadius: 3, overflow: 'hidden' }}>
          <div style={{ width: `${pct}%`, height: '100%', borderRadius: 3, background: g.status === 'achieved' ? '#10b981' : pct >= 60 ? '#10b981' : pct >= 25 ? '#f59e0b' : '#3b6ef7', transition: 'width 0.4s' }} />
        </div>
        <span style={{ fontFamily: 'var(--mono)', fontSize: 10.5, color: c.text2, width: 34, textAlign: 'right' }}>{pct}%</span>
      </div>
    </div>
  );
}

export function GoalsTab({ token, c, isMobile }) {
  const [goals, setGoals] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(null); // 'review' | 'generate'
  const [note, setNote] = useState(null);

  const load = useCallback(() => {
    if (!token) return Promise.resolve();
    return fetch('/api/brain?tab=goals', { headers: { Authorization: `Bearer ${token}` } })
      .then(r => r.json()).then(d => setGoals(d.goals || [])).catch(() => {});
  }, [token]);
  useEffect(() => { load().finally(() => setLoading(false)); }, [load]);

  const act = async (action, okText) => {
    setBusy(action); setNote(null);
    try {
      const r = await fetch('/api/brain', {
        method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ action, ...(action === 'generate_goals' ? { force: false } : {}) }),
      });
      const d = await r.json().catch(() => ({}));
      if (r.ok) {
        setNote(action === 'review_goals'
          ? (d.reviewed ? `Reviewed ${d.reviewed} — ${d.achieved || 0} achieved (bar raised), ${d.adjusted || 0} upgraded, ${d.added || 0} added.` : (d.reason === 'recent' ? 'Reviewed recently — the brain re-reviews about once a day.' : okText))
          : (d.generated ? `Brain set ${d.generated} new goal${d.generated > 1 ? 's' : ''}.` : (d.reason === 'exists' ? 'Goals already active — the daily review keeps upgrading them.' : okText)));
        await load();
      } else setNote(d.error || 'Action failed.');
    } catch { setNote('Action failed — try again.'); }
    setBusy(null);
  };

  const setStatus = async (g, status) => {
    try {
      await fetch('/api/brain', {
        method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ action: 'update_goal', id: g.id, status }),
      });
      await load();
    } catch { /* non-critical */ }
  };

  if (loading) return <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>{Array.from({ length: 4 }).map((_, i) => <SkeletonRow key={i} height={84} />)}</div>;

  const company = goals.filter(g => g.scope === 'company' && g.status === 'active');
  const staff = goals.filter(g => g.scope === 'staff' && g.status === 'active');
  const settled = goals.filter(g => g.status !== 'active').slice(0, 8);
  const achievedCount = goals.filter(g => g.status === 'achieved').length;

  return (
    <div>
      <BlockAlert block={{ level: 'info', title: 'THE AMBITION ENGINE', content: `The Brain writes its own goal book the moment a company exists — deliberately aggressive, measured against real activity daily. It raises the bar on every win, upgrades targets that prove too easy, and adds goals when the data reveals an opening. ${achievedCount ? `${achievedCount} goal${achievedCount > 1 ? 's' : ''} achieved so far — each one spawned a harder successor.` : 'Every achieved goal spawns a harder successor.'}` }} />
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, margin: '14px 0 18px', flexWrap: 'wrap' }}>
        <button type="button" onClick={() => act('review_goals', 'Review complete.')} disabled={Boolean(busy)}
          style={{ padding: '9px 16px', borderRadius: 9, background: '#3b6ef7', border: 'none', color: '#fff', fontFamily: 'var(--inter)', fontSize: 13, fontWeight: 500, cursor: busy ? 'default' : 'pointer', opacity: busy ? 0.6 : 1 }}>
          {busy === 'review_goals' ? 'Reviewing against real activity…' : '⟳ Review & upgrade now'}
        </button>
        <button type="button" onClick={() => act('generate_goals', 'Done.')} disabled={Boolean(busy)}
          style={{ padding: '9px 16px', borderRadius: 9, background: 'rgba(59,110,247,0.1)', border: '1px solid rgba(59,110,247,0.3)', color: '#3b6ef7', fontFamily: 'var(--inter)', fontSize: 13, fontWeight: 500, cursor: busy ? 'default' : 'pointer', opacity: busy ? 0.6 : 1 }}>
          {busy === 'generate_goals' ? 'Writing goals…' : '✦ Generate goals'}
        </button>
        {note && <span style={{ fontFamily: 'var(--inter)', fontSize: 13, color: c.text2 }}>{note}</span>}
      </div>

      {!company.length && !staff.length && (
        <p style={{ fontFamily: 'var(--dmsans)', fontSize: 14, color: c.text3 }}>
          No active goals yet — hit “Generate goals” and the Brain writes the company's first goal book in seconds.
        </p>
      )}

      {company.length > 0 && (<>
        <p className="wd-label-blue" style={{ marginBottom: 10 }}>COMPANY GOALS</p>
        <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : 'repeat(2, 1fr)', gap: 10, marginBottom: 22 }}>
          {company.map(g => <GoalCard key={g.id} g={g} c={c} onStatus={setStatus} />)}
        </div>
      </>)}

      {staff.length > 0 && (<>
        <p className="wd-label-blue" style={{ marginBottom: 10 }}>STAFF DAEMON GOALS</p>
        <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : 'repeat(2, 1fr)', gap: 10, marginBottom: 22 }}>
          {staff.map(g => <GoalCard key={g.id} g={g} c={c} onStatus={setStatus} />)}
        </div>
      </>)}

      {settled.length > 0 && (<>
        <p className="wd-label-blue" style={{ marginBottom: 10 }}>RECENTLY SETTLED</p>
        <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : 'repeat(2, 1fr)', gap: 10 }}>
          {settled.map(g => <GoalCard key={g.id} g={g} c={c} />)}
        </div>
      </>)}
    </div>
  );
}

export function BrainPage() {
  const c = useC();
  const { isMobile } = useViewport();
  const { token } = useAuth();
  const [activeTab, setActiveTab] = useState('overview');

  const TABS = [
    { key: 'overview',      label: 'OVERVIEW' },
    { key: 'goals',         label: 'GOALS' },
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
                borderBottom: `2px solid ${activeTab === t.key ? '#3b6ef7' : 'transparent'}`,
                fontFamily: 'var(--mono)', fontSize: isMobile ? 9 : 10, letterSpacing: '0.1em',
                color: activeTab === t.key ? '#3b6ef7' : c.text3,
                cursor: 'pointer', marginBottom: -1, whiteSpace: 'nowrap', transition: 'all 0.15s',
              }}>
              {t.label}
            </button>
          ))}
        </div>

        {activeTab === 'overview'     && <CompanyContextForm token={token} c={c} isMobile={isMobile} />}
        {activeTab === 'goals'        && <GoalsTab token={token} c={c} isMobile={isMobile} />}
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


export default BrainPage;
