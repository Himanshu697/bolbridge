import { useEffect } from 'react';
import { useAuth } from './auth.jsx';
import AppShell from './components/AppShell.jsx';
import AuthPage from './pages/Auth.jsx';
import Chat from './pages/Chat.jsx';
import ConnectExtension from './pages/ConnectExtension.jsx';
import Dashboard from './pages/Dashboard.jsx';
import Landing from './pages/Landing.jsx';
import Learn from './pages/Learn.jsx';
import NotFound from './pages/NotFound.jsx';
import Plan from './pages/Plan.jsx';
import Try from './pages/Try.jsx';
import Voice from './pages/Voice.jsx';
import { navigate, useLocation } from './router.jsx';

const APP_PAGES = {
  '/app': { page: Dashboard, title: 'Live Translate' },
  '/app/try': { page: Try, title: 'Try the translator' },
  '/app/voice': { page: Voice, title: 'My voice' },
  '/app/learn': { page: Learn, title: 'AI tutor' },
  '/app/chat': { page: Chat, title: 'Talk to the World' },
  '/app/plan': { page: Plan, title: 'Plan and billing' },
};

export default function App() {
  const { path } = useLocation();
  const { user, loading } = useAuth();
  const clean = path.replace(/\/$/, '') || '/';
  const appPage = APP_PAGES[clean];
  const needsLogin = !!appPage || clean === '/connect-extension';

  useEffect(() => {
    const name = appPage ? appPage.title : clean === '/auth' ? 'Sign up or log in' : null;
    document.title = name ? `${name} · BolBridge` : 'BolBridge · Live call translation';
  }, [clean, appPage]);

  useEffect(() => {
    if (needsLogin && !loading && !user) {
      const product = clean === '/app/learn' ? 'learn' : clean === '/app/chat' ? 'chat' : 'translate';
      navigate(`/auth?mode=login&product=${product}&next=${encodeURIComponent(clean)}`, { replace: true });
    }
  }, [needsLogin, loading, user, clean]);

  if (clean === '/') return <Landing />;
  if (clean === '/auth') return <AuthPage />;
  if (needsLogin && (loading || !user)) return <p className="container" style={{ padding: 40 }}>Loading…</p>;
  if (clean === '/connect-extension') return <ConnectExtension />;
  if (appPage) {
    const Page = appPage.page;
    return (
      <AppShell path={clean}>
        <Page />
      </AppShell>
    );
  }
  return <NotFound />;
}
