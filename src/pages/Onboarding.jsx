import { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import DaemonMark from '../components/brand/DaemonMark.jsx';
import { useViewport } from '../context/ThemeContext.jsx';
import { useAuth } from '../context/AuthContext.jsx';

// Founder onboarding — mirrors the IA spec §1: Account (signup) → Company
// details → Your Daemon setup → Connect first integration → Invite team → land.
const STEPS = [
  { id: 'company',     title: 'Company details.',         sub: 'Name, size, industry, and your work domain.' },
  { id: 'daemon',      title: 'Set up your Daemon.',      sub: 'Who you are and the role it adapts to.' },
  { id: 'integration', title: 'Connect your first tool.', sub: 'Seeds the Company Brain. Google Workspace recommended.' },
  { id: 'invite',      title: 'Invite your team.',        sub: 'WorkDaemon is better with your whole team.' },
];

const ROLES = [
  { id: 'ceo',     label: 'CEO / Founder',   sub: 'Strategy & company vision' },
  { id: 'cto',     label: 'CTO',             sub: 'Engineering & architecture' },
  { id: 'pm',      label: 'Product Manager', sub: 'Roadmap & prioritization' },
  { id: 'eng',     label: 'Eng Lead',        sub: 'Sprints & code review' },
  { id: 'sales',   label: 'Head of Sales',   sub: 'Pipeline & revenue' },
  { id: 'hr',      label: 'Head of People / HR', sub: 'Hiring & culture' },
  { id: 'ops',     label: 'Operations',      sub: 'Processes & logistics' },
  { id: 'design',  label: 'Design Lead',     sub: 'UX & visual systems' },
  { id: 'finance', label: 'Finance',         sub: 'Budget & reporting' },
];

const INDUSTRIES = [
  { id: 'tech',       label: 'Tech / SaaS' },
  { id: 'health',     label: 'Healthcare' },
  { id: 'finance',    label: 'Finance' },
  { id: 'creative',   label: 'Creative Agency' },
  { id: 'legal',      label: 'Legal' },
  { id: 'ecommerce',  label: 'E-Commerce' },
  { id: 'realestate', label: 'Real Estate' },
  { id: 'education',  label: 'Education' },
];

const SIZES = ['1–10', '10–50', '50–200', '200+'];

const ONBOARD_TOOLS = [
  { id: 'google', label: 'Google Workspace', desc: 'Gmail, Calendar & Drive — seeds the Company Brain.', recommended: true },
  { id: 'slack',  label: 'Slack',            desc: 'Channels and messages your Daemon can read.' },
  { id: 'notion', label: 'Notion',           desc: 'Docs and tasks for richer context.' },
];

const GITHUB_FEATURES = [
  { title: 'Track pull requests',    desc: 'See open PRs, review status, and merge activity in real-time.' },
  { title: 'Monitor deployments',    desc: 'Pipeline health, deploy logs, and failure alerts surface automatically.' },
  { title: 'Code context in chat',   desc: 'Ask your Daemon about any commit, diff, or contributor.' },
];

const SLACK_FEATURES = [
  { title: 'Smart notifications',    desc: 'Task updates and alerts land in the right channel, without the noise.' },
  { title: 'Daily standups',         desc: 'Automated morning summaries delivered to your team.' },
  { title: 'Daemon in Slack',        desc: 'Query WorkDaemon without ever leaving the conversation.' },
];

// ── Shared input ──────────────────────────────────────────────────────────────

function FocusInput({ style, autoFocus, ...props }) {
  const ref = useRef(null);
  const [focused, setFocused] = useState(false);

  useEffect(() => {
    if (autoFocus && ref.current) {
      const t = setTimeout(() => ref.current?.focus(), 80);
      return () => clearTimeout(t);
    }
  }, [autoFocus]);

  return (
    <input
      ref={ref}
      style={{
        width: '100%',
        padding: '11px 16px',
        background: focused ? 'rgba(255,255,255,0.07)' : 'rgba(255,255,255,0.05)',
        border: `1px solid ${focused ? 'rgba(59,110,247,0.55)' : 'rgba(255,255,255,0.1)'}`,
        borderRadius: 8,
        color: '#e8e8e8',
        fontSize: 15,
        fontFamily: 'var(--dmsans)',
        outline: 'none',
        transition: 'border-color 0.15s, background 0.15s, box-shadow 0.15s',
        boxShadow: focused ? '0 0 0 2px rgba(59,110,247,0.18)' : 'none',
        boxSizing: 'border-box',
        ...style,
      }}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      {...props}
    />
  );
}

const labelSt = {
  fontFamily: 'var(--dmsans)',
  fontSize: 11,
  fontWeight: 500,
  color: 'rgba(232,232,232,0.35)',
  display: 'block',
  marginBottom: 8,
  letterSpacing: '0.01em',
};

// ── Steps ─────────────────────────────────────────────────────────────────────

function StepProfile({ data, setData }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 22 }}>
      <div>
        <label style={labelSt}>Name &amp; picture</label>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <div style={{
            width: 46, height: 46, borderRadius: '50%',
            background: 'rgba(255,255,255,0.06)',
            border: '1px solid rgba(255,255,255,0.11)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            flexShrink: 0, cursor: 'pointer', overflow: 'hidden',
          }}>
            {data.avatar ? (
              <img src={data.avatar} alt="" referrerPolicy="no-referrer"
                style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
            ) : (
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.38)" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                <path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2"/><circle cx="12" cy="7" r="4"/>
              </svg>
            )}
          </div>
          <FocusInput
            placeholder="Your full name"
            value={data.name || ''}
            onChange={e => setData(d => ({ ...d, name: e.target.value }))}
            autoFocus
          />
        </div>
      </div>
      <div>
        <label style={labelSt}>Title</label>
        <FocusInput
          placeholder="e.g. CEO, Product Manager, Lead Engineer"
          value={data.title || ''}
          onChange={e => setData(d => ({ ...d, title: e.target.value }))}
        />
      </div>
    </div>
  );
}

