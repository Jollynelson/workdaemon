// Extracted from the former 5,000-line src/pages/Dashboard.jsx (2026-06-10 split).
import { useC } from '../lib/theme.jsx';

export function Spinner({ size = 14 }) {
  return (
    <span style={{
      width: size, height: size, display: 'inline-block',
      border: '2px solid rgba(255,255,255,0.1)',
      borderTopColor: 'rgba(255,255,255,0.65)',
      borderRadius: '50%',
      animation: 'wd-spin 0.75s linear infinite',
    }} />
  );
}

export function SkeletonRow({ height = 48, radius = 9 }) {
  const c = useC();
  return (
    <div style={{
      height, borderRadius: radius,
      background: c.d
        ? 'linear-gradient(90deg, rgba(255,255,255,0.03) 25%, rgba(255,255,255,0.06) 50%, rgba(255,255,255,0.03) 75%)'
        : 'linear-gradient(90deg, rgba(0,0,0,0.03) 25%, rgba(0,0,0,0.05) 50%, rgba(0,0,0,0.03) 75%)',
      backgroundSize: '400% 100%',
      animation: 'wd-shimmer 1.4s ease infinite',
    }} />
  );
}

export function EmptyState({ icon = '◈', title, subtitle, cta, onCta }) {
  const c = useC();
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', gap: 14, padding: 48 }}>
      <div style={{
        width: 48, height: 48, borderRadius: 12,
        background: c.subtle, border: `1px solid ${c.subtleBorder}`,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontFamily: 'var(--mono)', fontSize: 18, color: c.text3,
      }}>{icon}</div>
      <div style={{ textAlign: 'center', maxWidth: 320 }}>
        <p style={{ fontFamily: 'var(--dmsans)', fontSize: 15, fontWeight: 600, color: c.text, marginBottom: 6 }}>{title}</p>
        <p style={{ fontFamily: 'var(--dmsans)', fontSize: 13, color: c.text3, lineHeight: 1.6 }}>{subtitle}</p>
      </div>
      {cta && (
        <button className="wd-btn" onClick={onCta} style={{ marginTop: 4, fontSize: 11, letterSpacing: '0.06em' }}>
          {cta}
        </button>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// MARKDOWN RENDERER
// ─────────────────────────────────────────────────────────────────────────────

export function Md({ text, c }) {
  if (!text) return null;
  const bold = (s) => s.split(/\*\*([^*]+)\*\*/).map((part, i) =>
    i % 2 === 1 ? <strong key={i} style={{ color: c.text, fontWeight: 600 }}>{part}</strong> : part);
  return (
    <div style={{ fontFamily: 'var(--dmsans)', fontSize: 15, color: c.text, lineHeight: 1.75, textWrap: 'pretty' }}>
      {text.split('\n\n').map((para, pi) => {
        // Single newlines are real line breaks (HTML collapses them into run-on
        // text), and "- " lines are bullets — render both properly so model
        // output never lands as one wall of dashes.
        const lines = para.split('\n').filter(l => l.trim());
        return (
          <div key={pi} style={{ margin: pi > 0 ? '10px 0 0' : 0 }}>
            {lines.map((line, li) => {
              const m = line.match(/^\s*[-•]\s+(.*)$/);
              if (m) {
                return (
                  <div key={li} style={{ display: 'flex', gap: 9, margin: '4px 0' }}>
                    <span style={{ color: c.text3, flexShrink: 0 }}>•</span>
                    <span style={{ minWidth: 0 }}>{bold(m[1])}</span>
                  </div>
                );
              }
              return <p key={li} style={{ margin: li > 0 ? '6px 0 0' : 0 }}>{bold(line)}</p>;
            })}
          </div>
        );
      })}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// BLOCK RENDERERS
// ─────────────────────────────────────────────────────────────────────────────

