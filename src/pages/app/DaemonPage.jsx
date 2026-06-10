// Extracted from the former 5,000-line src/pages/Dashboard.jsx (2026-06-10 split).
import { useState, useEffect, useRef, useCallback } from 'react';
import { useViewport } from '../../context/ThemeContext.jsx';
import { useAuth } from '../../context/AuthContext.jsx';
import { useC } from '../../lib/theme.jsx';
import { dbMsgToDisplay, callDaemonAPI } from '../../lib/daemonApi.js';
import { Spinner, Md } from '../../components/ui.jsx';
import { renderBlock, BlockAlert } from '../../components/blocks.jsx';
import DaemonMark from '../../components/brand/DaemonMark.jsx';

// ─────────────────────────────────────────────────────────────────────────────
// CONTEXT PRESETS  (role categories — not demo data)
// ─────────────────────────────────────────────────────────────────────────────

export const CONTEXT_PRESETS = [
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


export function ChatView({ context, onBack, onMenu }) {
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
          <div style={{ fontFamily: 'var(--inter)', fontSize: isMobile ? 13 : 14, fontWeight: 600, color: '#ededef', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', letterSpacing: '-0.02em' }}>
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
                  background: '#3b6ef7',
                  borderRadius: '18px 18px 4px 18px',
                  fontFamily: 'var(--dmsans)', fontSize: isMobile ? 14 : 15,
                  color: '#ffffff', lineHeight: 1.5,
                  boxShadow: '0 2px 12px rgba(59,110,247,0.25)',
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
                          <button title="Copy reply" onClick={(e) => {
                            const out = [m.text, ...(m.blocks || []).map(b => b.md || b.content || b.summary || b.title).filter(Boolean)].join('\n\n');
                            navigator.clipboard?.writeText(out).catch(() => {});
                            const el = e.currentTarget; el.style.color = '#10b981';
                            setTimeout(() => { if (el) el.style.color = ''; }, 900);
                          }}
                            style={{
                              width: 26, height: 26, display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                              background: 'transparent', border: '1px solid transparent', borderRadius: 7,
                              color: c.text3, cursor: 'pointer', padding: 0,
                              transition: 'color 0.12s, border-color 0.12s, background 0.12s',
                            }}
                            onMouseEnter={e => { e.currentTarget.style.borderColor = c.hairlineStrong; e.currentTarget.style.background = c.surface2; }}
                            onMouseLeave={e => { e.currentTarget.style.borderColor = 'transparent'; e.currentTarget.style.background = 'transparent'; }}>
                            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                              <rect width="14" height="14" x="8" y="8" rx="2" ry="2" /><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2" />
                            </svg>
                          </button>
                          {[
                            { sig: 'up', title: 'Good answer', flip: false },
                            { sig: 'down', title: 'Needs work', flip: true },
                          ].map(({ sig, title, flip }) => (
                            <button key={sig} title={title} onClick={() => sendFeedback(i, sig)}
                              style={{
                                width: 26, height: 26, display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                                background: 'transparent', border: '1px solid transparent', borderRadius: 7,
                                color: c.text3, cursor: 'pointer', padding: 0,
                                transition: 'color 0.12s, border-color 0.12s, background 0.12s',
                              }}
                              onMouseEnter={e => { e.currentTarget.style.color = c.text; e.currentTarget.style.borderColor = c.hairlineStrong; e.currentTarget.style.background = c.surface2; }}
                              onMouseLeave={e => { e.currentTarget.style.color = c.text3; e.currentTarget.style.borderColor = 'transparent'; e.currentTarget.style.background = 'transparent'; }}>
                              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"
                                style={flip ? { transform: 'rotate(180deg)' } : undefined}>
                                <path d="M7 10v12" /><path d="M15 5.88 14 10h5.83a2 2 0 0 1 1.92 2.56l-2.33 8A2 2 0 0 1 17.5 22H4a2 2 0 0 1-2-2v-8a2 2 0 0 1 2-2h2.76a2 2 0 0 0 1.79-1.11L12 2a3.13 3.13 0 0 1 3 3.88Z" />
                              </svg>
                            </button>
                          ))}
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
              background: input.trim() && !thinking ? '#3b6ef7' : c.d ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.04)',
              border: 'none', color: input.trim() && !thinking ? '#fff' : c.text3,
              fontSize: isMobile ? 18 : 20, cursor: input.trim() && !thinking ? 'pointer' : 'not-allowed',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              transition: 'all 0.15s', flexShrink: 0,
              boxShadow: input.trim() && !thinking ? '0 4px 16px rgba(59,110,247,0.28)' : 'none',
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

export function DaemonPage({ onMenu, onChatChange }) {
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


export default DaemonPage;