function toSlug(name) {
  return (name || '').toLowerCase().trim()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

function StepWorkspace({ data, setData }) {
  const timerRef = useRef(null);
  const slug = toSlug(data.company);
  const slugStatus = data.slugStatus ?? null; // null | 'checking' | 'available' | 'taken'

  useEffect(() => {
    if (slug.length < 2) {
      setData(d => ({ ...d, slug: '', slugStatus: null }));
      return;
    }
    setData(d => ({ ...d, slug, slugStatus: 'checking' }));
    clearTimeout(timerRef.current);
    timerRef.current = setTimeout(async () => {
      try {
        const res = await fetch(`/api/workspace/check-slug?slug=${encodeURIComponent(slug)}`);
        const { available } = await res.json();
        setData(d => ({ ...d, slugStatus: available ? 'available' : 'taken' }));
      } catch {
        setData(d => ({ ...d, slugStatus: null }));
      }
    }, 480);
    return () => clearTimeout(timerRef.current);
  }, [slug]); // eslint-disable-line

  const statusColor = slugStatus === 'available' ? '#10b981' : slugStatus === 'taken' ? '#ef4444' : 'rgba(255,255,255,0.28)';
  const statusLabel = slugStatus === 'available' ? '✓ Available' : slugStatus === 'taken' ? '✗ Already taken' : 'checking…';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 22 }}>
      <div>
        <label style={labelSt}>Company name</label>
        <FocusInput
          placeholder="Your company name"
          value={data.company || ''}
          onChange={e => setData(d => ({ ...d, company: e.target.value }))}
          autoFocus
        />

        {slug.length >= 2 && (
          <div style={{
            marginTop: 10,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '9px 13px',
            background: 'rgba(255,255,255,0.04)',
            border: '1px solid rgba(255,255,255,0.08)',
            borderRadius: 8,
          }}>
            <span style={{ fontFamily: 'var(--mono)', fontSize: 12, color: 'rgba(255,255,255,0.6)', letterSpacing: '0.01em' }}>
              <span style={{ color: 'rgba(255,255,255,0.28)' }}>https://</span>
              <span style={{ color: '#e8e8e8' }}>{slug}</span>
              <span style={{ color: 'rgba(255,255,255,0.28)' }}>.workdaemon.com</span>
            </span>
            <span style={{
              fontFamily: 'var(--dmsans)', fontSize: 11, fontWeight: 500,
              color: statusColor, transition: 'color 0.2s', whiteSpace: 'nowrap', marginLeft: 10,
            }}>
              {statusLabel}
            </span>
          </div>
        )}
      </div>
      <div>
        <label style={labelSt}>Team size</label>
        <div style={{ display: 'flex', gap: 8 }}>
          {SIZES.map(s => (
            <button key={s} type="button" onClick={() => setData(d => ({ ...d, size: s }))}
              style={{
                flex: 1, padding: '10px 0',
                background: data.size === s ? 'rgba(255,255,255,0.09)' : 'rgba(255,255,255,0.04)',
                border: `1px solid ${data.size === s ? 'rgba(255,255,255,0.22)' : 'rgba(255,255,255,0.09)'}`,
                borderRadius: 9, cursor: 'pointer',
                fontFamily: 'var(--dmsans)', fontSize: 14,
                fontWeight: data.size === s ? 500 : 400,
                color: data.size === s ? '#fff' : 'rgba(255,255,255,0.42)',
                transition: 'all 0.15s',
              }}
            >{s}</button>
          ))}
        </div>
      </div>
      <div>
        <label style={labelSt}>Primary market / location</label>
        <LocationField data={data} setData={setData} />
        <div style={{ fontFamily: 'var(--dmsans)', fontSize: 12, color: 'rgba(255,255,255,0.34)', marginTop: 6 }}>
          We use this to watch for news, regulation and trends that affect your business. Auto-filled — edit if it's off.
        </div>
      </div>
    </div>
  );
}

// ── Location typeahead ─────────────────────────────────────────────────────────
// Debounced city/state/country autocomplete via Photon (komoot) — free, keyless,
// CORS-enabled, no backend function. Captures STRUCTURED fields (city / region /
// country / ISO code) on select so the data is usable later for geo-targeting,
// while staying fully free-text if the service is slow or unreachable.
function photonLabel(p) {
  const parts = [p.name, p.state, p.country].map(s => (s || '').trim()).filter(Boolean);
  return parts.filter((x, i) => parts.indexOf(x) === i).join(', ');
}
function photonMeta(p) {
  const isPlace = /(city|town|village|hamlet|municipality|locality|suburb)/i.test(p.osm_value || p.type || '');
  return {
    city: (p.city || (isPlace ? p.name : '') || '').trim(),
    region: (p.state || '').trim(),
    country: (p.country || '').trim(),
    countrycode: (p.countrycode || '').toUpperCase(),
  };
}

