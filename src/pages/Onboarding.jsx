import { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import DaemonMark from '../components/brand/DaemonMark.jsx';
import { useViewport } from '../context/ThemeContext.jsx';
import { useAuth } from '../context/AuthContext.jsx';

const STEPS = [
  { id: 'profile',   title: 'Set up your profile.',   sub: "Choose how you'll appear in WorkDaemon." },
  { id: 'workspace', title: 'Name your workspace.',   sub: 'Your company name and team size.' },
  { id: 'role',      title: "What's your role?",      sub: 'Your Daemon will be tuned to your position.' },
  { id: 'industry',  title: 'Pick your industry.',    sub: 'Context for your knowledge graph.' },
  { id: 'invite',    title: 'Invite your team.',      sub: 'WorkDaemon is better with your whole team.' },
  { id: 'github',    title: 'Connect GitHub.',        sub: 'Sync your code, PRs, and deployments.' },
  { id: 'slack',     title: 'Connect Slack.',         sub: 'Bring WorkDaemon into your conversations.' },
];

const ROLES = [
  { id: 'ceo',     label: 'CEO / Founder',   sub: 'Strategy & company vision' },
  { id: 'cto',     label: 'CTO',             sub: 'Engineering & architecture' },
  { id: 'pm',      label: 'Product Manager', sub: 'Roadmap & prioritization' },
  { id: 'eng',     label: 'Eng Lead',        sub: 'Sprints & code review' },
  { id: 'sales',   label: 'Head of Sales',   sub: 'Pipeline & revenue' },
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

const SIZES = ['1–5', '6–20', '21–100', '100+'];

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
        border: `1px solid ${focused ? 'rgba(65,114,245,0.55)' : 'rgba(255,255,255,0.1)'}`,
        borderRadius: 8,
        color: '#e8e8e8',
        fontSize: 15,
        fontFamily: 'var(--dmsans)',
        outline: 'none',
        transition: 'border-color 0.15s, background 0.15s, box-shadow 0.15s',
        boxShadow: focused ? '0 0 0 2px rgba(65,114,245,0.18)' : 'none',
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
            flexShrink: 0, cursor: 'pointer',
          }}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.38)" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
              <path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2"/><circle cx="12" cy="7" r="4"/>
            </svg>
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
  return (
    <GridSelect
      options={ROLES}
      value={data.role}
      onSelect={v => setData(d => ({ ...d, role: v }))}
      getKey={r => r.id}
      getLabel={r => r.label}
      getSub={r => r.sub}
    />
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
          border: `1px solid ${focused ? 'rgba(65,114,245,0.55)' : 'rgba(255,255,255,0.1)'}`,
          borderRadius: 8,
          color: '#e8e8e8',
          fontSize: 14,
          fontFamily: 'var(--dmsans)',
          outline: 'none',
          resize: 'none',
          lineHeight: 1.65,
          transition: 'all 0.15s',
          boxShadow: focused ? '0 0 0 2px rgba(65,114,245,0.18)' : 'none',
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
        <DaemonMark size={130} color="#4172f5" />
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
  const { token } = useAuth();
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

  const canAdvance = () => {
    if (step === 1) return !!data.company?.trim() && data.slugStatus === 'available';
    if (step === 2) return !!data.role;
    if (step === 3) return !!data.industry;
    return true;
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
      return true;
    } catch {
      setSaveErr('Unable to reach the server. Check your connection and try again.');
      return false;
    } finally {
      setSaving(false);
    }
  }, [data]);

  const advance = async () => {
    // Submit after industry step (step 3), before moving to optional steps
    if (step === 3) {
      const ok = await submitSetup();
      if (!ok) return;
    }
    // GitHub and Slack integrations — skip for now, connect later from dashboard
    if (step === 5 || step === 6) {
      if (step < STEPS.length - 1) setStep(s => s + 1);
      else navigate('/app');
      return;
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
    setStep(s => s + 1);
  };

  const isOptional = step >= 4;

  const getButtonLabel = () => {
    if (saving) return '...';
    if (step === 4) return 'Send invitations';
    if (step === 5) return 'Connect GitHub';
    if (step === 6) return 'Connect Slack';
    return 'Continue';
  };

  const handleAdvance = step === 4 ? sendInvites : advance;

  const getRightPanel = () => {
    if (step === 5) return <PanelGitHub />;
    if (step === 6) return <PanelSlack />;
    return <PanelDefault />;
  };

  const forms = [
    <StepProfile   key={0} data={data} setData={setData} />,
    <StepWorkspace key={1} data={data} setData={setData} />,
    <StepRole      key={2} data={data} setData={setData} />,
    <StepIndustry  key={3} data={data} setData={setData} />,
    <StepInvite    key={4} data={data} setData={setData} inviteLink={inviteLink} />,
    <StepConnect   key={5} features={GITHUB_FEATURES} />,
    <StepConnect   key={6} features={SLACK_FEATURES} />,
  ];

  return (
    <div style={{ height: '100vh', display: 'flex', background: '#191919', overflow: 'hidden', position: 'relative' }}>

      {/* ── Left: Form panel ── */}
      <div style={{
        width: hideRight ? '100%' : '50%',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'center',
        padding: isMobile ? '80px 28px 60px' : '60px 80px',
        borderRight: hideRight ? 'none' : '1px solid rgba(255,255,255,0.06)',
        position: 'relative',
        opacity: visible ? 1 : 0,
        transform: visible ? 'none' : 'translateY(14px)',
        transition: 'opacity 0.45s ease, transform 0.45s ease',
      }}>

        {/* Top logo */}
        <div style={{ position: 'absolute', top: 28, left: isMobile ? 28 : 44, display: 'flex', alignItems: 'center', gap: 10 }}>
          <DaemonMark size={32} color="#4172f5" glow={true} />
          <span style={{ fontFamily: 'var(--orbitron)', fontSize: 12, fontWeight: 700, color: '#4172f5', letterSpacing: '0.14em' }}>WORKDAEMON</span>
        </div>

        <div style={{ maxWidth: 400 }}>
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
                background: canAdvance() && !saving ? '#4172f5' : 'rgba(255,255,255,0.06)',
                border: 'none',
                borderRadius: 8,
                fontFamily: 'var(--dmsans)', fontSize: 14, fontWeight: 500,
                color: canAdvance() && !saving ? '#fff' : 'rgba(255,255,255,0.22)',
                cursor: canAdvance() && !saving ? 'pointer' : 'not-allowed',
                transition: 'all 0.15s',
                whiteSpace: 'nowrap',
              }}
              onMouseEnter={e => { if (canAdvance() && !saving) { e.currentTarget.style.background = '#5281ff'; e.currentTarget.style.boxShadow = '0 4px 16px rgba(65,114,245,0.3)'; } }}
              onMouseLeave={e => { if (canAdvance() && !saving) { e.currentTarget.style.background = '#4172f5'; e.currentTarget.style.boxShadow = 'none'; } }}
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
