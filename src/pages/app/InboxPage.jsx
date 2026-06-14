// Extracted from the former 5,000-line src/pages/Dashboard.jsx (2026-06-10 split).
import { useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useViewport } from '../../context/ThemeContext.jsx';
import { useAuth } from '../../context/AuthContext.jsx';
import { useC, SOURCE_COLORS } from '../../lib/theme.jsx';
import { useBrainFetch } from '../../lib/hooks.js';
import { SkeletonRow, EmptyState } from '../../components/ui.jsx';
import { BlockAlert } from '../../components/blocks.jsx';

export function InboxPage() {
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
            <h1 style={{ fontFamily: 'var(--inter)', fontSize: isMobile ? 20 : 24, fontWeight: 700, color: c.text, letterSpacing: '-0.03em', display: 'flex', alignItems: 'center', gap: 10 }}>
              Messages
              {unread > 0 && <span style={{ fontSize: 13, fontWeight: 500, fontFamily: 'var(--mono)', color: '#3b6ef7', background: 'rgba(59,110,247,0.09)', border: '1px solid rgba(59,110,247,0.22)', borderRadius: 20, padding: '2px 10px', letterSpacing: '0.05em' }}>{unread} new</span>}
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
              style={{ padding: '8px 14px', background: 'none', border: 'none', borderBottom: `2px solid ${filter === f.key ? '#3b6ef7' : 'transparent'}`, fontFamily: 'var(--mono)', fontSize: 10, letterSpacing: '0.1em', color: filter === f.key ? '#3b6ef7' : c.text3, cursor: 'pointer', marginBottom: -1, transition: 'all 0.15s' }}
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
                        {item.unread && <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#3b6ef7', flexShrink: 0 }} />}
                      </div>
                      {!expanded && (
                        <div style={{ fontFamily: 'var(--dmsans)', fontSize: 13, color: c.text3, lineHeight: 1.4, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{recommendation}</div>
                      )}
                      <div style={{ marginTop: 5, display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                        <span style={{ fontFamily: 'var(--mono)', fontSize: 9, color: c.text4, letterSpacing: '0.07em' }}>{item.source} · {item.time}</span>
                        {/* Source citation — the company document this alert is grounded in. */}
                        {item.metadata?.source && (
                          <span title="Source the Brain grounded this in" style={{ fontFamily: 'var(--mono)', fontSize: 9, color: c.text3, background: c.subtle, border: `1px solid ${c.subtleBorder}`, borderRadius: 5, padding: '2px 7px', letterSpacing: '0.06em' }}># {item.metadata.source}</span>
                        )}
                        {item.draft && !expanded && (
                          <span style={{ fontFamily: 'var(--mono)', fontSize: 9, letterSpacing: '0.08em', color: '#3b6ef7', background: 'rgba(59,110,247,0.09)', border: '1px solid rgba(59,110,247,0.22)', borderRadius: 6, padding: '2px 7px' }}>✎ DRAFT</span>
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
                        <div style={{ border: '1px solid rgba(59,110,247,0.22)', background: 'rgba(59,110,247,0.05)', borderRadius: 9, padding: '12px 13px' }}>
                          <div style={{ fontFamily: 'var(--mono)', fontSize: 9, letterSpacing: '0.1em', color: '#3b6ef7', marginBottom: 7 }}>{isCodeProposal ? '⚙ CODE PROPOSAL — REVIEW' : '✎ DRAFT — READY TO POST'}</div>
                          <div style={{ fontFamily: 'var(--dmsans)', fontSize: 13.5, color: c.text, lineHeight: 1.55, whiteSpace: 'pre-wrap' }}>{item.draft}</div>
                          <div style={{ marginTop: 11, display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                            {isCodeProposal ? (
                              ps === 'filed' ? <span style={{ fontFamily: 'var(--mono)', fontSize: 9, letterSpacing: '0.08em', color: '#22c55e' }}>✓ GITHUB ISSUE FILED</span>
                              : ps === 'dismissed' ? <span style={{ fontFamily: 'var(--mono)', fontSize: 9, letterSpacing: '0.08em', color: c.text4 }}>DISMISSED</span>
                              : (<>
                                  <button type="button" disabled={ps === 'filing'} onClick={(e) => { e.stopPropagation(); codeProposalAct(item, 'file_code_issue'); }}
                                    style={{ fontFamily: 'var(--mono)', fontSize: 9, letterSpacing: '0.08em', color: '#fff', background: '#3b6ef7', border: 'none', borderRadius: 6, padding: '6px 11px', cursor: ps === 'filing' ? 'default' : 'pointer', opacity: ps === 'filing' ? 0.6 : 1 }}>
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
                                style={{ fontFamily: 'var(--mono)', fontSize: 9, letterSpacing: '0.08em', color: '#fff', background: '#3b6ef7', border: 'none', borderRadius: 6, padding: '6px 11px', cursor: 'pointer' }}>
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


export default InboxPage;
