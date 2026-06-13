// Real brand logos for the integration directory — full-colour, inline SVG (no
// network requests, crisp at any size). Keyed by the oauth.js provider id.
// Unknown providers fall back to a tinted monogram tile.

const Slack = (s) => (
  <svg width={s} height={s} viewBox="0 0 122.8 122.8" aria-hidden="true">
    <path d="M25.8 77.6a12.9 12.9 0 1 1-12.9-12.9h12.9z" fill="#E01E5A" />
    <path d="M32.3 77.6a12.9 12.9 0 0 1 25.8 0v32.3a12.9 12.9 0 0 1-25.8 0z" fill="#E01E5A" />
    <path d="M45.2 25.8a12.9 12.9 0 1 1 12.9-12.9v12.9z" fill="#36C5F0" />
    <path d="M45.2 32.3a12.9 12.9 0 0 1 0 25.8H12.9a12.9 12.9 0 0 1 0-25.8z" fill="#36C5F0" />
    <path d="M97 45.2a12.9 12.9 0 1 1 12.9 12.9H97z" fill="#2EB67D" />
    <path d="M90.5 45.2a12.9 12.9 0 0 1-25.8 0V12.9a12.9 12.9 0 0 1 25.8 0z" fill="#2EB67D" />
    <path d="M77.6 97a12.9 12.9 0 1 1-12.9 12.9V97z" fill="#ECB22E" />
    <path d="M77.6 90.5a12.9 12.9 0 0 1 0-25.8h32.3a12.9 12.9 0 0 1 0 25.8z" fill="#ECB22E" />
  </svg>
);

const GitHub = (s) => (
  <svg width={s} height={s} viewBox="0 0 98 96" aria-hidden="true">
    <path fillRule="evenodd" clipRule="evenodd" fill="#fff" d="M48.9 0C21.8 0 0 22 0 49.2c0 21.8 14 40.2 33.4 46.7 2.4.5 3.3-1 3.3-2.4 0-1.1-.1-5-.1-9.1-13.6 3-16.4-5.9-16.4-5.9-2.2-5.7-5.4-7.2-5.4-7.2-4.5-3 .3-3 .3-3 4.9.3 7.5 5.1 7.5 5.1 4.4 7.5 11.4 5.4 14.2 4.1.4-3.2 1.7-5.4 3.1-6.6-10.9-1.2-22.3-5.4-22.3-24.3 0-5.4 1.9-9.8 5-13.2-.5-1.2-2.2-6.3.5-13 0 0 4.1-1.3 13.4 5a46.5 46.5 0 0 1 24.4 0c9.3-6.4 13.4-5 13.4-5 2.7 6.8 1 11.8.5 13a19 19 0 0 1 5 13.2c0 18.9-11.4 23.1-22.3 24.3 1.8 1.5 3.3 4.5 3.3 9.1 0 6.6-.1 11.9-.1 13.5 0 1.3.9 2.9 3.3 2.4A49.2 49.2 0 0 0 48.9 0z" />
  </svg>
);

const Notion = (s) => (
  <svg width={s} height={s} viewBox="0 0 24 24" aria-hidden="true">
    <rect width="24" height="24" rx="4.5" fill="#fff" />
    <path fill="#000" d="M6.7 7.2c.5.4.7.4 1.6.3l8.5-.5c.2 0 0-.2 0-.2l-1.4-1c-.3-.2-.6-.5-1.3-.4l-8.2.6c-.3 0-.4.2-.2.3l1 .9zm.5 2v8.9c0 .5.2.7.8.6l9.3-.5c.5 0 .6-.4.6-.8V8.6c0-.4-.1-.6-.5-.6l-9.7.6c-.4 0-.5.2-.5.6zm9.2.5c0 .3 0 .6-.3.6l-.4.1v6.5c-.4.2-.7.3-1 .3-.5 0-.6-.1-1-.6l-2.9-4.5v4.3l.9.2s0 .5-.7.5l-2 .1c-.1-.1 0-.4.2-.5l.5-.1v-5.8l-.7-.1c-.1-.3.1-.6.5-.7l2.2-.1 3 4.5v-4l-.7-.1c-.1-.3.2-.5.5-.6z" />
  </svg>
);

