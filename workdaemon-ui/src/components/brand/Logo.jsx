import DaemonMark from './DaemonMark.jsx';

export default function Logo({ size = 'md', light = false }) {
  const scales = { sm: 18, md: 24, lg: 32 };
  const markSize = scales[size] ?? scales.md;
  const textSize = { sm: 12, md: 15, lg: 20 }[size] ?? 15;
  const subSize  = { sm: 6,  md: 7,  lg: 9  }[size] ?? 7;

  const textColor   = light ? '#0b1a60' : '#ffffff';
  const accentColor = light ? '#1a3dc8' : '#3b6ef7';
  const markColor   = light ? '#1a3dc8' : '#3b6ef7';

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, userSelect: 'none' }}>
      <DaemonMark size={markSize} color={markColor} />
      <div>
        <div style={{ fontFamily: 'var(--orbitron)', lineHeight: 1 }}>
          <span style={{ fontSize: textSize, fontWeight: 400, color: textColor, letterSpacing: '0.1em' }}>WORK</span>
          <span style={{ fontSize: textSize, fontWeight: 700, color: accentColor, letterSpacing: '0.1em' }}>DAEMON</span>
        </div>
        <div style={{
          fontFamily: 'var(--mono)',
          fontSize: subSize,
          color: accentColor,
          opacity: 0.4,
          letterSpacing: '0.3em',
          marginTop: 3,
        }}>
          YOUR COMPANY, QUERYABLE.
        </div>
      </div>
    </div>
  );
}