function LocationField({ data, setData }) {
  const [query, setQuery] = useState(data.location || '');
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState([]);
  const [highlighted, setHighlighted] = useState(0);
  const [loading, setLoading] = useState(false);
  const inputRef = useRef(null);
  const dropRef = useRef(null);
  const timerRef = useRef(null);
  const abortRef = useRef(null);

  // Reflect a late external auto-fill (edge-detected location lands after mount).
  useEffect(() => {
    if (data.location && !query) setQuery(data.location);
  }, [data.location]); // eslint-disable-line

  const runSearch = useCallback((q) => {
    clearTimeout(timerRef.current);
    if (q.trim().length < 2) { setItems([]); setLoading(false); return; }
    setLoading(true);
    timerRef.current = setTimeout(async () => {
      abortRef.current?.abort();
      const ctrl = new AbortController();
      abortRef.current = ctrl;
      const timeout = setTimeout(() => ctrl.abort(), 4000);
      try {
        const r = await fetch(`https://photon.komoot.io/api/?q=${encodeURIComponent(q)}&limit=6&lang=en`, { signal: ctrl.signal });
        const d = await r.json();
        const seen = new Set();
        const next = (d.features || [])
          .map(f => f.properties).filter(p => p && p.country)
          .map(p => ({ label: photonLabel(p), meta: photonMeta(p) }))
          .filter(it => it.label && !seen.has(it.label) && seen.add(it.label));
        setItems(next);
      } catch { /* offline / slow / aborted → stay free-text */ }
      finally { clearTimeout(timeout); setLoading(false); }
    }, 250);
  }, []);

  const handleChange = (e) => {
    const val = e.target.value;
    setQuery(val);
    setOpen(true);
    setHighlighted(0);
    // Manual edit invalidates any previously selected structured value.
    setData(d => ({ ...d, location: val, locationMeta: null }));
    runSearch(val);
  };

  const commit = useCallback((it) => {
    setQuery(it.label);
    setData(d => ({ ...d, location: it.label, locationMeta: it.meta }));
    setItems([]);
    setOpen(false);
  }, [setData]);

  const handleKeyDown = (e) => {
    if (!open || items.length === 0) return;
    if (e.key === 'ArrowDown') { e.preventDefault(); setHighlighted(h => Math.min(h + 1, items.length - 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setHighlighted(h => Math.max(h - 1, 0)); }
    else if (e.key === 'Enter') { e.preventDefault(); if (items[highlighted]) commit(items[highlighted]); }
    else if (e.key === 'Escape') setOpen(false);
  };

  useEffect(() => {
    const handler = (e) => {
      if (!inputRef.current?.contains(e.target) && !dropRef.current?.contains(e.target)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const showDrop = open && items.length > 0;
  return (
    <div style={{ position: 'relative' }}>
      <input
        ref={inputRef}
        value={query}
        onChange={handleChange}
        onFocus={() => { setOpen(true); if (query.trim().length >= 2 && items.length === 0) runSearch(query); }}
        onKeyDown={handleKeyDown}
        placeholder="Start typing a city, state or country…"
        autoComplete="off"
        style={{
          width: '100%', padding: '11px 16px',
          background: open ? 'rgba(255,255,255,0.07)' : 'rgba(255,255,255,0.05)',
          border: `1px solid ${open ? 'rgba(59,110,247,0.55)' : 'rgba(255,255,255,0.1)'}`,
          borderRadius: showDrop ? '8px 8px 0 0' : 8,
          color: '#e8e8e8', fontSize: 15, fontFamily: 'var(--dmsans)', outline: 'none',
          transition: 'border-color 0.15s, background 0.15s, box-shadow 0.15s',
          boxShadow: open ? '0 0 0 2px rgba(59,110,247,0.18)' : 'none', boxSizing: 'border-box',
        }}
      />
      {loading && !showDrop && (
        <span style={{ position: 'absolute', right: 14, top: 13, fontFamily: 'var(--dmsans)', fontSize: 12, color: 'rgba(255,255,255,0.3)' }}>searching…</span>
      )}
      {showDrop && (
        <div ref={dropRef} style={{
          position: 'absolute', top: '100%', left: 0, right: 0,
          background: '#1e1e1e', border: '1px solid rgba(59,110,247,0.35)', borderTop: 'none',
          borderRadius: '0 0 8px 8px', overflow: 'hidden', zIndex: 50,
          boxShadow: '0 8px 24px rgba(0,0,0,0.55)', maxHeight: 252, overflowY: 'auto',
        }}>
          {items.map((it, i) => (
            <button key={it.label} type="button"
              onMouseEnter={() => setHighlighted(i)}
              onMouseDown={e => { e.preventDefault(); commit(it); }}
              style={{
                width: '100%', textAlign: 'left', padding: '10px 16px',
                background: i === highlighted ? 'rgba(59,110,247,0.1)' : 'transparent',
                border: 'none', cursor: 'pointer',
                borderBottom: i < items.length - 1 ? '1px solid rgba(255,255,255,0.045)' : 'none',
                transition: 'background 0.1s', display: 'flex', alignItems: 'center', gap: 8,
              }}
            >
              <span style={{ fontFamily: 'var(--dmsans)', fontSize: 13, fontWeight: 500, color: i === highlighted ? '#a8c0ff' : 'rgba(232,232,232,0.78)' }}>{it.label}</span>
              {it.meta.countrycode && (
                <span style={{ fontFamily: 'var(--mono)', fontSize: 10, color: 'rgba(232,232,232,0.32)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 4, padding: '1px 5px', marginLeft: 'auto' }}>{it.meta.countrycode}</span>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function GridSelect({ options, value, onSelect, cols = 2, getLabel, getKey, getSub }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: `repeat(${cols}, 1fr)`, gap: 8 }}>
      {options.map(opt => {
        const key = getKey(opt);
        const sel = value === key;
        return (
          <button key={key} type="button" onClick={() => onSelect(key)}
            style={{
              padding: '12px 14px', textAlign: 'left', cursor: 'pointer',
              background: sel ? 'rgba(255,255,255,0.09)' : 'rgba(255,255,255,0.03)',
              border: `1px solid ${sel ? 'rgba(255,255,255,0.18)' : 'rgba(255,255,255,0.07)'}`,
              borderRadius: 8, transition: 'all 0.12s', outline: 'none',
            }}
            onMouseEnter={e => { if (!sel) { e.currentTarget.style.background = 'rgba(255,255,255,0.06)'; e.currentTarget.style.borderColor = 'rgba(255,255,255,0.12)'; } }}
            onMouseLeave={e => { if (!sel) { e.currentTarget.style.background = 'rgba(255,255,255,0.03)'; e.currentTarget.style.borderColor = 'rgba(255,255,255,0.07)'; } }}
          >
            <div style={{ fontFamily: 'var(--dmsans)', fontSize: 13, fontWeight: 500, color: sel ? '#e8e8e8' : 'rgba(232,232,232,0.52)', marginBottom: getSub ? 3 : 0 }}>{getLabel(opt)}</div>
            {getSub && <div style={{ fontFamily: 'var(--dmsans)', fontSize: 12, color: 'rgba(232,232,232,0.26)' }}>{getSub(opt)}</div>}
          </button>
        );
      })}
    </div>
  );
}

function StepRole({ data, setData }) {
  const firstName = (data.name || '').split(' ')[0];
  const [query, setQuery] = useState(() => {
    const preset = ROLES.find(r => r.id === data.role);
    return preset ? preset.label : (data.role || '');
  });
  const [open, setOpen] = useState(false);
  const [highlighted, setHighlighted] = useState(0);
  const inputRef = useRef(null);
  const dropRef = useRef(null);

  const matches = query.trim()
    ? ROLES.filter(r => r.label.toLowerCase().includes(query.toLowerCase()))
    : ROLES;

  const isPresetMatch = ROLES.some(r => r.label.toLowerCase() === query.trim().toLowerCase());
  const isCustom = query.trim().length > 1 && !isPresetMatch;

  const commitValue = useCallback((label, id) => {
    setQuery(label);
    setData(d => ({ ...d, role: id || label }));
    setOpen(false);
  }, [setData]);

  const handleChange = (e) => {
    const val = e.target.value;
    setQuery(val);
    setOpen(true);
    setHighlighted(0);
    const exact = ROLES.find(r => r.label.toLowerCase() === val.trim().toLowerCase());
    setData(d => ({ ...d, role: exact ? exact.id : (val.trim() || '') }));
  };

  const handleKeyDown = (e) => {
    if (!open) { if (e.key === 'ArrowDown') setOpen(true); return; }
    if (e.key === 'ArrowDown') { e.preventDefault(); setHighlighted(h => Math.min(h + 1, matches.length - 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setHighlighted(h => Math.max(h - 1, 0)); }
    else if (e.key === 'Enter') { e.preventDefault(); if (matches[highlighted]) commitValue(matches[highlighted].label, matches[highlighted].id); else if (query.trim()) setOpen(false); }
    else if (e.key === 'Escape') setOpen(false);
  };

  useEffect(() => {
    const handler = (e) => {
      if (!inputRef.current?.contains(e.target) && !dropRef.current?.contains(e.target)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  useEffect(() => {
    const t = setTimeout(() => inputRef.current?.focus(), 80);
    return () => clearTimeout(t);
  }, []);

  return (
    <div>
      {firstName && (
        <div style={{ marginBottom: 22, fontFamily: 'var(--dmsans)', fontSize: 14, color: 'rgba(232,232,232,0.46)', lineHeight: 1.5 }}>
          Hi,{' '}
          <span style={{ color: '#e8e8e8', fontWeight: 600 }}>{firstName}</span>
          {' '}— what's your title at {data.company || 'the company'}?
        </div>
      )}
      <label style={labelSt}>Your role</label>
      <div style={{ position: 'relative' }}>
        <input
          ref={inputRef}
          value={query}
          onChange={handleChange}
          onFocus={() => { setOpen(true); setHighlighted(0); }}
          onKeyDown={handleKeyDown}
          placeholder="e.g. CEO, Head of Design, Data Analyst…"
          autoComplete="off"
          style={{
            width: '100%',
            padding: '11px 16px',
            background: open ? 'rgba(255,255,255,0.07)' : 'rgba(255,255,255,0.05)',
            border: `1px solid ${open ? 'rgba(59,110,247,0.55)' : 'rgba(255,255,255,0.1)'}`,
            borderRadius: open && matches.length > 0 ? '8px 8px 0 0' : 8,
            color: '#e8e8e8',
            fontSize: 15,
            fontFamily: 'var(--dmsans)',
            outline: 'none',
            transition: 'border-color 0.15s, background 0.15s, box-shadow 0.15s',
            boxShadow: open ? '0 0 0 2px rgba(59,110,247,0.18)' : 'none',
            boxSizing: 'border-box',
          }}
        />
        {open && matches.length > 0 && (
          <div ref={dropRef} style={{
            position: 'absolute', top: '100%', left: 0, right: 0,
            background: '#1e1e1e',
            border: '1px solid rgba(59,110,247,0.35)',
            borderTop: 'none',
            borderRadius: '0 0 8px 8px',
            overflow: 'hidden', zIndex: 50,
            boxShadow: '0 8px 24px rgba(0,0,0,0.55)',
            maxHeight: 252, overflowY: 'auto',
          }}>
            {matches.map((r, i) => (
              <button key={r.id} type="button"
                onMouseEnter={() => setHighlighted(i)}
                onMouseDown={e => { e.preventDefault(); commitValue(r.label, r.id); }}
                style={{
                  width: '100%', textAlign: 'left', padding: '10px 16px',
                  background: i === highlighted ? 'rgba(59,110,247,0.1)' : 'transparent',
                  border: 'none', cursor: 'pointer',
                  borderBottom: i < matches.length - 1 ? '1px solid rgba(255,255,255,0.045)' : 'none',
                  transition: 'background 0.1s',
                }}
              >
                <div style={{ fontFamily: 'var(--dmsans)', fontSize: 13, fontWeight: 500, color: i === highlighted ? '#a8c0ff' : 'rgba(232,232,232,0.78)' }}>{r.label}</div>
                <div style={{ fontFamily: 'var(--dmsans)', fontSize: 11, color: 'rgba(232,232,232,0.3)', marginTop: 2 }}>{r.sub}</div>
              </button>
            ))}
          </div>
        )}
      </div>
      {isCustom && (
        <div style={{
          marginTop: 8, padding: '8px 12px',
          background: 'rgba(59,110,247,0.05)',
          border: '1px solid rgba(59,110,247,0.16)',
          borderRadius: 6,
          display: 'flex', alignItems: 'flex-start', gap: 8,
        }}>
          <span style={{ color: '#3b6ef7', fontSize: 13, marginTop: 1 }}>✦</span>
          <span style={{ fontFamily: 'var(--dmsans)', fontSize: 12, color: 'rgba(232,232,232,0.46)', lineHeight: 1.5 }}>
            Custom role — your Daemon will research{' '}
            <span style={{ color: 'rgba(168,192,255,0.8)', fontWeight: 500 }}>{query}</span>
            {' '}and adapt in the background.
          </span>
        </div>
      )}
    </div>
  );
}

function StepIndustry({ data, setData }) {
  return (
    <GridSelect
      options={INDUSTRIES}
      value={data.industry}
      onSelect={v => setData(d => ({ ...d, industry: v }))}
      getKey={i => i.id}
      getLabel={i => i.label}
    />
  );
}

function StepInvite({ data, setData, inviteLink }) {
  const [focused, setFocused] = useState(false);
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    if (inviteLink) navigator.clipboard?.writeText(inviteLink);
    setCopied(true);
    setTimeout(() => setCopied(false), 2200);
  };

  return (
    <div>
      <label style={labelSt}>Email addresses</label>
      <textarea
        value={data.invites || ''}
        onChange={e => setData(d => ({ ...d, invites: e.target.value }))}
        placeholder={'name@company.com\nteammate@company.com\n...'}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        style={{
          width: '100%',
          height: 136,
          padding: '12px 16px',
          background: focused ? 'rgba(255,255,255,0.07)' : 'rgba(255,255,255,0.05)',
          border: `1px solid ${focused ? 'rgba(59,110,247,0.55)' : 'rgba(255,255,255,0.1)'}`,
          borderRadius: 8,
          color: '#e8e8e8',
          fontSize: 14,
          fontFamily: 'var(--dmsans)',
          outline: 'none',
          resize: 'none',
          lineHeight: 1.65,
          transition: 'all 0.15s',
          boxShadow: focused ? '0 0 0 2px rgba(59,110,247,0.18)' : 'none',
          boxSizing: 'border-box',
        }}
      />
      <button
        type="button"
        onClick={handleCopy}
        style={{
          marginTop: 12,
          background: 'none', border: 'none',
          fontFamily: 'var(--dmsans)', fontSize: 13,
          color: copied ? 'rgba(255,255,255,0.52)' : 'rgba(255,255,255,0.3)',
          cursor: 'pointer', padding: 0,
          transition: 'color 0.15s',
          display: 'flex', alignItems: 'center', gap: 6,
        }}
        onMouseEnter={e => { if (!copied) e.currentTarget.style.color = 'rgba(255,255,255,0.52)'; }}
        onMouseLeave={e => { if (!copied) e.currentTarget.style.color = 'rgba(255,255,255,0.3)'; }}
      >
        {copied
          ? <><span style={{ fontSize: 11 }}>✓</span> Link copied</>
          : <>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <path d="M10 13a5 5 0 007.54.54l3-3a5 5 0 00-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 00-7.54-.54l-3 3a5 5 0 007.07 7.07l1.71-1.71"/>
              </svg>
              Copy invite link
            </>
        }
      </button>
    </div>
  );
}

function StepConnect({ features }) {
  return (
    <div style={{ border: '1px solid rgba(255,255,255,0.07)', borderRadius: 12, overflow: 'hidden' }}>
      {features.map((f, i) => (
        <div key={i}>
          {i > 0 && <div style={{ height: 1, background: 'rgba(255,255,255,0.06)' }} />}
          <div style={{ padding: '16px 18px' }}>
            <div style={{ fontFamily: 'var(--dmsans)', fontSize: 14, fontWeight: 500, color: 'rgba(255,255,255,0.82)', marginBottom: 5 }}>{f.title}</div>
            <div style={{ fontFamily: 'var(--dmsans)', fontSize: 13, color: 'rgba(255,255,255,0.35)', lineHeight: 1.55 }}>{f.desc}</div>
          </div>
        </div>
      ))}
    </div>
  );
}

// ── Composite steps (spec §1) ─────────────────────────────────────────────────
const onbHint = { fontFamily: 'var(--dmsans)', fontSize: 12, color: 'rgba(255,255,255,0.34)', marginTop: 6 };

// Step 1 — Company details: name, size, location, work domain, industry.
function StepCompany({ data, setData }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 22 }}>
      <StepWorkspace data={data} setData={setData} />
      <div>
        <label style={labelSt}>Work email domain</label>
        <FocusInput
          placeholder="acme.com"
          value={data.emailDomain || ''}
          onChange={e => setData(d => ({ ...d, emailDomain: e.target.value.trim().replace(/^@/, '') }))}
        />
        <div style={onbHint}>Teammates who sign up with this domain are auto-approved.</div>
      </div>
      <div>
        <label style={labelSt}>Industry</label>
        <div style={{ marginTop: 8 }}><StepIndustry data={data} setData={setData} /></div>
      </div>
    </div>
  );
}

// Step 2 — Your Daemon setup: identity (name, title, avatar) + role it adapts to.
function StepDaemon({ data, setData }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 26 }}>
      <StepProfile data={data} setData={setData} />
      <StepRole data={data} setData={setData} />
    </div>
  );
}

// Step 3 — Connect first integration. Google Workspace recommended; Slack / Notion
// as alternatives; skippable. Starts the real workspace OAuth (settings oauth_start).
function StepIntegration({ token }) {
  const [busy, setBusy] = useState('');
  const [err, setErr] = useState('');
  const connect = async (provider) => {
    setBusy(provider); setErr('');
    try {
      const r = await fetch('/api/workspace/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify({ action: 'oauth_start', provider }),
      });
      const d = await r.json().catch(() => ({}));
      if (d.url) { window.location.href = d.url; return; }
      setErr(d.error || "That tool isn't available yet — you can connect it later from Integrations.");
    } catch { setErr('Could not start the connection. You can connect later from Integrations.'); }
    finally { setBusy(''); }
  };
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {ONBOARD_TOOLS.map(t => (
        <button key={t.id} type="button" disabled={!!busy} onClick={() => connect(t.id)}
          style={{
            display: 'flex', alignItems: 'center', gap: 12, textAlign: 'left',
            padding: '14px 16px', borderRadius: 10, cursor: busy ? 'wait' : 'pointer',
            background: 'rgba(255,255,255,0.04)',
            border: `1px solid ${t.recommended ? 'rgba(59,110,247,0.4)' : 'rgba(255,255,255,0.09)'}`,
            transition: 'all 0.15s',
          }}
          onMouseEnter={e => { if (!busy) { e.currentTarget.style.background = 'rgba(255,255,255,0.07)'; } }}
          onMouseLeave={e => { if (!busy) { e.currentTarget.style.background = 'rgba(255,255,255,0.04)'; } }}
        >
          <div style={{ flex: 1 }}>
            <div style={{ fontFamily: 'var(--dmsans)', fontSize: 14, fontWeight: 500, color: 'rgba(255,255,255,0.85)', display: 'flex', alignItems: 'center', gap: 8 }}>
              {t.label}
              {t.recommended && <span style={{ fontFamily: 'var(--dmsans)', fontSize: 10, fontWeight: 600, color: '#3b6ef7', background: 'rgba(59,110,247,0.12)', borderRadius: 100, padding: '2px 8px' }}>Recommended</span>}
            </div>
            <div style={{ fontFamily: 'var(--dmsans)', fontSize: 12.5, color: 'rgba(255,255,255,0.4)', marginTop: 3, lineHeight: 1.5 }}>{t.desc}</div>
          </div>
          <span style={{ fontFamily: 'var(--dmsans)', fontSize: 13, fontWeight: 500, color: busy === t.id ? 'rgba(255,255,255,0.4)' : '#3b6ef7', whiteSpace: 'nowrap' }}>
            {busy === t.id ? 'Opening…' : 'Connect'}
          </span>
        </button>
      ))}
      {err && <div style={{ ...onbHint, color: '#f0a04b', marginTop: 8 }}>{err}</div>}
    </div>
  );
}

// ── Right panel visuals ───────────────────────────────────────────────────────

function PanelDefault() {
  return (
    <>
      <div style={{
        position: 'absolute',
        top: '50%', left: '50%',
        transform: 'translate(-50%, -52%) scale(3.5)',
        opacity: 0.06,
        pointerEvents: 'none',
      }}>
        <DaemonMark size={130} color="#3b6ef7" />
      </div>
      <div style={{
        position: 'absolute',
        top: '57%', left: '50%',
        transform: 'translateX(-50%)',
        opacity: 0.06,
        whiteSpace: 'nowrap',
        pointerEvents: 'none',
      }}>
        <span style={{ fontFamily: 'var(--orbitron)', fontSize: 40, fontWeight: 700, color: '#fff', letterSpacing: '0.2em' }}>WORKDAEMON</span>
      </div>
    </>
  );
}

function PanelGitHub() {
  return (
    <div style={{
      position: 'absolute', inset: 0,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      pointerEvents: 'none',
    }}>
      <div style={{ opacity: 0.07, color: '#fff', userSelect: 'none', width: 280 }}>
        <div style={{ fontFamily: 'var(--mono)', fontSize: 10, color: 'rgba(255,255,255,0.55)', marginBottom: 14, letterSpacing: '0.04em' }}>
          ◉ &nbsp;PR #1142 · feature/ai-routing → main
        </div>
        <div style={{ fontFamily: 'var(--mono)', fontSize: 10, color: 'rgba(255,255,255,0.35)', marginBottom: 6 }}>
          daemon.config.ts +21 −4
        </div>
        <div style={{ fontFamily: 'var(--mono)', fontSize: 12, lineHeight: 1.9, background: 'rgba(255,255,255,0.03)', borderRadius: 8, padding: '12px 14px', border: '1px solid rgba(255,255,255,0.06)' }}>
          <div style={{ color: '#86efac' }}>+ const daemon = new WorkDaemon({'{'}</div>
          <div style={{ color: '#86efac' }}>+   model: 'claude-3-opus',</div>
          <div style={{ color: '#86efac' }}>+   context: companyBrain,</div>
          <div style={{ color: '#86efac' }}>+   memory: 'persistent',</div>
          <div style={{ color: '#86efac' }}>+ {'}'});</div>
          <div style={{ color: 'rgba(255,255,255,0.18)' }}>&nbsp;</div>
          <div style={{ color: '#fca5a5' }}>- const ai = new OpenAI({'{'} key {'}'});</div>
        </div>
        <div style={{ marginTop: 14, paddingTop: 14, borderTop: '1px solid rgba(255,255,255,0.06)', fontFamily: 'var(--mono)', fontSize: 10, color: 'rgba(255,255,255,0.35)' }}>
          3 reviewers · 12 commits · ✓ Deploy passed
        </div>
      </div>
      <div style={{
        position: 'absolute', inset: 0,
        background: 'none',
        pointerEvents: 'none',
      }} />
    </div>
  );
}

function PanelSlack() {
  return (
    <div style={{
      position: 'absolute', inset: 0,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      pointerEvents: 'none',
    }}>
      <div style={{ opacity: 0.075, color: '#fff', userSelect: 'none', width: 260 }}>
        <div style={{ fontFamily: 'var(--mono)', fontSize: 9, color: 'rgba(255,255,255,0.55)', marginBottom: 16, letterSpacing: '0.08em' }}>
          # team-updates
        </div>
        <div style={{ marginBottom: 18 }}>
          <div style={{ fontFamily: 'var(--dmsans)', fontSize: 12, fontWeight: 600, marginBottom: 5 }}>
            WorkDaemon{' '}
            <span style={{ fontSize: 10, opacity: 0.42, fontWeight: 400 }}>Today 9:00 AM</span>
          </div>
          <div style={{ fontFamily: 'var(--dmsans)', fontSize: 12, lineHeight: 1.65 }}>
            <div style={{ opacity: 0.75, marginBottom: 2 }}>Daily briefing ready:</div>
            <div style={{ opacity: 0.5 }}>· 14 tasks completed</div>
            <div style={{ opacity: 0.5 }}>· 3 PRs need review</div>
            <div style={{ opacity: 0.5 }}>· Q2 revenue on track</div>
          </div>
        </div>
        <div>
          <div style={{ fontFamily: 'var(--dmsans)', fontSize: 12, fontWeight: 600, marginBottom: 5 }}>
            Sarah Chen{' '}
            <span style={{ fontSize: 10, opacity: 0.42, fontWeight: 400 }}>9:02 AM</span>
          </div>
          <div style={{ fontFamily: 'var(--dmsans)', fontSize: 12, opacity: 0.72, lineHeight: 1.55 }}>
            @daemon what's blocking #BUG-119?
          </div>
        </div>
      </div>
      <div style={{
        position: 'absolute', inset: 0,
        background: 'none',
        pointerEvents: 'none',
      }} />
    </div>
  );
}

// ── Main ──────────────────────────────────────────────────────────────────────

export default function Onboarding() {
  const navigate = useNavigate();
  const { token, refreshProfile } = useAuth();
  const [step, setStep]       = useState(0);
  const [data, setData]       = useState({});
  const [visible, setVisible] = useState(false);
  const [saving, setSaving]   = useState(false);
  const [saveErr, setSaveErr] = useState('');
  const [inviteLink, setInviteLink] = useState('');
  const { isMobile, isTablet } = useViewport();
  const hideRight = isMobile || isTablet;

  useEffect(() => {
    const t = setTimeout(() => setVisible(true), 40);
    return () => clearTimeout(t);
  }, []);

  // Pre-fill name/title from the signed-in profile (Google gives us full_name +
  // avatar on first sign-in) and the primary-market field from edge-detected
  // location — never clobbering anything the user has already typed.
  useEffect(() => {
    fetch('/api/auth/me', { headers: token ? { Authorization: `Bearer ${token}` } : {} })
      .then(r => r.ok ? r.json() : null)
      .then(d => {
        if (!d) return;
        const meta = d.user?.user_metadata || {};
        const fullName = d.profile?.name || meta.full_name || meta.name || '';
        const avatar = d.profile?.avatar_url || meta.avatar_url || meta.picture || '';
        // Pre-fill the work email domain from the founder's email (unless it's a
        // free provider — auto-approving gmail.com etc. would let anyone in).
        const FREE = ['gmail.com','outlook.com','hotmail.com','yahoo.com','icloud.com','proton.me','protonmail.com','live.com','aol.com'];
        const emailDom = (d.user?.email || '').split('@')[1] || '';
        setData(prev => ({
          ...prev,
          name:        prev.name        || fullName,
          title:       prev.title       || d.profile?.title || '',
          avatar:      prev.avatar      || avatar,
          location:    prev.location    || d.detectedLocation || '',
          emailDomain: prev.emailDomain || (emailDom && !FREE.includes(emailDom.toLowerCase()) ? emailDom : ''),
        }));
      })
      .catch(() => {});
  }, [token]);

  const canAdvance = () => {
    // 0 = Company details (name + available slug + industry), 1 = Daemon setup (role).
    if (step === 0) return !!data.company?.trim() && data.slugStatus === 'available' && !!data.industry;
    if (step === 1) return !!(data.role?.trim());
    return true; // 2 = integration, 3 = invite — both optional
  };

  // Submit profile + workspace data after the core setup steps
  const submitSetup = useCallback(async () => {
    setSaving(true);
    setSaveErr('');
    try {
      const res = await fetch('/api/user/setup', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          name:     data.name,
          title:    data.title,
          company:  data.company,
          size:     data.size,
          role:     data.role,
          industry: data.industry,
          location: data.location,
          location_meta: data.locationMeta || null,  // structured {city,region,country,countrycode}
          email_domain: data.emailDomain || null,    // auto-approve teammates on this domain
          slug:     data.slug,
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setSaveErr(body.error || 'Could not save your setup. Please try again.');
        return false;
      }
      const body = await res.json().catch(() => ({}));
      if (body.inviteLink) setInviteLink(body.inviteLink);

      // Fire-and-forget background research via /api/brain actions (kept as
      // actions, not separate routes, to stay under the serverless fn limit).
      // Neither call blocks onboarding.
      const authHeaders = {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      };
      // (a) Per-user: research the role → role brief in the daemon's memory.
      if (data.role) {
        fetch('/api/brain', {
          method: 'POST', headers: authHeaders,
          body: JSON.stringify({ action: 'research_role', role: data.role }),
        }).catch(() => null);
      }
      // (b) Workspace: research the company, competitors & market → company
      //     context + proactive competitor findings (onboarding user is admin).
      if (data.company) {
        fetch('/api/brain', {
          method: 'POST', headers: authHeaders,
          body: JSON.stringify({ action: 'research_company', company: data.company, industry: data.industry }),
        }).catch(() => null);
      }

      return true;
    } catch {
      setSaveErr('Unable to reach the server. Check your connection and try again.');
      return false;
    } finally {
      setSaving(false);
    }
  }, [data]);

  const advance = async () => {
    // Submit after the required steps (Company details + Daemon setup), before
    // the optional Connect-integration and Invite steps.
    if (step === 1) {
      const ok = await submitSetup();
      if (!ok) return;
      await refreshProfile();
    }
    if (step < STEPS.length - 1) setStep(s => s + 1);
    else navigate('/app');
  };

  // Send invites
  const sendInvites = async () => {
    const emails = (data.invites || '').split('\n').map(e => e.trim()).filter(Boolean);
    if (emails.length > 0) {
      await fetch('/api/workspace/invite', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ emails }),
      }).catch(() => null);
    }
    navigate('/app'); // Invite is the final step → land on My Daemon.
  };

  // Integration (2) and Invite (3) are optional.
  const isOptional = step >= 2;

  const getButtonLabel = () => {
    if (saving) return '...';
    if (step === 1) return 'Create workspace';
    if (step === 3) return 'Send invitations';
    return 'Continue';
  };

  const handleAdvance = step === 3 ? sendInvites : advance;

  const getRightPanel = () => <PanelDefault />;

  const forms = [
    <StepCompany     key={0} data={data} setData={setData} />,
    <StepDaemon      key={1} data={data} setData={setData} />,
    <StepIntegration key={2} token={token} />,
    <StepInvite      key={3} data={data} setData={setData} inviteLink={inviteLink} />,
  ];

  return (
    <div style={{ height: '100vh', display: 'flex', background: '#191919', overflow: 'hidden', position: 'relative' }}>

      {/* ── Left: Form panel ── */}
      <div style={{
        width: hideRight ? '100%' : '50%',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'flex-start',
        overflowY: 'auto',
        padding: isMobile ? '80px 28px 60px' : '60px 80px',
        borderRight: hideRight ? 'none' : '1px solid rgba(255,255,255,0.06)',
        position: 'relative',
        opacity: visible ? 1 : 0,
        transform: visible ? 'none' : 'translateY(14px)',
        transition: 'opacity 0.45s ease, transform 0.45s ease',
      }}>

        {/* Top logo */}
        <div style={{ position: 'absolute', top: 28, left: isMobile ? 28 : 44, display: 'flex', alignItems: 'center', gap: 10 }}>
          <DaemonMark size={32} color="#3b6ef7" glow={true} />
          <span style={{ fontFamily: 'var(--orbitron)', fontSize: 12, fontWeight: 700, color: '#3b6ef7', letterSpacing: '0.14em' }}>WORKDAEMON</span>
        </div>

        <div style={{ maxWidth: 400, width: '100%', margin: 'auto 0' }}>
          {/* Heading */}
          <h1 style={{ fontFamily: 'var(--dmsans)', fontSize: 26, fontWeight: 600, color: '#e8e8e8', marginBottom: 8, letterSpacing: '-0.02em', lineHeight: 1.25 }}>
            {STEPS[step].title}
          </h1>
          <p style={{ fontFamily: 'var(--dmsans)', fontSize: 14, color: 'rgba(232,232,232,0.38)', marginBottom: 32, lineHeight: 1.55 }}>
            {STEPS[step].sub}
          </p>

          {/* Form */}
          {forms[step]}

          {/* Actions */}
          {saveErr && (
            <div style={{
              marginTop: 20,
              padding: '10px 14px',
              background: 'rgba(239,68,68,0.07)',
              border: '1px solid rgba(239,68,68,0.22)',
              borderRadius: 8,
              fontFamily: 'var(--dmsans)', fontSize: 13,
              color: '#ef4444', lineHeight: 1.5,
            }}>
              {saveErr}
            </div>
          )}
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 32 }}>
            {step > 0 && (
              <button type="button" onClick={() => setStep(s => s - 1)}
                style={{ background: 'none', border: 'none', fontFamily: 'var(--dmsans)', fontSize: 14, color: 'rgba(232,232,232,0.28)', cursor: 'pointer', padding: '10px 0', transition: 'color 0.15s' }}
                onMouseEnter={e => { e.currentTarget.style.color = 'rgba(232,232,232,0.52)'; }}
                onMouseLeave={e => { e.currentTarget.style.color = 'rgba(232,232,232,0.28)'; }}
              >Back</button>
            )}
            <div style={{ flex: 1 }} />
            {isOptional && (
              <button type="button" onClick={advance} disabled={saving}
                style={{ background: 'none', border: 'none', fontFamily: 'var(--dmsans)', fontSize: 14, color: 'rgba(232,232,232,0.30)', cursor: saving ? 'not-allowed' : 'pointer', padding: '10px 4px', transition: 'color 0.15s' }}
                onMouseEnter={e => { if (!saving) e.currentTarget.style.color = 'rgba(232,232,232,0.55)'; }}
                onMouseLeave={e => { if (!saving) e.currentTarget.style.color = 'rgba(232,232,232,0.30)'; }}
              >Skip</button>
            )}
            <button
              type="button"
              disabled={!canAdvance() || saving}
              onClick={handleAdvance}
              style={{
                padding: '10px 24px',
                background: canAdvance() && !saving ? '#3b6ef7' : 'rgba(255,255,255,0.06)',
                border: 'none',
                borderRadius: 8,
                fontFamily: 'var(--dmsans)', fontSize: 14, fontWeight: 500,
                color: canAdvance() && !saving ? '#fff' : 'rgba(255,255,255,0.22)',
                cursor: canAdvance() && !saving ? 'pointer' : 'not-allowed',
                transition: 'all 0.15s',
                whiteSpace: 'nowrap',
              }}
              onMouseEnter={e => { if (canAdvance() && !saving) { e.currentTarget.style.background = '#5d87ff'; e.currentTarget.style.boxShadow = '0 4px 16px rgba(59,110,247,0.3)'; } }}
              onMouseLeave={e => { if (canAdvance() && !saving) { e.currentTarget.style.background = '#3b6ef7'; e.currentTarget.style.boxShadow = 'none'; } }}
            >
              {getButtonLabel()}
            </button>
          </div>
        </div>
      </div>

      {/* ── Right: Brand visual (hidden on tablet/mobile) ── */}
      {!hideRight && (
        <div style={{
          flex: 1,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          position: 'relative',
          overflow: 'hidden',
          background: '#141414',
          borderLeft: '1px solid rgba(255,255,255,0.05)',
        }}>
          {getRightPanel()}
        </div>
      )}

      {/* ── Bottom step dots ── */}
      <div style={{
        position: 'absolute',
        bottom: 28,
        left: 0,
        width: hideRight ? '100%' : '50%',
        display: 'flex',
        justifyContent: 'center',
        alignItems: 'center',
        gap: 6,
      }}>
        {STEPS.map((_, i) => (
          <div
            key={i}
            onClick={() => i < step && setStep(i)}
            style={{
              width: i === step ? 22 : 6,
              height: 6,
              borderRadius: 3,
              background: i === step
                ? '#ffffff'
                : i < step
                ? 'rgba(255,255,255,0.32)'
                : 'rgba(255,255,255,0.15)',
              transition: 'all 0.35s cubic-bezier(0.34,1.56,0.64,1)',
              cursor: i < step ? 'pointer' : 'default',
            }}
          />
        ))}
      </div>
    </div>
  );
}
