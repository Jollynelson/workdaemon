import { useState, useEffect, useRef, useCallback } from 'react';
import { Routes, Route, Navigate, useNavigate } from 'react-router-dom';
import Sidebar from '../components/layout/Sidebar.jsx';
import DaemonMark from '../components/brand/DaemonMark.jsx';
import { useTheme, useViewport } from '../context/ThemeContext.jsx';
import {
  BarChart, Bar, LineChart, Line, AreaChart, Area,
  XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid,
} from 'recharts';

// ─────────────────────────────────────────────────────────────────────────────
// THEME COLORS HOOK
// ─────────────────────────────────────────────────────────────────────────────

function useC() {
  const { theme } = useTheme();
  const d = theme === 'dark';
  return {
    d,
    text:    d ? '#e8e8e8'                    : '#1a1a1a',
    text2:   d ? 'rgba(232,232,232,0.65)'    : 'rgba(26,26,26,0.65)',
    text3:   d ? 'rgba(232,232,232,0.38)'    : 'rgba(26,26,26,0.42)',
    text4:   d ? 'rgba(232,232,232,0.18)'    : 'rgba(26,26,26,0.22)',
    bg:      d ? '#191919'                    : '#ffffff',
    surface: d ? '#252525'                    : '#fafafa',
    card:    d ? '#252525'                    : '#ffffff',
    cardBorder: d ? 'rgba(255,255,255,0.07)' : 'rgba(0,0,0,0.08)',
    cardShadow: d ? 'none'                    : '0 1px 3px rgba(0,0,0,0.06)',
    stat:    d ? '#252525'                    : '#fafafa',
    statBorder: d ? 'rgba(255,255,255,0.07)' : 'rgba(0,0,0,0.08)',
    statShadow: d ? 'none'                    : '0 1px 4px rgba(0,0,0,0.06)',
    row:     d ? 'rgba(255,255,255,0.04)'    : 'rgba(0,0,0,0.025)',
    rowBorder: d ? 'rgba(255,255,255,0.07)'  : 'rgba(0,0,0,0.07)',
    subtle:  d ? 'rgba(255,255,255,0.03)'    : 'rgba(0,0,0,0.02)',
    subtleBorder: d ? 'rgba(255,255,255,0.07)' : 'rgba(0,0,0,0.07)',
    headerBg: d ? '#191919'                   : '#ffffff',
    headerBorder: d ? 'rgba(255,255,255,0.07)' : 'rgba(0,0,0,0.08)',
    inputBg: d ? 'rgba(255,255,255,0.05)'    : '#ffffff',
    inputBorder: d ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.12)',
    thinkingBg: d ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.03)',
    thinkingBorder: d ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.08)',
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// INDUSTRY / ROLE DATA
// ─────────────────────────────────────────────────────────────────────────────

const INDUSTRIES = [
  {
    id: 'tech', name: 'Tech Startup', company: 'Meridian Labs',
    description: 'Series A SaaS startup building developer tools',
    tools: ['Notion', 'Jira', 'Slack', 'GitHub', 'Gmail'],
    roles: [
      { id: 'ceo',  label: 'CEO / Founder',   sub: 'Strategy, fundraising & vision' },
      { id: 'cto',  label: 'CTO',             sub: 'Architecture, infra & eng team' },
      { id: 'pm',   label: 'Product Manager', sub: 'Roadmap, specs & prioritization' },
      { id: 'eng',  label: 'Eng Lead',        sub: 'Sprints, code review & velocity' },
      { id: 'sales',label: 'Head of Sales',   sub: 'Pipeline, quotas & revenue' },
    ],
  },
  {
    id: 'health', name: 'Healthcare', company: 'Clearview Health',
    description: 'Digital health platform for outpatient care',
    tools: ['Epic', 'Slack', 'Gmail', 'Notion', 'Jira'],
    roles: [
      { id: 'coo',     label: 'COO',             sub: 'Operations, compliance & staffing' },
      { id: 'doc',     label: 'Medical Director', sub: 'Clinical protocols & care quality' },
      { id: 'nurse',   label: 'Head Nurse',       sub: 'Schedules, patient flow & care' },
      { id: 'billing', label: 'Billing Manager',  sub: 'Claims, codes & revenue cycle' },
      { id: 'it',      label: 'Health IT Lead',   sub: 'EHR systems & HIPAA compliance' },
    ],
  },
  {
    id: 'creative', name: 'Creative Agency', company: 'Bright Matter Studio',
    description: 'Brand strategy and digital experience agency',
    tools: ['Figma', 'Notion', 'Slack', 'HubSpot', 'Gmail'],
    roles: [
      { id: 'cd',     label: 'Creative Director', sub: 'Brand strategy & creative vision' },
      { id: 'acct',   label: 'Account Director',  sub: 'Clients, scopes & deliverables' },
      { id: 'design', label: 'Lead Designer',     sub: 'Visual systems & design reviews' },
      { id: 'copy',   label: 'Head of Copy',      sub: 'Brand voice & written content' },
      { id: 'strat',  label: 'Brand Strategist',  sub: 'Positioning & market research' },
    ],
  },
];

// ─────────────────────────────────────────────────────────────────────────────
// INITIAL GREETINGS (per industry × role)
// ─────────────────────────────────────────────────────────────────────────────

