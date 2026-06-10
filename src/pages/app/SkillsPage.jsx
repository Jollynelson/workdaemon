// Extracted from the former 5,000-line src/pages/Dashboard.jsx (2026-06-10 split).
import { useState, useEffect, useCallback } from 'react';
import { useViewport } from '../../context/ThemeContext.jsx';
import { useAuth } from '../../context/AuthContext.jsx';
import { useC, mkGhostBtn } from '../../lib/theme.jsx';
import { SkeletonRow } from '../../components/ui.jsx';

export function SkillsPage() {
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

export default SkillsPage;
