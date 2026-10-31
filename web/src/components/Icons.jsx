// Stroke icons (24x24 grid). Decorative unless a label is given.
const paths = {
  globe: <><circle cx="12" cy="12" r="10" /><path d="M2 12h20" /><path d="M12 2a15 15 0 0 1 0 20a15 15 0 0 1 0-20" /></>,
  book: <><path d="M2 5h7a3 3 0 0 1 3 3v12a2 2 0 0 0-2-2H2z" /><path d="M22 5h-7a3 3 0 0 0-3 3v12a2 2 0 0 1 2-2h8z" /></>,
  video: <><rect x="2" y="6" width="14" height="12" rx="2" /><path d="M16 10l6-3v10l-6-3" /></>,
  mic: <><rect x="9" y="2" width="6" height="12" rx="3" /><path d="M5 10a7 7 0 0 0 14 0" /><path d="M12 17v5" /></>,
  headphones: <><path d="M3 14v-2a9 9 0 0 1 18 0v2" /><rect x="3" y="14" width="4" height="7" rx="1.5" /><rect x="17" y="14" width="4" height="7" rx="1.5" /></>,
  puzzle: <path d="M4 7h4a2 2 0 1 1 4 0h4v4a2 2 0 1 1 0 4v4H4z" />,
  check: <path d="M5 12l5 5 9-10" />,
  arrow: <><path d="M5 12h14" /><path d="M13 6l6 6-6 6" /></>,
  back: <><path d="M19 12H5" /><path d="M11 6l-6 6 6 6" /></>,
  down: <><path d="M12 5v14" /><path d="M6 13l6 6 6-6" /></>,
  swap: <><path d="M7 4l-4 4 4 4" /><path d="M3 8h14" /><path d="M17 20l4-4-4-4" /><path d="M21 16H7" /></>,
  lock: <><rect x="5" y="11" width="14" height="10" rx="2" /><path d="M8 11V7a4 4 0 0 1 8 0v4" /></>,
  user: <><circle cx="12" cy="8" r="4" /><path d="M4 21a8 8 0 0 1 16 0" /></>,
  shield: <path d="M12 2l8 3v6c0 5-3.5 9-8 11c-4.5-2-8-6-8-11V5z" />,
  message: <path d="M21 12a8 8 0 0 1-11.6 7.1L4 21l1.9-5.4A8 8 0 1 1 21 12z" />,
  clock: <><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></>,
  card: <><rect x="2" y="5" width="20" height="14" rx="2" /><path d="M2 10h20" /></>,
  link: <><path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1" /><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1" /></>,
  play: <path d="M7 5l12 7-12 7z" />,
  stop: <rect x="6" y="6" width="12" height="12" rx="2" />,
  next: <><path d="M5 5l10 7-10 7z" /><path d="M19 5v14" /></>,
  flag: <><path d="M5 21V4" /><path d="M5 4h12l-2 4 2 4H5" /></>,
  logout: <><path d="M15 4h4v16h-4" /><path d="M10 8l-4 4 4 4" /><path d="M6 12h10" /></>,
  trash: <><path d="M4 7h16" /><path d="M9 7V4h6v3" /><path d="M6 7l1 13h10l1-13" /></>,
  speaker: <><path d="M4 10v4h4l5 4V6L8 10z" /><path d="M17 9a4 4 0 0 1 0 6" /></>,
};

export default function Icon({ name, size = 20, stroke = 2, color = 'currentColor', label, style }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke={color}
      strokeWidth={stroke}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden={label ? undefined : 'true'}
      role={label ? 'img' : undefined}
      aria-label={label}
      style={style}
    >
      {paths[name]}
    </svg>
  );
}
