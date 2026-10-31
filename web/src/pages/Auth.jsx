import { useState } from 'react';
import { useAuth } from '../auth.jsx';
import Icon from '../components/Icons.jsx';
import { LanguageSelect, Logo } from '../components/ui.jsx';
import { navigate, useLocation } from '../router.jsx';

const PRODUCTS = {
  translate: {
    name: 'Live Translate',
    short: 'Live Translate',
    path: '/app',
    desc: 'Translate your web calls live, in your own voice. The other person installs nothing.',
    steps: ['Install the Chrome extension', 'Record 30 seconds of your voice (optional)', 'Open a call and turn BolBridge on'],
  },
  learn: {
    name: 'AI tutor',
    short: 'your AI tutor',
    path: '/app/learn',
    desc: 'Practise speaking any language with a lifelike tutor that corrects you as you go.',
    steps: ['Pick the language you want to learn', 'Tell us your level and goal', 'Start your first 10-minute lesson'],
  },
  chat: {
    name: 'Video Chat',
    short: 'Video Chat',
    path: '/app/chat',
    desc: 'Meet new people on video. Everyone speaks their own language and hears yours translated.',
    steps: ['Allow camera and microphone', 'Choose who you want to meet', 'Say hello, translation does the rest'],
  },
};

function guessRegion() {
  try {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || '';
    return tz === 'Asia/Calcutta' || tz === 'Asia/Kolkata' ? 'IN' : 'INTL';
  } catch {
    return 'IN';
  }
}

export default function AuthPage() {
  const { search } = useLocation();
  const auth = useAuth();
  const [mode, setMode] = useState(search.get('mode') === 'login' ? 'login' : 'signup');
  const [productId, setProductId] = useState(PRODUCTS[search.get('product')] ? search.get('product') : 'translate');
  const [form, setForm] = useState({ name: '', email: '', password: '', speaks: 'hi', agree: false });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const product = PRODUCTS[productId];
  const signup = mode === 'signup';
  const next = search.get('next');

  const set = (key) => (e) => setForm({ ...form, [key]: e.target.type === 'checkbox' ? e.target.checked : e.target.value });

  async function submit(e) {
    e.preventDefault();
    setError('');
    if (signup && !form.agree) {
      setError('Please accept the Terms and Privacy Policy to continue.');
      return;
    }
    setBusy(true);
    try {
      if (signup) {
        await auth.signup({ name: form.name, email: form.email, password: form.password, speaks: form.speaks, region: guessRegion(), product: productId });
      } else {
        await auth.login(form.email, form.password);
      }
      navigate(next && next.startsWith('/app') ? next : product.path);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="auth">
      <aside className="auth-side">
        <Logo light />
        <div className="stack" style={{ marginTop: 16 }}>
          <span className="eyebrow" style={{ color: 'var(--on-dark-2)' }}>You're joining</span>
          <div className="row" role="group" aria-label="Choose a product" style={{ gap: 8 }}>
            {Object.entries(PRODUCTS).map(([id, p]) => (
              <button key={id} type="button" className="chip" aria-pressed={id === productId} onClick={() => setProductId(id)}>{p.name}</button>
            ))}
          </div>
        </div>
        <div className="auth-product">
          <h2>{product.name}</h2>
          <p style={{ color: 'var(--on-dark-2)', fontSize: 17 }}>{product.desc}</p>
          <span className="eyebrow" style={{ color: 'var(--on-dark-2)' }}>After you sign up</span>
          {product.steps.map((s, i) => (
            <div key={s} className="auth-step"><b>{i + 1}</b><span>{s}</span></div>
          ))}
        </div>
        <p className="small" style={{ marginTop: 'auto', color: 'var(--on-dark-2)' }}>Free to start · No card needed · One account for every product</p>
      </aside>

      <main className="auth-main">
        <form className="auth-form" onSubmit={submit} noValidate>
          <div className="stack" style={{ gap: 6 }}>
            <h1 style={{ fontSize: 32 }}>{signup ? 'Create your account' : 'Welcome back'}</h1>
            <p className="muted">Then we'll take you straight to {product.short}.</p>
          </div>

          <div className="segmented" role="group" aria-label="Sign up or log in" style={{ display: 'flex' }}>
            <button type="button" style={{ flex: 1 }} aria-pressed={signup} onClick={() => setMode('signup')}>Sign up</button>
            <button type="button" style={{ flex: 1 }} aria-pressed={!signup} onClick={() => setMode('login')}>Log in</button>
          </div>

          {signup && (
            <label className="field">
              <span>Your name</span>
              <input className="input" autoComplete="name" value={form.name} onChange={set('name')} placeholder="Himanshu" required />
            </label>
          )}
          <label className="field">
            <span>Email</span>
            <input className="input" type="email" autoComplete="email" value={form.email} onChange={set('email')} placeholder="you@example.com" required />
          </label>
          <label className="field">
            <span>Password</span>
            <input className="input" type="password" autoComplete={signup ? 'new-password' : 'current-password'} value={form.password} onChange={set('password')} placeholder="At least 8 characters" required />
          </label>
          {signup && (
            <>
              <LanguageSelect id="speaks" label="I speak" value={form.speaks} onChange={(v) => setForm({ ...form, speaks: v })} />
              <label className="check">
                <input type="checkbox" checked={form.agree} onChange={set('agree')} />
                <span>I agree to the Terms and Privacy Policy. My voice is only used with my permission.</span>
              </label>
            </>
          )}

          {error && <p className="alert error" role="alert">{error}</p>}

          <button type="submit" className="btn primary lg" disabled={busy}>
            {busy ? 'Please wait…' : `${signup ? 'Create account' : 'Log in'} and open ${product.short}`}
            {!busy && <Icon name="arrow" size={18} />}
          </button>
          <p className="muted" style={{ textAlign: 'center' }}>
            {signup ? 'Already have an account?' : 'New to BolBridge?'}{' '}
            <button type="button" className="btn link" onClick={() => setMode(signup ? 'login' : 'signup')}>{signup ? 'Log in' : 'Sign up'}</button>
          </p>
        </form>
      </main>
    </div>
  );
}