const GoogleDrive = (s) => (
  <svg width={s} height={s} viewBox="0 0 87.3 78" aria-hidden="true">
    <path d="M6.6 66.85l3.85 6.65c.8 1.4 1.95 2.5 3.3 3.3l13.75-23.8H0c0 1.55.4 3.1 1.2 4.5z" fill="#0066da" />
    <path d="M43.65 25L29.9 1.2c-1.35.8-2.5 1.9-3.3 3.3l-25.4 44A9.06 9.06 0 0 0 0 53h27.5z" fill="#00ac47" />
    <path d="M73.55 76.8c1.35-.8 2.5-1.9 3.3-3.3l1.6-2.75 7.65-13.25c.8-1.4 1.2-2.95 1.2-4.5H59.798l5.852 11.5z" fill="#ea4335" />
    <path d="M43.65 25L57.4 1.2C56.05.4 54.5 0 52.9 0H34.4c-1.6 0-3.15.45-4.5 1.2z" fill="#00832d" />
    <path d="M59.8 53H27.5L13.75 76.8c1.35.8 2.9 1.2 4.5 1.2h50.8c1.6 0 3.15-.45 4.5-1.2z" fill="#2684fc" />
    <path d="M73.4 26.5L60.7 4.5c-.8-1.4-1.95-2.5-3.3-3.3L43.65 25l16.15 28h27.45c0-1.55-.4-3.1-1.2-4.5z" fill="#ffba00" />
  </svg>
);

const Microsoft = (s) => (
  <svg width={s} height={s} viewBox="0 0 23 23" aria-hidden="true">
    <path fill="#f25022" d="M1 1h10v10H1z" />
    <path fill="#00a4ef" d="M1 12h10v10H1z" />
    <path fill="#7fba00" d="M12 1h10v10H12z" />
    <path fill="#ffb900" d="M12 12h10v10H12z" />
  </svg>
);

const Atlassian = (s) => (
  <svg width={s} height={s} viewBox="0 0 256 256" aria-hidden="true">
    <defs>
      <linearGradient id="atl" x1="50%" y1="0%" x2="50%" y2="100%">
        <stop offset="0" stopColor="#0052CC" /><stop offset="1" stopColor="#2684FF" />
      </linearGradient>
    </defs>
    <path fill="url(#atl)" d="M75.6 116.5a8 8 0 0 0-13.6 2L1 240a8.2 8.2 0 0 0 7.3 11.9h84.9a7.9 7.9 0 0 0 7.3-4.5c18.2-37.6 7.1-94.7-24.9-130.9z" />
    <path fill="#2684FF" d="M121.6 4.2a181 181 0 0 0-10.6 178.7l40.9 81.7a8.2 8.2 0 0 0 7.3 4.5h84.9a8.2 8.2 0 0 0 7.3-11.9S135.7 8.2 135.5 7.8a8 8 0 0 0-13.9-3.6z" />
  </svg>
);

const Salesforce = (s) => (
  <svg width={s} height={s} viewBox="0 0 256 180" aria-hidden="true">
    <path fill="#00A1E0" d="M106 26a46 46 0 0 1 74 9.6 56 56 0 0 1 22-4.6c31 0 56 25.3 56 56.5S233 144 202 144H72a51 51 0 0 1-11-100.7A50 50 0 0 1 106 26z" />
  </svg>
);

const HubSpot = (s) => (
  <svg width={s} height={s} viewBox="0 0 256 256" aria-hidden="true">
    <path fill="#FF7A59" d="M170 94V70a24 24 0 1 0-22 0v24a70 70 0 0 0-33 13L78 70a26 26 0 1 0-17 15l41 41a68 68 0 1 0 68-27zm-12 113a40 40 0 1 1 40-40 40 40 0 0 1-40 40z" />
  </svg>
);

const ICONS = {
  slack: Slack, github: GitHub, notion: Notion, google: GoogleDrive, gdrive: GoogleDrive,
  microsoft: Microsoft, atlassian: Atlassian, salesforce: Salesforce, hubspot: HubSpot,
};

// Render a provider's brand mark. `id` = oauth provider key; falls back to a
// tinted monogram (first letter of `label`) when there's no logo for it.
export function ProviderIcon({ id, label = '?', size = 22, fallbackColor = '#8a8f98' }) {
  const Icon = ICONS[id];
  if (Icon) return Icon(size);
  return (
    <span style={{
      width: size, height: size, borderRadius: 6, display: 'inline-flex', alignItems: 'center',
      justifyContent: 'center', fontFamily: 'var(--orbitron, sans-serif)', fontSize: size * 0.5,
      fontWeight: 700, color: fallbackColor, background: 'rgba(138,143,152,0.14)',
    }}>{String(label)[0]}</span>
  );
}

export default ProviderIcon;
