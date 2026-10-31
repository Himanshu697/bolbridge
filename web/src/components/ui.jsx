import { LANGUAGES } from '../languages.js';
import { Link } from '../router.jsx';

export function Logo({ to = '/', light = false }) {
  return (
    <Link to={to} className="logo" style={light ? { color: '#fff' } : undefined}>
      <LogoMark size={30} />
      BolBridge
    </Link>
  );
}

export function LogoMark({ size = 32 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true">
      <rect x="2" y="4" width="18" height="14" rx="5" fill="#3D4BFF" />
      <path d="M7 17l-2 6 7-6z" fill="#3D4BFF" />
      <rect x="12" y="11" width="18" height="14" rx="5" fill="#FF7A1A" />
      <path d="M25 24l2 6-7-6z" fill="#FF7A1A" />
    </svg>
  );
}

export function Switch({ checked, onChange, label }) {
  return (
    <button type="button" role="switch" aria-checked={checked} aria-label={label} className="switch" onClick={() => onChange(!checked)}>
      <span className="track">
        <span className="knob" />
      </span>
    </button>
  );
}

export function LanguageSelect({ id, value, onChange, label }) {
  return (
    <label className="field" htmlFor={id}>
      <span>{label}</span>
      <select id={id} className="input" value={value} onChange={(e) => onChange(e.target.value)}>
        {LANGUAGES.map((l) => (
          <option key={l.code} value={l.code}>
            {l.voice ? l.name : `${l.name} (subtitles only)`}
          </option>
        ))}
      </select>
    </label>
  );
}

export function Silhouette({ width = 420, height = 460, label }) {
  return (
    <svg className="silhouette" width={width} height={height} viewBox="0 0 420 460" role="img" aria-label={label}>
      <circle cx="210" cy="170" r="92" fill="#2E3350" />
      <path d="M40 460c0-110 76-180 170-180s170 70 170 180z" fill="#2E3350" />
    </svg>
  );
}
