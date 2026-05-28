export default function DaemonMark({ size = 40, color = '#3b6ef7', glow = false, float = false }) {
  const h = Math.round(size * 0.9);
  return (
    <svg
      width={size}
      height={h}
      viewBox="0 0 100 90"
      fill="none"
      style={{
        ...(glow ? { filter: `drop-shadow(0 0 ${size * 0.18}px ${color}90) drop-shadow(0 0 ${size * 0.36}px ${color}30)` } : {}),
        ...(float ? { animation: 'wd-float 5s ease-in-out infinite' } : {}),
        display: 'block',
        flexShrink: 0,
      }}
    >
      <circle cx="50" cy="11" r="5" stroke={color} strokeWidth="2.6" fill="none" />
      <path
        d="M 46 15 C 20 18 4 44 6 62 C 6 74 12 82 22 78 Q 30 74 36 68 Q 50 56 64 68 Q 70 74 78 78 C 88 82 94 74 94 62 C 96 44 80 18 54 15"
        stroke={color}
        strokeWidth="2.6"
        fill="none"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
