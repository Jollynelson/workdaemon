// Extracted from the former 5,000-line src/pages/Dashboard.jsx (2026-06-10 split).
import { useTheme } from '../context/ThemeContext.jsx';

// ─────────────────────────────────────────────────────────────────────────────
// THEME COLORS
// ─────────────────────────────────────────────────────────────────────────────

export function useC() {
  const { theme } = useTheme();
  const d = theme === 'dark';
  return {
    d,
    text:         d ? '#eeeef2'                  : '#1a1a1a',
    text2:        d ? '#9898a8'                  : '#5d5b54',
    text3:        d ? '#585868'                  : '#a4a097',
    text4:        d ? '#2e2e3e'                  : '#ccc9c2',
    bg:           d ? '#0d0d10'                  : '#ffffff',
    surface:      d ? '#131318'                  : '#f6f5f4',
    card:         d ? '#131318'                  : '#ffffff',
    cardBorder:   d ? '#1e1e28'                  : 'rgba(0,0,0,0.07)',
    cardShadow:   d ? 'none'                     : '0 1px 3px rgba(15,15,15,0.06)',
    stat:         d ? '#17171d'                  : '#f6f5f4',
    statBorder:   d ? '#1e1e28'                  : 'rgba(0,0,0,0.07)',
    statShadow:   d ? 'none'                     : '0 1px 3px rgba(15,15,15,0.05)',
    row:          d ? 'rgba(255,255,255,0.02)'   : 'rgba(0,0,0,0.02)',
    rowBorder:    d ? '#1e1e28'                  : 'rgba(0,0,0,0.06)',
    subtle:       d ? '#131318'                  : 'rgba(0,0,0,0.02)',
    subtleBorder: d ? '#1e1e28'                  : '#e5e3df',
    headerBg:     d ? '#0d0d10'                  : '#ffffff',
    headerBorder: d ? '#1e1e28'                  : '#e5e3df',
    inputBg:      d ? '#17171d'                  : '#ffffff',
    inputBorder:  d ? '#262630'                  : '#c8c4be',
    thinkingBg:   d ? 'rgba(255,255,255,0.02)'   : 'rgba(0,0,0,0.02)',
    thinkingBorder: d ? '#1e1e28'                : '#e5e3df',
    // New tokens
    navy:         '#0c1428',
    navyMid:      d ? '#111d3a'                  : '#0c1428',
    surface2:     d ? '#17171d'                  : '#efeeec',
    surface3:     d ? '#1c1c24'                  : '#e8e6e3',
    hairline:     d ? '#1e1e28'                  : '#e5e3df',
    hairlineStrong: d ? '#262630'                : '#c8c4be',
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// STYLE CONSTANTS
// ─────────────────────────────────────────────────────────────────────────────

export const CHART_COLORS  = ['#4172f5', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6'];
export const ACCENT_COLORS = { ok: '#10b981', warn: '#f59e0b', danger: '#ef4444', blue: '#4172f5' };

export const PRIORITY_STYLES = {
  P0: { bg: 'rgba(239,68,68,0.11)',   border: 'rgba(239,68,68,0.3)',   color: '#ef4444' },
  P1: { bg: 'rgba(245,158,11,0.1)',   border: 'rgba(245,158,11,0.28)', color: '#f59e0b' },
  P2: { bg: 'rgba(65,114,245,0.08)',  border: 'rgba(65,114,245,0.2)',  color: '#4172f5' },
};

export const SOURCE_COLORS = {
  Slack: '#4a154b', Jira: '#0052cc', GitHub: '#24292e',
  Gmail: '#ea4335', Notion: '#191919', Linear: '#5e6ad2',
  Figma: '#f24e1e', Default: '#4172f5',
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