function getGreeting(industryId, roleId) {
  if (industryId === 'tech') {
    if (roleId === 'pm') return {
      blocks: [
        { type: 'text', md: `Company Brain is online — Notion, Jira, Slack, GitHub, and Gmail are all indexed and current.\n\n**Sprint 23** ends Friday. You're at 3 of 8 tickets complete with 5 still open. **BUG-119** (P0) has had no update from James in 3 days — escalation recommended before the **28 May investor demo**. Two other blockers need your attention now.` },
        { type: 'stat_grid', stats: [
          { label: 'Sprint Progress', value: '3', unit: 'of 8 tickets', source: 'Jira', accent: 'warn' },
          { label: 'Days to Demo',    value: '9', unit: 'days',          accent: 'warn' },
          { label: 'Q2 Revenue',      value: '$2.1M', unit: 'target $2.4M', accent: 'warn' },
          { label: 'NPS Score',       value: '61',   unit: 'target 65',   accent: 'warn' },
        ]},
        { type: 'alert', level: 'danger', title: 'BUG-119 — P0 session timeout, 23% login dropoff', content: 'Assigned to James. Last update: 13 May (3 days ago). This is blocking the investor demo build.', tag: '#Jira BUG-119' },
      ],
      suggestions: ["What's blocking Sprint 23?", "Show me team task status", "What's our Q2 OKR progress?"],
    };

    if (roleId === 'ceo') return {
      blocks: [
        { type: 'text', md: `Company Brain is online — Notion, Linear, Slack, GitHub, and Gmail are indexed.\n\nBurn rate is $82K/mo with **14 months of runway**. MRR hit **$48.2K** this week (+12% MoM). Series A pitch deck has 3 slides flagged as stale before the **May 30 investor call**. Two open engineering reqs have had no recruiter update in 5 days.` },
        { type: 'stat_grid', stats: [
          { label: 'MRR',         value: '$48.2K', unit: '+12% MoM',    accent: 'ok'   },
          { label: 'Runway',      value: '14 mo',  unit: '$82K burn/mo', accent: 'warn' },
          { label: 'Pipeline',    value: '$284K',  unit: '+$42K WoW',    accent: 'ok'   },
          { label: 'Team',        value: '12',     unit: '2 open reqs',  accent: 'warn' },
        ]},
        { type: 'alert', level: 'warning', title: 'Pitch deck: 3 slides need updating', content: 'Competitive analysis (slide 8), ARR projection (slide 12), and team page (slide 18) were last edited 6 weeks ago. Investor call is May 30.', tag: '#Notion Pitch Deck' },
      ],
      suggestions: ["What needs my attention today?", "Show MRR and burn trend", "What's the status on hiring?"],
    };

    if (roleId === 'cto') return {
      blocks: [
        { type: 'text', md: `Company Brain is online — GitHub, Linear, Notion, and Slack are indexed.\n\n**P0 alert**: auth service is returning 503s for 2.1% of requests in eu-west-1. DB CPU peaked at 84% last night. Sprint 23 has 5 open tickets — **3 are blocked**. Deploy pipeline has a failing test in the payments module blocking release.` },
        { type: 'stat_grid', stats: [
          { label: 'Error Rate',   value: '2.1%',  unit: 'eu-west-1',   accent: 'danger' },
          { label: 'DB CPU',       value: '84%',   unit: 'peak last 24h', accent: 'warn' },
          { label: 'Open PRs',     value: '11',    unit: '3 > 4 days',   accent: 'warn' },
          { label: 'Deploy Health',value: 'FAIL',  unit: 'payments test', accent: 'danger' },
        ]},
        { type: 'alert', level: 'danger', title: 'Auth service degraded — eu-west-1', content: 'P0. 2.1% of login requests returning 503. Started 47 minutes ago. Assigned to infra team. On-call paged.', tag: '#GitHub ops/incident-47' },
      ],
      suggestions: ["What's causing the auth errors?", "Show open PRs older than 3 days", "What's blocking the payments deploy?"],
    };
  }

  if (industryId === 'health') return {
    blocks: [
      { type: 'text', md: `Company Brain is online — Epic EHR, Slack, and Gmail are indexed and current.\n\n**14 patients** scheduled today, 3 with flagged care gaps. Nursing roster has a gap Friday PM — 2 positions unfilled. **Billing alert**: 18 claims pending resubmission from last week's rejection batch. HIPAA audit documentation due in 6 days.` },
      { type: 'stat_grid', stats: [
        { label: 'Today\'s Patients',  value: '14',   unit: '3 with flags',   accent: 'warn' },
        { label: 'Claims Pending',    value: '18',   unit: 'resubmission',   accent: 'warn' },
        { label: 'HIPAA Audit',       value: '6',    unit: 'days remaining', accent: 'warn' },
        { label: 'Staff Coverage',    value: '91%',  unit: 'Fri PM gap',     accent: 'warn' },
      ]},
      { type: 'alert', level: 'warning', title: '18 claims pending resubmission', content: 'Batch rejected on 22 May due to invalid ICD-10 codes. Revenue impact: ~$24,400. Billing team needs to resubmit by Friday.', tag: '#Epic Billing' },
    ],
    suggestions: ["Show today's flagged patients", "What's the billing backlog?", "Who's covering Friday PM shift?"],
  };

  // Creative / fallback
  return {
    blocks: [
      { type: 'text', md: `Company Brain is online — Figma, Notion, HubSpot, and Gmail are indexed.\n\n**3 active client projects** have deliverables due this week. The **Vega rebrand** final presentation is Friday — creative director review still pending. Two new briefs from Novex and Cala are unassigned. Q2 pipeline is at $380K with a $240K retainer renewal at risk.` },
      { type: 'stat_grid', stats: [
        { label: 'Deliverables Due',  value: '3',     unit: 'this week',      accent: 'warn' },
        { label: 'Q2 Pipeline',       value: '$380K', unit: '+$40K WoW',      accent: 'ok'   },
        { label: 'At-Risk Revenue',   value: '$240K', unit: 'renewal pending', accent: 'danger' },
        { label: 'Unassigned Briefs', value: '2',     unit: 'new this week',  accent: 'warn' },
      ]},
      { type: 'alert', level: 'warning', title: 'Vega rebrand — CD review still pending', content: 'Final presentation is Friday. Sarah (CD) hasn\'t reviewed the revised brand guidelines submitted Monday. 4 days of buffer remain.', tag: '#Figma Vega-v4' },
    ],
    suggestions: ["What's due this week?", "Show at-risk accounts", "What's unassigned right now?"],
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// DEMO RESPONSES (return {blocks, suggestions})
// ─────────────────────────────────────────────────────────────────────────────

function generateDemoResponse(query, role, industry) {
  const q = query.toLowerCase();

  if (q.includes('blocking') || q.includes('blocker') || q.includes('sprint')) {
    return {
      blocks: [
        { type: 'text', md: `Three active blockers are stalling **Sprint 23**. The most critical is **BUG-119** — a P0 login drop-off bug assigned to **James** with no update in 3 days, directly threatening the **28 May investor demo**. **AUTH-047** is blocked because James is waiting on specs from **Zoe** that haven't arrived yet. And **PR#204** has been sitting without a review from **Marcus** for 4 days, creating downstream delays for **Sarah's** QA pipeline.` },
        { type: 'alert', level: 'danger', title: 'BUG-119 P0 Stale — 3 Days No Update', content: '23% login drop-off rate is unresolved. James is assigned but has not updated the ticket in 3 days. Investor demo is 28 May — 9 days out. This must be resolved or escalated today.', tag: '#Jira BUG-119' },
        { type: 'alert', level: 'warning', title: 'AUTH-047 Blocked on Design Specs', content: 'James cannot proceed with AUTH-047 (P1) until Zoe delivers the required specs. No ETA has been set. Every day of delay risks missing the sprint goal.', tag: '#Jira AUTH-047' },
        { type: 'alert', level: 'warning', title: 'PR#204 Awaiting Review — 4 Days', content: 'Marcus has not reviewed PR#204 in 4 days. Sarah\'s QA pipeline is blocked downstream. Auto-escalation threshold is 5 days.', tag: '#GitHub PR#204' },
      ],
      suggestions: [
        "Ping James on Slack asking for a BUG-119 status update and ETA to resolution",
        "Message Zoe to set a hard deadline for AUTH-047 specs — today or tomorrow",
        "Escalate PR#204 to Marcus with a review-by deadline of end of day today",
      ],
    };
  }

  if (q.includes('team') || q.includes('people') || q.includes('who') || q.includes('task status')) {
    return {
      blocks: [
        { type: 'text', md: `Here's the current team status for **${industry.company}**:` },
        { type: 'people_list', people: [
          { name: 'Jordan Lee',   role: 'Engineering Lead',  status: 'online', metric: '8 PRs merged' },
          { name: 'Sam Okonkwo', role: 'Product Manager',   status: 'online', metric: '3 specs shipped' },
          { name: 'Priya Singh',  role: 'Head of Design',    status: 'away',   metric: '2 flows in review' },
          { name: 'Marcus Webb',  role: 'Head of Sales',     status: 'online', metric: '$142K pipeline' },
          { name: 'Tara Nkosi',   role: 'Customer Success',  status: 'online', metric: 'NPS 67' },
        ]},
        { type: 'alert', level: 'info', title: 'Headcount', content: '12 FTEs · 3 contractors · 2 open reqs: Senior Backend Eng + Growth Lead', tag: '#Notion Team' },
      ],
      suggestions: [
        "Draft a Slack message to the engineering team about BUG-119",
        "Show me who's behind on their sprint tasks",
        "What are the open reqs and where are candidates?",
      ],
    };
  }

  if (q.includes('okr') || q.includes('goal') || q.includes('target') || q.includes('kpi')) {
    return {
      blocks: [
        { type: 'text', md: `**Q2 OKR progress** — 6 weeks remaining in the quarter.` },
        { type: 'progress_bars', items: [
          { label: 'MRR Target ($60K)',          value: 80, color: '#4172f5' },
          { label: 'NPS Target (70)',            value: 87, color: '#10b981' },
          { label: 'Enterprise Closed (3 deals)',value: 33, color: '#f59e0b' },
          { label: 'Churn < 2%',                value: 72, color: '#f59e0b' },
        ]},
        { type: 'alert', level: 'warning', content: 'Enterprise deals (1 of 3 closed) and churn reduction are the two OKRs at highest risk of missing Q2 target.', tag: '#Notion OKR Board' },
      ],
      suggestions: [
        "What does the enterprise pipeline look like?",
        "Who owns the churn reduction initiative?",
        "Set a reminder to review OKRs with the team Friday",
      ],
    };
  }

  if (q.includes('mrr') || q.includes('revenue') || q.includes('sales') || q.includes('pipeline')) {
    return {
      blocks: [
        { type: 'stat_grid', stats: [
          { label: 'MRR',      value: '$48.2K', unit: '+12% MoM',   accent: 'ok' },
          { label: 'Pipeline', value: '$284K',  unit: '+$42K WoW',  accent: 'ok' },
          { label: 'Win Rate', value: '34%',    unit: '+3 pp',      accent: 'ok' },
          { label: 'Churn',    value: '2.4%',   unit: 'target <2%', accent: 'warn' },
        ]},
        { type: 'chart_line', filled: true, title: 'MRR — Last 8 Weeks', keys: ['mrr'], data: [
          { name: 'W1', mrr: 38000 }, { name: 'W2', mrr: 40200 }, { name: 'W3', mrr: 41800 },
          { name: 'W4', mrr: 43500 }, { name: 'W5', mrr: 44900 }, { name: 'W6', mrr: 46100 },
          { name: 'W7', mrr: 47200 }, { name: 'W8', mrr: 48200 },
        ]},
        { type: 'alert', level: 'info', content: 'Churn at 2.4% is above the 2% target. 3 accounts flagged for risk: Vertax, Orin Systems, and Blue Lake.', tag: '#HubSpot' },
      ],
      suggestions: [
        "Show me the 3 at-risk accounts in detail",
        "What's driving the MRR growth — new logo vs expansion?",
        "Draft a QBR deck outline for next week",
      ],
    };
  }

  if (q.includes('roadmap') || q.includes('timeline') || q.includes('plan') || q.includes('ship')) {
    return {
      blocks: [
        { type: 'text', md: `**Product roadmap** for ${industry.company}:` },
        { type: 'timeline', events: [
          { title: 'v2.4 — Auth overhaul + SSO shipped', time: '2 weeks ago', accent: false },
          { title: 'v2.5 — AI-assisted onboarding (in progress)', time: 'Due in 5 days', accent: true },
          { title: 'v2.6 — Mobile app beta launch', time: 'Due in 3 weeks', accent: false },
          { title: 'v3.0 — Enterprise plan + Audit log', time: 'Q3 target', accent: false },
          { title: 'v3.1 — API v2 + partner integrations', time: 'Q4 target', accent: false },
        ]},
        { type: 'alert', level: 'warning', content: 'v2.5 is 2 days behind schedule due to the BUG-119 blocker. If unresolved by Wednesday, the mobile beta (v2.6) will slip.', tag: '#Linear Roadmap' },
      ],
      suggestions: [
        "What would it take to get v2.5 back on track?",
        "Show me the features planned for v3.0",
        "Who owns the mobile app project?",
      ],
    };
  }

  if (q.includes('status') || q.includes('overview') || q.includes('how') || q.includes('doing') || q.includes('attention')) {
    const greeting = getGreeting(industry.id, 'pm');
    return {
      blocks: greeting.blocks,
      suggestions: greeting.suggestions,
    };
  }

  // Generic fallback
  return {
    blocks: [
      { type: 'text', md: `I'm your **${role.label} Daemon** for ${industry.company}. I have full context on your company — ask me about the sprint, team, pipeline, roadmap, OKRs, or anything else.` },
      { type: 'alert', level: 'info', title: 'Try asking', content: '"What\'s blocking Sprint 23?" · "Show me the team" · "How\'s revenue this month?" · "What\'s our roadmap?" · "Any blockers I should know about?"' },
    ],
    suggestions: ["What needs my attention?", "How are we doing?", "Show me the roadmap"],
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// MARKDOWN TEXT RENDERER
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

const CHART_COLORS = ['#4172f5', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6'];
const ACCENT_COLORS = { ok: '#10b981', warn: '#f59e0b', danger: '#ef4444', blue: '#4172f5' };

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
          {s.unit && <div style={{ fontFamily: 'var(--dmsans)', fontSize: 12, color: c.text3 }}>{s.unit}</div>}
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
  const DataComp = block.filled ? Area : Line;
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
    info:    { bg: c.d ? 'rgba(255,255,255,0.04)'  : 'rgba(0,0,0,0.02)',       border: 'rgba(65,114,245,0.22)', leftBorder: '#4172f5', title: '#4172f5', icon: 'ℹ' },
    success: { bg: c.d ? 'rgba(16,185,129,0.08)'  : 'rgba(16,185,129,0.07)',  border: 'rgba(16,185,129,0.22)',  leftBorder: '#10b981', title: '#10b981', icon: '✓' },
    warning: { bg: c.d ? 'rgba(245,158,11,0.08)'  : 'rgba(245,158,11,0.07)',  border: 'rgba(245,158,11,0.22)',  leftBorder: '#f59e0b', title: '#f59e0b', icon: '⚠' },
    danger:  { bg: c.d ? 'rgba(239,68,68,0.08)'   : 'rgba(239,68,68,0.06)',   border: 'rgba(239,68,68,0.22)',   leftBorder: '#ef4444', title: '#ef4444', icon: '×' },
  };
  const s = styles[block.level] || styles.info;
  return (
    <div style={{ padding: '13px 16px', background: s.bg, border: `1px solid ${s.border}`, borderLeft: `3px solid ${s.leftBorder}`, borderRadius: '0 10px 10px 0', borderTopLeftRadius: 0, borderBottomLeftRadius: 0 }}>
      {block.title && (
        <div style={{ fontFamily: 'var(--mono)', fontSize: 11, color: s.title, letterSpacing: '0.08em', marginBottom: 6, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ fontSize: 12 }}>{s.icon}</span> {block.title}
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
          <div style={{ height: 5, background: c.d ? 'rgba(255,255,255,0.06)' : 'rgba(15,20,53,0.08)', borderRadius: 3, overflow: 'hidden' }}>
            <div style={{ height: '100%', width: `${Math.min(item.value, 100)}%`, background: item.color || '#4172f5', borderRadius: 3, animation: 'wd-progress 0.8s ease both' }} />
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
        <button className="wd-btn" style={{ flex: 1, height: 40, fontSize: 9 }} onClick={() => setDone(true)}>{block.confirmLabel || 'CONFIRM'}</button>
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
// CHAT VIEW
// ─────────────────────────────────────────────────────────────────────────────

function Spinner() {
  return <span style={{ width: 14, height: 14, display: 'inline-block', border: '2px solid rgba(255,255,255,0.1)', borderTopColor: 'rgba(255,255,255,0.65)', borderRadius: '50%', animation: 'wd-spin 0.75s linear infinite' }} />;
}

function ChatView({ industry, role, onBack, onMenu }) {
  const c = useC();
  const { isMobile } = useViewport();
  const [messages, setMessages] = useState([]);
  const [suggestions, setSuggestions] = useState([]);
  const [input, setInput] = useState('');
  const [thinking, setThinking] = useState(false);
  const [apiKey, setApiKey] = useState('');
  const [showApiModal, setShowApiModal] = useState(false);
  const bottomRef = useRef(null);
  const inputRef = useRef(null);

  // Auto-load greeting
  useEffect(() => {
    const g = getGreeting(industry.id, role.id);
    setMessages([{ role: 'daemon', blocks: g.blocks }]);
    setSuggestions(g.suggestions);
  }, [industry.id, role.id]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, thinking]);

  const send = useCallback(async (text) => {
    const q = text.trim();
    if (!q || thinking) return;
    setSuggestions([]);
    setMessages(m => [...m, { role: 'user', text: q }]);
    setInput('');
    setThinking(true);

    await new Promise(r => setTimeout(r, 750 + Math.random() * 450));

    const { blocks, suggestions: nextSugs } = generateDemoResponse(q, role, industry);
    setMessages(m => [...m, { role: 'daemon', blocks }]);
    setSuggestions(nextSugs);
    setThinking(false);
    setTimeout(() => inputRef.current?.focus(), 50);
  }, [industry, role, thinking]);

  const isLong = suggestions.some(s => s.length > 36);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden', background: c.bg, transition: 'background 0.2s' }}>

      {/* Header */}
      <div style={{ padding: isMobile ? '0 12px' : '0 24px', height: 52, display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderBottom: `1px solid ${c.headerBorder}`, background: c.headerBg, flexShrink: 0, transition: 'background 0.2s, border-color 0.2s', gap: 8 }}>
        {/* Left: back + identity */}
        <div style={{ display: 'flex', alignItems: 'center', gap: isMobile ? 8 : 14, minWidth: 0, flex: 1 }}>
          {isMobile && (
            <button type="button" onClick={onMenu} style={{
              width: 32, height: 32, borderRadius: 8, background: 'none', border: 'none',
              display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 4,
              cursor: 'pointer', padding: 0, flexShrink: 0,
              color: c.text3,
            }}>
              <span style={{ width: 16, height: 1.5, background: 'currentColor', borderRadius: 1, display: 'block' }} />
              <span style={{ width: 16, height: 1.5, background: 'currentColor', borderRadius: 1, display: 'block' }} />
              <span style={{ width: 11, height: 1.5, background: 'currentColor', borderRadius: 1, display: 'block', alignSelf: 'flex-start' }} />
            </button>
          )}
          <div style={{ width: 1, height: 16, background: c.cardBorder, flexShrink: 0 }} />
          <button type="button" onClick={onBack} style={{ fontFamily: 'var(--mono)', fontSize: isMobile ? 9 : 13, color: c.text3, background: 'none', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4, padding: 0, transition: 'color 0.15s', letterSpacing: isMobile ? '0.08em' : 0, flexShrink: 0 }}
            onMouseEnter={e => { e.currentTarget.style.color = c.text2; }}
            onMouseLeave={e => { e.currentTarget.style.color = c.text3; }}>
            ← BACK
          </button>
          <div style={{ width: 1, height: 16, background: c.cardBorder, flexShrink: 0 }} />
          <DaemonMark size={16} glow={c.d} />
          <div style={{ fontFamily: 'var(--dmsans)', fontSize: isMobile ? 13 : 14, fontWeight: 600, color: c.text, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{role.label}</div>
          {!isMobile && (
            <>
              <div style={{ width: 1, height: 14, background: c.cardBorder, flexShrink: 0 }} />
              <div style={{ fontFamily: 'var(--dmsans)', fontSize: 13, color: c.text3, whiteSpace: 'nowrap' }}>{industry.company}</div>
              <div style={{ display: 'flex', gap: 8, marginLeft: 4, flexShrink: 0 }}>
                {industry.tools.map(t => (
                  <span key={t} style={{ fontFamily: 'var(--dmsans)', fontSize: 11, color: c.text4 }}>{t}</span>
                ))}
              </div>
            </>
          )}
        </div>
        {/* Right: controls */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
          {!isMobile && (
            <button className="wd-btn-ghost" onClick={() => setShowApiModal(true)} style={{ fontSize: 11, fontFamily: 'var(--dmsans)', letterSpacing: 0, padding: '6px 12px' }}>
              {apiKey ? '🔑 Live AI' : '+ API Key'}
            </button>
          )}
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: isMobile ? '5px 10px' : '6px 12px', borderRadius: 20, background: 'rgba(255,255,255,0.06)', border: `1px solid rgba(255,255,255,0.1)` }}>
            <span className="wd-dot" style={{ width: 5, height: 5, background: '#10b981' }} />
            {!isMobile && <span style={{ fontFamily: 'var(--dmsans)', fontSize: 11, fontWeight: 500, color: 'rgba(232,232,232,0.7)', letterSpacing: '0.01em' }}>My Daemon</span>}
          </div>
        </div>
      </div>

      {/* Messages */}
      <div style={{ flex: 1, overflowY: 'auto', padding: isMobile ? '16px 14px 0' : '28px 28px 0' }}>
        <div style={{ maxWidth: 780, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: isMobile ? 18 : 24 }}>

          {messages.map((m, i) => (
            <div key={i} style={{ display: 'flex', flexDirection: 'column', alignItems: m.role === 'user' ? 'flex-end' : 'flex-start', gap: 10 }}>
              {m.role === 'user' ? (
                <div style={{
                  maxWidth: isMobile ? '84%' : '62%',
                  padding: isMobile ? '10px 14px' : '12px 18px',
                  background: '#4172f5',
                  borderRadius: '18px 18px 4px 18px',
                  fontFamily: 'var(--dmsans)',
                  fontSize: isMobile ? 14 : 15,
                  color: '#ffffff',
                  lineHeight: 1.5,
                  boxShadow: '0 2px 12px rgba(65,114,245,0.25)',
                }}>{m.text}</div>
              ) : (
                <div style={{ width: '100%', display: 'flex', flexDirection: 'column', gap: 12 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <DaemonMark size={16} glow={c.d} />
                    <span style={{ fontFamily: 'var(--mono)', fontSize: 10, color: c.text3, letterSpacing: '0.1em' }}>
                      {role.label.toUpperCase()} DAEMON
                    </span>
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                    {(m.blocks || []).map((block, bi) => renderBlock(block, bi))}
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

          <div ref={bottomRef} style={{ height: 4 }} />
        </div>
      </div>

      {/* Suggestion chips */}
      {suggestions.length > 0 && (
        <div style={{ padding: isMobile ? '12px 14px 4px' : '16px 28px 4px', maxWidth: 780 + 56, margin: '0 auto', width: '100%' }}>
          <div style={{
            display: 'flex',
            flexDirection: isMobile ? 'column' : (isLong ? 'column' : 'row'),
            flexWrap: isMobile ? undefined : (isLong ? undefined : 'wrap'),
            gap: 6,
          }}>
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
              placeholder={isMobile ? 'Ask your Daemon...' : 'Message your Daemon — Enter to send'}
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
          {!isMobile && (
            <p style={{ fontFamily: 'var(--mono)', fontSize: 9, color: c.text4, letterSpacing: '0.1em', textAlign: 'center', marginTop: 10 }}>
              WORKDAEMON.COM · INTERACTIVE DEMO · YOUR COMPANY, QUERYABLE.
            </p>
          )}
        </div>
      </div>

      {/* API key modal */}
      {showApiModal && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)', backdropFilter: 'blur(6px)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 200 }} onClick={() => setShowApiModal(false)}>
          <div style={{ background: c.surface, border: `1px solid ${c.cardBorder}`, borderRadius: 16, padding: '28px 32px', width: 420, boxShadow: '0 40px 80px rgba(0,0,0,0.4)' }} onClick={e => e.stopPropagation()}>
            <p className="wd-label-blue" style={{ marginBottom: 8 }}>ANTHROPIC API KEY</p>
            <h3 style={{ fontFamily: 'var(--dmsans)', fontSize: 20, fontWeight: 600, color: c.text, marginBottom: 6 }}>Enable live AI responses</h3>
            <p style={{ fontFamily: 'var(--dmsans)', fontSize: 13, color: c.text3, lineHeight: 1.6, marginBottom: 20 }}>Your key stays in the browser. WorkDaemon never stores or transmits it to our servers.</p>
            <input className="wd-input" type="password" placeholder="sk-ant-..." value={apiKey} onChange={e => setApiKey(e.target.value)} style={{ marginBottom: 14 }} autoFocus />
            <div style={{ display: 'flex', gap: 10 }}>
              <button className="wd-btn" style={{ flex: 1, height: 42, fontSize: 9 }} onClick={() => setShowApiModal(false)}>SAVE KEY</button>
              <button className="wd-btn-ghost" style={{ height: 42, padding: '0 18px', justifyContent: 'center' }} onClick={() => { setApiKey(''); setShowApiModal(false); }}>Clear</button>
            </div>
            <p style={{ fontFamily: 'var(--mono)', fontSize: 9, color: c.text4, letterSpacing: '0.08em', textAlign: 'center', marginTop: 14 }}>AES-256-GCM ENCRYPTED · NEVER LEAVES YOUR BROWSER</p>
          </div>
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// DAEMON PAGE (selector + chat)
// ─────────────────────────────────────────────────────────────────────────────

function DaemonPage({ onMenu, onChatChange }) {
  const c = useC();
  const { isMobile } = useViewport();
  const [selectedIndustry, setSelectedIndustry] = useState(INDUSTRIES[0]);
  const [selectedRole, setSelectedRole] = useState(INDUSTRIES[0].roles[0]);
  const [started, setStarted] = useState(false);

  useEffect(() => { onChatChange?.(started); }, [started]);

  if (started) {
    return (
      <div style={{ height: '100%', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        <ChatView industry={selectedIndustry} role={selectedRole} onBack={() => setStarted(false)} onMenu={onMenu} />
      </div>
    );
  }

  return (
    <div style={{ padding: isMobile ? '20px 16px' : '32px', overflowY: 'auto', height: '100%', background: c.bg, transition: 'background 0.2s' }}>
      <div style={{ maxWidth: 640, margin: '0 auto' }}>
        <p className="wd-label-blue" style={{ marginBottom: 10 }}>MY DAEMON</p>
        <h1 style={{ fontFamily: 'var(--dmsans)', fontSize: isMobile ? 22 : 28, fontWeight: 600, color: c.text, letterSpacing: '-0.02em', marginBottom: 6 }}>Choose your context.</h1>
        <p style={{ fontFamily: 'var(--dmsans)', fontSize: isMobile ? 14 : 15, color: c.text3, marginBottom: isMobile ? 24 : 32, lineHeight: 1.6 }}>
          Your Daemon loads full context for your role and company. Pick one to begin.
        </p>

        {/* Industry tabs */}
        <div style={{ display: 'flex', gap: 6, marginBottom: 16, flexWrap: 'wrap' }}>
          {INDUSTRIES.map(ind => (
            <button key={ind.id} type="button" onClick={() => { setSelectedIndustry(ind); setSelectedRole(ind.roles[0]); }}
              style={{ padding: isMobile ? '7px 14px' : '8px 18px', background: selectedIndustry.id === ind.id ? (c.d ? 'rgba(255,255,255,0.09)' : 'rgba(0,0,0,0.06)') : c.subtle, border: `1px solid ${selectedIndustry.id === ind.id ? c.rowBorder : c.subtleBorder}`, borderRadius: 8, fontFamily: 'var(--dmsans)', fontSize: isMobile ? 12 : 13, color: selectedIndustry.id === ind.id ? c.text : c.text3, cursor: 'pointer', fontWeight: selectedIndustry.id === ind.id ? 500 : 400, transition: 'all 0.15s' }}
            >{ind.name}</button>
          ))}
        </div>

        {/* Company info */}
        <div style={{ padding: '14px 18px', background: c.stat, border: `1px solid ${c.statBorder}`, borderRadius: 10, marginBottom: 16 }}>
          <div style={{ fontFamily: 'var(--dmsans)', fontSize: 14, fontWeight: 600, color: c.text, marginBottom: 3 }}>{selectedIndustry.company}</div>
          <div style={{ fontFamily: 'var(--dmsans)', fontSize: 13, color: c.text3 }}>{selectedIndustry.description}</div>
          <div style={{ display: 'flex', gap: 6, marginTop: 10, flexWrap: 'wrap' }}>
            {selectedIndustry.tools.map(t => (
              <span key={t} style={{ padding: '2px 9px', borderRadius: 5, background: c.subtle, border: `1px solid ${c.subtleBorder}`, fontFamily: 'var(--mono)', fontSize: 10, color: c.text4, letterSpacing: '0.06em' }}>{t}</span>
            ))}
          </div>
        </div>

        {/* Role grid */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 24 }}>
          {selectedIndustry.roles.map(r => (
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
// PLACEHOLDER
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

// ─────────────────────────────────────────────────────────────────────────────
// COMPANY BRAIN
// ─────────────────────────────────────────────────────────────────────────────

function BrainPage() {
  const c = useC();
  const { isMobile } = useViewport();
  const [activeTab, setActiveTab] = useState('overview');
  const tabs = ['OVERVIEW', 'INTEGRATIONS', 'KNOWLEDGE GRAPH', 'USERS', 'SECURITY'];

  const integrations = [
    { name: 'Notion', status: 'connected', docs: '847',    icon: 'N', lastSync: '4m ago' },
    { name: 'Slack',  status: 'connected', docs: '12,441', icon: 'S', lastSync: '12s ago' },
    { name: 'GitHub', status: 'connected', docs: '2,189',  icon: '⌥', lastSync: '1m ago' },
    { name: 'Gmail',  status: 'connected', docs: '4,320',  icon: 'G', lastSync: '8m ago' },
    { name: 'Linear', status: 'pending',   docs: '—',      icon: 'L', lastSync: '—' },
    { name: 'Figma',  status: 'pending',   docs: '—',      icon: 'F', lastSync: '—' },
  ];

  return (
    <div style={{ padding: isMobile ? '20px 16px' : '28px 32px', overflowY: 'auto', height: '100%', background: c.bg, transition: 'background 0.2s' }}>
      <div style={{ maxWidth: 820 }}>
        <p className="wd-label-blue" style={{ marginBottom: 8 }}>COMPANY BRAIN</p>
        <h1 style={{ fontFamily: 'var(--dmsans)', fontSize: isMobile ? 20 : 24, fontWeight: 600, color: c.text, letterSpacing: '-0.02em', marginBottom: 6 }}>Knowledge Infrastructure</h1>
        <p style={{ fontFamily: 'var(--dmsans)', fontSize: 13, color: c.text3, marginBottom: 20 }}>Admin-only view · All data encrypted · AES-256-GCM</p>

        <div style={{ display: 'grid', gridTemplateColumns: isMobile ? 'repeat(2, 1fr)' : 'repeat(4, 1fr)', gap: 10, marginBottom: 24 }}>
          {[{ label: 'Documents', value: '19.8K', unit: '+142 today' }, { label: 'Integrations', value: '4 / 9', unit: 'connected' }, { label: 'Graph Nodes', value: '284K', unit: 'growing' }, { label: 'Query P99', value: '1.2s', unit: 'fast' }].map((s, i) => (
            <div key={i} style={{ padding: '14px 16px', background: c.stat, border: `1px solid ${c.statBorder}`, borderRadius: 10, boxShadow: c.statShadow }}>
              <div style={{ fontFamily: 'var(--mono)', fontSize: 9, color: c.text3, letterSpacing: '0.1em', marginBottom: 6 }}>{s.label.toUpperCase()}</div>
              <div style={{ fontFamily: 'var(--orbitron)', fontSize: isMobile ? 16 : 18, fontWeight: 700, color: c.text, marginBottom: 3 }}>{s.value}</div>
              <div style={{ fontFamily: 'var(--mono)', fontSize: 9, color: c.text3 }}>{s.unit}</div>
            </div>
          ))}
        </div>

        {/* Tabs */}
        <div style={{ display: 'flex', gap: 4, marginBottom: 24, borderBottom: `1px solid ${c.cardBorder}`, overflowX: 'auto', WebkitOverflowScrolling: 'touch' }}>
          {tabs.map(t => (
            <button key={t} type="button" onClick={() => setActiveTab(t.toLowerCase().replace(' ', '_'))}
              style={{ padding: '8px 12px', background: 'none', border: 'none', borderBottom: `2px solid ${activeTab === t.toLowerCase().replace(' ', '_') ? '#4172f5' : 'transparent'}`, fontFamily: 'var(--mono)', fontSize: 10, letterSpacing: '0.08em', color: activeTab === t.toLowerCase().replace(' ', '_') ? '#4172f5' : c.text3, cursor: 'pointer', marginBottom: -1, transition: 'all 0.15s', whiteSpace: 'nowrap', flexShrink: 0 }}
            >{t}</button>
          ))}
        </div>

        {activeTab === 'overview' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <BlockChartLine block={{ title: 'Documents Indexed — Last 14 Days', filled: true, keys: ['docs'], data: Array.from({ length: 14 }, (_, i) => ({ name: `D${i + 1}`, docs: 14000 + i * 400 + Math.floor(Math.sin(i) * 800) })) }} />
            <BlockAlert block={{ level: 'success', title: 'Brain Status', content: '4 integrations connected · 19.8K documents indexed · Knowledge graph building in real-time.' }} />
          </div>
        )}

        {activeTab === 'integrations' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {integrations.map(intg => (
              <div key={intg.name} style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '14px 18px', background: intg.status === 'connected' ? (c.d ? 'rgba(16,185,129,0.04)' : 'rgba(16,185,129,0.04)') : c.subtle, border: `1px solid ${intg.status === 'connected' ? 'rgba(16,185,129,0.15)' : c.subtleBorder}`, borderRadius: 10 }}>
                <div style={{ width: 32, height: 32, borderRadius: 8, background: c.subtle, border: `1px solid ${c.subtleBorder}`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'var(--orbitron)', fontSize: 11, fontWeight: 700, color: c.text3, flexShrink: 0 }}>{intg.icon}</div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontFamily: 'var(--dmsans)', fontSize: 13, fontWeight: 500, color: c.text, marginBottom: 2 }}>{intg.name}</div>
                  <div style={{ fontFamily: 'var(--mono)', fontSize: 10, color: c.text4, letterSpacing: '0.06em' }}>{intg.status === 'connected' ? `${intg.docs} docs indexed · synced ${intg.lastSync}` : 'Not connected'}</div>
                </div>
                <span style={{ padding: '4px 10px', borderRadius: 6, fontFamily: 'var(--mono)', fontSize: 9, letterSpacing: '0.08em', background: intg.status === 'connected' ? (c.d ? 'rgba(16,185,129,0.1)' : 'rgba(16,185,129,0.09)') : c.subtle, border: `1px solid ${intg.status === 'connected' ? 'rgba(16,185,129,0.25)' : c.subtleBorder}`, color: intg.status === 'connected' ? '#10b981' : '#4172f5', cursor: 'pointer' }}>
                  {intg.status === 'connected' ? 'CONNECTED' : 'CONNECT'}
                </span>
              </div>
            ))}
          </div>
        )}

        {(activeTab === 'users' || activeTab === 'knowledge_graph' || activeTab === 'security') && (
          <BlockAlert block={{ level: 'info', content: `${activeTab.replace('_', ' ')} panel — coming in next release.` }} />
        )}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// TASKS
// ─────────────────────────────────────────────────────────────────────────────

const SPRINT_TASKS = {
  todo: [
    { id: 'BUG-119', title: 'P0: Session timeout — 23% login drop-off',    priority: 'P0', initials: 'JL', tag: '#Jira',   blocked: true },
    { id: 'AUTH-047',title: 'Fix OAuth edge case in auth flow',              priority: 'P1', initials: 'JL', tag: '#Jira',   blocked: true },
    { id: 'FE-22',   title: 'Responsive layout for mobile dashboard',       priority: 'P2', initials: 'PS', tag: '#Jira' },
  ],
  inProgress: [
    { id: 'FE-20',  title: 'New onboarding modal — steps 3 & 4',           priority: 'P1', initials: 'SO', tag: '#Jira' },
    { id: 'BE-88',  title: 'API rate limiting for /query endpoint',         priority: 'P1', initials: 'JO', tag: '#GitHub' },
  ],
  review: [
    { id: 'PR-204', title: 'Add Slack notification handler',                priority: 'P2', initials: 'MW', tag: '#GitHub', stale: true },
    { id: 'FE-18',  title: 'Sidebar dark mode polish',                      priority: 'P2', initials: 'PS', tag: '#GitHub' },
  ],
  done: [
    { id: 'BE-81',   title: 'DB indexing for semantic search',              priority: 'P1', initials: 'JO', tag: '#GitHub' },
    { id: 'FE-15',   title: 'Company Brain admin view',                     priority: 'P2', initials: 'SO', tag: '#Jira' },
    { id: 'AUTH-41', title: 'Google SSO integration',                       priority: 'P1', initials: 'JL', tag: '#Jira' },
  ],
};

const PRIORITY_STYLES = {
  P0: { bg: 'rgba(239,68,68,0.11)',   border: 'rgba(239,68,68,0.3)',   color: '#ef4444' },
  P1: { bg: 'rgba(245,158,11,0.1)',   border: 'rgba(245,158,11,0.28)', color: '#f59e0b' },
  P2: { bg: 'rgba(65,114,245,0.08)', border: 'rgba(65,114,245,0.2)',  color: '#4172f5' },
};

const INITIALS_COLORS = { JL: '#4172f5', SO: '#7c3aed', PS: '#0ea5e9', JO: '#059669', MW: '#dc2626', TN: '#d97706' };
const INITIALS_NAMES  = { JL: 'James',   SO: 'Sam',    PS: 'Priya',   JO: 'Jordan',  MW: 'Marcus',  TN: 'Tara' };

function TaskCard({ task }) {
  const c = useC();
  const ps = PRIORITY_STYLES[task.priority];
  return (
    <div style={{
      padding: '12px 14px',
      background: task.blocked ? (c.d ? 'rgba(239,68,68,0.04)' : 'rgba(239,68,68,0.03)') : c.subtle,
      border: `1px solid ${task.blocked ? 'rgba(239,68,68,0.18)' : task.stale ? 'rgba(245,158,11,0.18)' : c.subtleBorder}`,
      borderRadius: 9,
    }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8, marginBottom: 9 }}>
        <span style={{ fontSize: 9, padding: '2px 7px', borderRadius: 5, background: ps.bg, border: `1px solid ${ps.border}`, color: ps.color, fontFamily: 'var(--mono)', letterSpacing: '0.06em', flexShrink: 0, marginTop: 2 }}>{task.priority}</span>
        <span style={{ fontFamily: 'var(--dmsans)', fontSize: 13, color: c.text2, lineHeight: 1.45 }}>{task.title}</span>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
          <span style={{ fontFamily: 'var(--mono)', fontSize: 9, color: c.text4, letterSpacing: '0.05em' }}>{task.tag} · {task.id}</span>
          {(task.blocked || task.stale) && (
            <span style={{ fontFamily: 'var(--mono)', fontSize: 9, color: task.blocked ? '#ef4444' : '#f59e0b', letterSpacing: '0.06em' }}>
              {task.blocked ? '⚠ BLOCKED' : '⏱ STALE'}
            </span>
          )}
        </div>
        <div title={INITIALS_NAMES[task.initials]} style={{ width: 22, height: 22, borderRadius: '50%', background: INITIALS_COLORS[task.initials] || '#4172f5', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'var(--orbitron)', fontSize: 7, fontWeight: 700, color: '#fff', flexShrink: 0 }}>{task.initials}</div>
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
        {tasks.map(t => <TaskCard key={t.id} task={t} />)}
      </div>
    </div>
  );
}

function TasksPage() {
  const c = useC();
  const { isMobile } = useViewport();
  const total = Object.values(SPRINT_TASKS).reduce((s, a) => s + a.length, 0);
  const done  = SPRINT_TASKS.done.length;
  const pct   = Math.round((done / total) * 100);

  return (
    <div style={{ padding: isMobile ? '20px 16px' : '28px 32px', overflowY: 'auto', height: '100%', background: c.bg, transition: 'background 0.2s' }}>
      <div style={{ maxWidth: 1020, margin: '0 auto' }}>
        <div style={{ display: 'flex', alignItems: isMobile ? 'flex-start' : 'flex-end', flexDirection: isMobile ? 'column' : 'row', justifyContent: 'space-between', marginBottom: 20, gap: isMobile ? 12 : 0 }}>
          <div>
            <p className="wd-label-blue" style={{ marginBottom: 6 }}>SPRINT 23 · DUE MAY 31</p>
            <h1 style={{ fontFamily: 'var(--dmsans)', fontSize: isMobile ? 20 : 22, fontWeight: 600, color: c.text, letterSpacing: '-0.02em' }}>Task Board</h1>
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <div style={{ padding: '7px 14px', background: c.stat, border: `1px solid ${c.statBorder}`, borderRadius: 9 }}>
              <span style={{ fontFamily: 'var(--mono)', fontSize: 10, color: '#f59e0b', letterSpacing: '0.08em' }}>{done}/{total} DONE · {pct}%</span>
            </div>
            <div style={{ padding: '7px 14px', background: 'rgba(239,68,68,0.07)', border: '1px solid rgba(239,68,68,0.18)', borderRadius: 9 }}>
              <span style={{ fontFamily: 'var(--mono)', fontSize: 10, color: '#ef4444', letterSpacing: '0.08em' }}>2 BLOCKED</span>
            </div>
          </div>
        </div>

        {/* Sprint progress */}
        <div style={{ height: 3, background: c.d ? 'rgba(255,255,255,0.06)' : 'rgba(15,20,53,0.08)', borderRadius: 2, overflow: 'hidden', marginBottom: 28 }}>
          <div style={{ height: '100%', width: `${pct}%`, background: '#4172f5', borderRadius: 2, transition: 'width 0.6s ease' }} />
        </div>

        {/* Kanban — horizontal scroll on mobile */}
        <div style={{ display: 'flex', gap: 16, overflowX: isMobile ? 'auto' : 'visible', paddingBottom: isMobile ? 16 : 0 }}>
          {[
            { title: 'TO DO',       tasks: SPRINT_TASKS.todo },
            { title: 'IN PROGRESS', tasks: SPRINT_TASKS.inProgress },
            { title: 'IN REVIEW',   tasks: SPRINT_TASKS.review },
            { title: 'DONE',        tasks: SPRINT_TASKS.done },
          ].map(col => (
            <div key={col.title} style={{ flex: isMobile ? '0 0 260px' : 1, minWidth: isMobile ? 260 : 0 }}>
              <KanbanColumn title={col.title} tasks={col.tasks} />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// INBOX
// ─────────────────────────────────────────────────────────────────────────────

const INBOX_ITEMS = [
  { id: 1, source: 'Daemon', icon: '◈', title: 'BUG-119 escalation needed',             body: 'P0 ticket has had no update in 3 days. Investor demo is 9 days out.',               time: '2m ago',   unread: true,  level: 'danger'  },
  { id: 2, source: 'Slack',  icon: 'S', title: 'Sam mentioned you in #product',          body: 'Hey @alex, can you review the Sprint 23 scope before EOD?',                        time: '14m ago',  unread: true,  level: null      },
  { id: 3, source: 'Jira',   icon: 'J', title: 'AUTH-047 status updated by James',       body: 'James: "Waiting on design specs from Zoe before I can proceed on this."',          time: '1h ago',   unread: true,  level: 'warning' },
  { id: 4, source: 'GitHub', icon: '⌥', title: 'PR#204 still awaiting review',           body: '4 days since Marcus opened this PR. Downstream QA pipeline is blocked.',           time: '4h ago',   unread: true,  level: 'warning' },
  { id: 5, source: 'Gmail',  icon: 'G', title: 'TechVentures: May 30 follow-up',        body: 'Hi Alex, thanks for the call yesterday. Looking forward to the product demo...',    time: 'Yesterday',unread: false, level: null      },
  { id: 6, source: 'Slack',  icon: 'S', title: 'Jordan mentioned you in #engineering',  body: 'DB CPU spiked to 84% last night — should we increase instance size to r6i.xlarge?',time: 'Yesterday',unread: false, level: null      },
  { id: 7, source: 'Jira',   icon: 'J', title: 'Sprint 23 created — 8 tickets',         body: 'Sprint 23 created. Goal: complete auth overhaul + 3 features. Due May 31.',        time: '2 days ago',unread: false, level: null     },
];

const SOURCE_BG = { Daemon: '#4172f5', Slack: '#4a154b', Jira: '#0052cc', GitHub: '#24292e', Gmail: '#ea4335' };

function InboxPage() {
  const c = useC();
  const { isMobile } = useViewport();
  const [filter, setFilter] = useState('all');

  const FILTERS = [
    { key: 'all',      label: 'ALL',      fn: () => true },
    { key: 'mentions', label: 'MENTIONS', fn: i => i.source === 'Slack' },
    { key: 'alerts',   label: 'ALERTS',   fn: i => !!i.level },
    { key: 'updates',  label: 'UPDATES',  fn: i => ['Jira', 'GitHub'].includes(i.source) },
  ];

  const unread = INBOX_ITEMS.filter(i => i.unread).length;
  const visible = INBOX_ITEMS.filter(FILTERS.find(f => f.key === filter)?.fn ?? (() => true));

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

        {/* Filter tabs */}
        <div style={{ display: 'flex', gap: 2, marginBottom: 20, borderBottom: `1px solid ${c.cardBorder}` }}>
          {FILTERS.map(f => (
            <button key={f.key} type="button" onClick={() => setFilter(f.key)}
              style={{ padding: '8px 14px', background: 'none', border: 'none', borderBottom: `2px solid ${filter === f.key ? '#4172f5' : 'transparent'}`, fontFamily: 'var(--mono)', fontSize: 10, letterSpacing: '0.1em', color: filter === f.key ? '#4172f5' : c.text3, cursor: 'pointer', marginBottom: -1, transition: 'all 0.15s' }}
            >{f.label}</button>
          ))}
        </div>

        {/* Items */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
          {visible.map(item => {
            const lc = LEVEL_COLOR[item.level];
            return (
              <div key={item.id} style={{
                padding: '13px 15px',
                background: item.unread ? (lc ? c.d ? `rgba(${item.level === 'danger' ? '239,68,68' : '245,158,11'},0.05)` : `rgba(${item.level === 'danger' ? '239,68,68' : '245,158,11'},0.03)` : c.row) : c.subtle,
                border: `1px solid ${item.unread ? (lc ? `rgba(${item.level === 'danger' ? '239,68,68' : '245,158,11'},0.2)` : c.rowBorder) : c.subtleBorder}`,
                borderLeft: lc && item.unread ? `3px solid ${lc}` : undefined,
                borderRadius: lc && item.unread ? '0 9px 9px 0' : 9,
                display: 'flex', gap: 12, cursor: 'pointer', transition: 'background 0.15s',
              }}>
                <div style={{ width: 30, height: 30, borderRadius: 8, background: SOURCE_BG[item.source] || c.subtle, display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'var(--orbitron)', fontSize: 10, fontWeight: 700, color: '#fff', flexShrink: 0 }}>{item.icon}</div>
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
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// OVERVIEW
// ─────────────────────────────────────────────────────────────────────────────

const OVERVIEW_TEAM = [
  { name: 'Jordan Lee',   role: 'Engineering Lead', metric: '8 PRs merged this week',  status: 'online', initials: 'JO' },
  { name: 'Sam Okonkwo', role: 'Product Manager',  metric: '3 specs shipped',          status: 'online', initials: 'SO' },
  { name: 'Priya Singh',  role: 'Head of Design',   metric: '2 flows in review',        status: 'away',   initials: 'PS' },
  { name: 'Marcus Webb',  role: 'Head of Sales',    metric: '$142K pipeline',           status: 'online', initials: 'MW' },
  { name: 'Tara Nkosi',   role: 'Customer Success', metric: 'NPS 67',                  status: 'online', initials: 'TN' },
];

const OVERVIEW_ACTIVITY = [
  { time: '2m ago',    text: 'BUG-119 escalated — P0, no update from James in 3 days', icon: '⚡', source: 'Daemon'  },
  { time: '18m ago',   text: 'PR#204 opened by Marcus — +480 −22 lines',                icon: '⌥', source: 'GitHub'  },
  { time: '1h ago',    text: 'Brain synced 142 new pages from Notion',                  icon: '◈', source: 'Brain'   },
  { time: '3h ago',    text: 'Sam shipped design specs for FE-20',                      icon: 'N', source: 'Notion'  },
  { time: 'Yesterday', text: 'Sprint 23 kicked off · 8 tickets · Due May 31',           icon: 'J', source: 'Jira'    },
  { time: 'Yesterday', text: 'Investor call with TechVentures — follow-up in Gmail',    icon: 'G', source: 'Gmail'   },
];

function OverviewPage() {
  const c = useC();
  const { isMobile } = useViewport();
  const STATS = [
    { label: 'Team',     value: '12',     unit: '2 open reqs',  accent: 'warn' },
    { label: 'MRR',      value: '$48.2K', unit: '+12% MoM',     accent: 'ok'   },
    { label: 'Sprint 23',value: '3/8',    unit: 'tickets done', accent: 'warn' },
    { label: 'Brain',    value: '19.8K',  unit: 'docs indexed', accent: 'ok'   },
  ];

  return (
    <div style={{ padding: isMobile ? '20px 16px' : '28px 32px', overflowY: 'auto', height: '100%', background: c.bg, transition: 'background 0.2s' }}>
      <div style={{ maxWidth: 860, margin: '0 auto' }}>
        <p className="wd-label-blue" style={{ marginBottom: 8 }}>ADMIN</p>
        <h1 style={{ fontFamily: 'var(--dmsans)', fontSize: isMobile ? 20 : 22, fontWeight: 600, color: c.text, letterSpacing: '-0.02em', marginBottom: 24 }}>Company Overview</h1>

        {/* Stats */}
        <div style={{ display: 'grid', gridTemplateColumns: isMobile ? 'repeat(2, 1fr)' : 'repeat(4, 1fr)', gap: 10, marginBottom: 32 }}>
          {STATS.map((s, i) => (
            <div key={i} style={{ padding: '14px 16px', background: c.stat, border: `1px solid ${c.statBorder}`, borderRadius: 10, boxShadow: c.statShadow }}>
              <div style={{ fontFamily: 'var(--mono)', fontSize: 10, color: c.text3, letterSpacing: '0.1em', marginBottom: 6 }}>{s.label.toUpperCase()}</div>
              <div style={{ fontFamily: 'var(--orbitron)', fontSize: 20, fontWeight: 700, color: ACCENT_COLORS[s.accent] || c.text, marginBottom: 3 }}>{s.value}</div>
              <div style={{ fontFamily: 'var(--dmsans)', fontSize: 12, color: c.text3 }}>{s.unit}</div>
            </div>
          ))}
        </div>

        {/* Two columns */}
        <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr', gap: 24 }}>

          {/* Team */}
          <div>
            <p className="wd-label" style={{ marginBottom: 14 }}>TEAM — 12 FTE</p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
              {OVERVIEW_TEAM.map((m, i) => (
                <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px', background: c.row, border: `1px solid ${c.rowBorder}`, borderRadius: 9 }}>
                  <div style={{ width: 28, height: 28, borderRadius: '50%', background: INITIALS_COLORS[m.initials] || '#4172f5', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'var(--orbitron)', fontSize: 8, fontWeight: 700, color: '#fff', flexShrink: 0 }}>{m.initials}</div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontFamily: 'var(--dmsans)', fontSize: 13, fontWeight: 500, color: c.text }}>{m.name}</div>
                    <div style={{ fontFamily: 'var(--dmsans)', fontSize: 11, color: c.text3, marginTop: 1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{m.metric}</div>
                  </div>
                  <span style={{ width: 7, height: 7, borderRadius: '50%', background: m.status === 'online' ? '#10b981' : '#f59e0b', flexShrink: 0 }} />
                </div>
              ))}
            </div>
          </div>

          {/* Activity */}
          <div>
            <p className="wd-label" style={{ marginBottom: 14 }}>RECENT ACTIVITY</p>
            <div style={{ display: 'flex', flexDirection: 'column' }}>
              {OVERVIEW_ACTIVITY.map((a, i) => (
                <div key={i} style={{ display: 'flex', gap: 12, paddingBottom: i < OVERVIEW_ACTIVITY.length - 1 ? 14 : 0 }}>
                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', flexShrink: 0 }}>
                    <div style={{ width: 24, height: 24, borderRadius: 7, background: c.subtle, border: `1px solid ${c.subtleBorder}`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'var(--mono)', fontSize: 10, color: c.text3 }}>{a.icon}</div>
                    {i < OVERVIEW_ACTIVITY.length - 1 && <div style={{ width: 1, flex: 1, background: c.subtleBorder, marginTop: 4 }} />}
                  </div>
                  <div style={{ paddingBottom: 4 }}>
                    <div style={{ fontFamily: 'var(--dmsans)', fontSize: 13, color: c.text2, lineHeight: 1.45 }}>{a.text}</div>
                    <div style={{ fontFamily: 'var(--mono)', fontSize: 9, color: c.text4, letterSpacing: '0.06em', marginTop: 3 }}>{a.source} · {a.time}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// DASHBOARD SHELL
// ─────────────────────────────────────────────────────────────────────────────

function MobileTopBar({ onOpen, isLight }) {
  const c = useC();
  const { toggle } = useTheme();
  const iconColor = isLight ? 'rgba(15,20,53,0.5)' : 'rgba(255,255,255,0.45)';
  return (
    <div style={{
      height: 52,
      display: 'flex',
      alignItems: 'center',
      padding: '0 14px',
      gap: 10,
      background: c.headerBg,
      borderBottom: `1px solid ${c.headerBorder}`,
      flexShrink: 0,
    }}>
      <button
        type="button"
        onClick={onOpen}
        style={{
          width: 36, height: 36, borderRadius: 8,
          background: 'none', border: 'none',
          display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 4,
          cursor: 'pointer', padding: 0, flexShrink: 0,
          color: iconColor,
        }}
      >
        <span style={{ width: 18, height: 1.5, background: 'currentColor', borderRadius: 1, display: 'block' }} />
        <span style={{ width: 18, height: 1.5, background: 'currentColor', borderRadius: 1, display: 'block' }} />
        <span style={{ width: 12, height: 1.5, background: 'currentColor', borderRadius: 1, display: 'block', alignSelf: 'flex-start' }} />
      </button>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flex: 1 }}>
        <DaemonMark size={18} glow={!isLight} />
        <span style={{ fontFamily: 'var(--orbitron)', fontSize: 10, fontWeight: 700, color: '#4172f5', letterSpacing: '0.14em' }}>WORKDAEMON</span>
      </div>
      <button
        type="button"
        onClick={toggle}
        style={{
          width: 32, height: 32, borderRadius: 8,
          background: isLight ? 'rgba(0,0,0,0.05)' : 'rgba(255,255,255,0.05)',
          border: `1px solid ${isLight ? 'rgba(0,0,0,0.09)' : 'rgba(255,255,255,0.08)'}`,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          cursor: 'pointer', fontSize: 13, flexShrink: 0,
        }}
      >
        {isLight ? '🌙' : '☀️'}
      </button>
    </div>
  );
}

export default function Dashboard() {
  const { isMobile } = useViewport();
  const { theme } = useTheme();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [inChat, setInChat] = useState(false);
  const isLight = theme === 'light';
  const isAdmin = true; // sourced from auth session in production
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
          <Route path="settings"     element={<PlaceholderPage label="SETTINGS"     title="Account Settings" />} />
        </Routes>
      </div>
    </div>
  );
}
