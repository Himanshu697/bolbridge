// A tiny router (no extra library): history API + <Link>.
import { useEffect, useState } from 'react';

const listeners = new Set();

export function navigate(to, { replace = false } = {}) {
  if (replace) window.history.replaceState({}, '', to);
  else window.history.pushState({}, '', to);
  listeners.forEach((fn) => fn());
  if (!to.includes('#')) window.scrollTo(0, 0);
}

export function useLocation() {
  const read = () => ({ path: window.location.pathname, search: new URLSearchParams(window.location.search) });
  const [loc, setLoc] = useState(read);
  useEffect(() => {
    const update = () => setLoc(read());
    listeners.add(update);
    window.addEventListener('popstate', update);
    return () => {
      listeners.delete(update);
      window.removeEventListener('popstate', update);
    };
  }, []);
  return loc;
}

export function Link({ to, children, ...rest }) {
  const onClick = (e) => {
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    if (to.startsWith('http') || to.startsWith('#')) return;
    e.preventDefault();
    navigate(to);
  };
  return (
    <a href={to} onClick={onClick} {...rest}>
      {children}
    </a>
  );
}
