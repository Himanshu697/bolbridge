import { useAuth } from '../auth.jsx';
import { Link, navigate } from '../router.jsx';
import Icon from './Icons.jsx';
import { Logo } from './ui.jsx';

const NAV = [
  { to: '/app', icon: 'globe', label: 'Live Translate' },
  { to: '/app/try', icon: 'mic', label: 'Try the translator' },
  // a full page load, so the extension can attach to the test call
  { to: '/app/extension-test', icon: 'puzzle', label: 'Test the extension', reload: true },
  { to: '/app/voice', icon: 'user', label: 'My voice' },
  { sep: true },
  { to: '/app/learn', icon: 'book', label: 'AI tutor', tag: ['Soon', 'orange'] },
  { to: '/app/chat', icon: 'video', label: 'Video Chat', tag: ['Later', 'gray'] },
  { sep: true },
  { to: '/app/plan', icon: 'card', label: 'Plan and billing' },
];

export default function AppShell({ path, children }) {
  const { user, usage, logout } = useAuth();
  const left = usage ? Math.floor(usage.minutes_left) : null;
  return (
    <>
      <header className="app-top">
        <div className="bar">
          <Logo to="/app" />
          <div className="row">
            {left !== null && (
              <Link to="/app/plan" className="pill blue" style={{ textDecoration: 'none' }}>
                <Icon name="clock" size={16} />
                {left} min left
              </Link>
            )}
            <span className="avatar ink" title={user?.email}>{(user?.name || '?').slice(0, 1).toUpperCase()}</span>
            <button
              type="button"
              className="btn outline"
              onClick={() => {
                logout();
                navigate('/');
              }}
            >
              <Icon name="logout" size={18} />
              Log out
            </button>
          </div>
        </div>
      </header>
      <div className="app-body">
        <nav className="side" aria-label="App">
          {NAV.map((item, i) =>
            item.sep ? (
              <div key={i} className="sep" />
            ) : (
              item.reload ? (
                <a key={item.to} href={item.to} aria-current={path === item.to ? 'page' : undefined}>
                  <Icon name={item.icon} />
                  {item.label}
                </a>
              ) : (
                <Link key={item.to} to={item.to} aria-current={path === item.to ? 'page' : undefined}>
                  <Icon name={item.icon} />
                  {item.label}
                  {item.tag && <span className={`pill ${item.tag[1]} tag`} style={{ padding: '2px 8px', fontSize: 12 }}>{item.tag[0]}</span>}
                </Link>
              )
            ),
          )}
        </nav>
        <main className="app-main">{children}</main>
      </div>
    </>
  );
}
