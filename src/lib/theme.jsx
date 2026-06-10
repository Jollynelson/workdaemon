// Extracted from the former 5,000-line src/pages/Dashboard.jsx (2026-06-10 split).
import { useTheme } from '../context/ThemeContext.jsx';

// ─────────────────────────────────────────────────────────────────────────────
// THEME COLORS
// ─────────────────────────────────────────────────────────────────────────────

export function useC() {
  const { theme } = useTheme();
  const d = theme === 'dark';
  // Dark = WorkDaemon "Void": deep blue-black ladder with a cold undertone
  // (IA spec Void #07090e + Electric Blue #3b6ef7). Mirrors globals.css :root.
  return {
    d,
    text:         d ? '#e9edf8'                  : '#1a1a1a',
    text2:        d ? '#97a1bd'                  : '#5d5b54',
    text3:        d ? '#56607e'                  : '#a4a097',
    text4:        d ? '#2c3349'                  : '#ccc9c2',
    bg:           d ? '#07090e'                  : '#ffffff',
    surface:      d ? '#0d1018'                  : '#f6f5f4',
    card:         d ? '#0d1018'                  : '#ffffff',
    cardBorder:   d ? '#1a1f2e'                  : 'rgba(0,0,0,0.07)',
    cardShadow:   d ? 'none'                     : '0 1px 3px rgba(15,15,15,0.06)',
    stat:         d ? '#111522'                  : '#f6f5f4',
    statBorder:   d ? '#1a1f2e'                  : 'rgba(0,0,0,0.07)',
    statShadow:   d ? 'none'                     : '0 1px 3px rgba(15,15,15,0.05)',
    row:          d ? 'rgba(255,255,255,0.02)'   : 'rgba(0,0,0,0.02)',
    rowBorder:    d ? '#1a1f2e'                  : 'rgba(0,0,0,0.06)',
    subtle:       d ? '#0d1018'                  : 'rgba(0,0,0,0.02)',
    subtleBorder: d ? '#1a1f2e'                  : '#e5e3df',
    headerBg:     d ? '#07090e'                  : '#ffffff',
    headerBorder: d ? '#1a1f2e'                  : '#e5e3df',
    inputBg:      d ? '#111522'                  : '#ffffff',
    inputBorder:  d ? '#252c40'                  : '#c8c4be',
    thinkingBg:   d ? 'rgba(255,255,255,0.02)'   : 'rgba(0,0,0,0.02)',
    thinkingBorder: d ? '#1a1f2e'                : '#e5e3df',
    // New tokens
    navy:         '#0c1428',
    navyMid:      d ? '#111d3a'                  : '#0c1428',
    surface2:     d ? '#111522'                  : '#efeeec',
    surface3:     d ? '#161b2c'                  : '#e8e6e3',
    hairline:     d ? '#1a1f2e'                  : '#e5e3df',
    hairlineStrong: d ? '#252c40'                : '#c8c4be',
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// STYLE CONSTANTS
// ─────────────────────────────────────────────────────────────────────────────

export const CHART_COLORS  = ['#3b6ef7', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6'];
export const ACCENT_COLORS = { ok: '#10b981', warn: '#f59e0b', danger: '#ef4444', blue: '#3b6ef7' };

export const PRIORITY_STYLES = {
  P0: { bg: 'rgba(239,68,68,0.11)',   border: 'rgba(239,68,68,0.3)',   color: '#ef4444' },
  P1: { bg: 'rgba(245,158,11,0.1)',   border: 'rgba(245,158,11,0.28)', color: '#f59e0b' },
  P2: { bg: 'rgba(59,110,247,0.08)',  border: 'rgba(59,110,247,0.2)',  color: '#3b6ef7' },
};

export const SOURCE_COLORS = {
  Slack: '#4a154b', Jira: '#0052cc', GitHub: '#24292e',
  Gmail: '#ea4335', Notion: '#191919', Linear: '#5e6ad2',
  Figma: '#f24e1e', Default: '#3b6ef7',
};


export const mkPrimaryBtn = (color, enabled) => ({
  padding: '9px 20px', borderRadius: 7, cursor: enabled ? 'pointer' : 'not-allowed',
  background: enabled ? color : 'rgba(255,255,255,0.05)', border: 'none',
  fontFamily: 'var(--dmsans)', fontSize: 13, fontWeight: 600,
  color: enabled ? '#fff' : 'rgba(255,255,255,0.3)', transition: 'opacity 0.15s',
});
export const mkGhostBtn = (c, extra = {}) => ({
  padding: '9px 16px', borderRadius: 7, cursor: 'pointer',
  background: 'none', border: `1px solid ${c.subtleBorder}`,
  fontFamily: 'var(--dmsans)', fontSize: 13, color: c.text3, ...extra,
});

