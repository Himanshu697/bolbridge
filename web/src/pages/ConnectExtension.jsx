import { useEffect, useState } from 'react';
import { getToken } from '../api.js';
import { useAuth } from '../auth.jsx';
import Icon from '../components/Icons.jsx';
import { Logo } from '../components/ui.jsx';
import { connectExtension, getExtensionId, pingExtension, setExtensionId } from '../extension.js';
import { Link } from '../router.jsx';

export default function ConnectExtension() {
  const { user } = useAuth();
  const [id, setId] = useState(getExtensionId());
  const [state, setState] = useState('checking'); // checking | missing | ready | connected | failed
  const [showToken, setShowToken] = useState(false);

  async function check() {
    setState('checking');
    const res = await pingExtension();
    setState(res.installed ? (res.connected ? 'connected' : 'ready') : 'missing');
  }

  useEffect(() => {
    check();
  }, []);

  async function connect() {
    const ok = await connectExtension(getToken(), user);
    setState(ok ? 'connected' : 'failed');
  }

  function saveId(e) {
    e.preventDefault();
    setExtensionId(id);
    check();
  }

  return (
    <div className="container" style={{ maxWidth: 760, padding: '40px 24px' }}>
      <div className="row" style={{ justifyContent: 'space-between', marginBottom: 32 }}>
        <Logo to="/app" />
        <Link to="/app" className="btn outline"><Icon name="back" size={18} />Dashboard</Link>
      </div>
      <h1 style={{ fontSize: 32, marginBottom: 8 }}>Connect the Chrome extension</h1>
      <p className="muted" style={{ marginBottom: 24 }}>Signing the extension in lets it count minutes on your plan and use your own voice.</p>

      {state === 'connected' && (
        <div className="card stack">
          <p className="alert info">The extension is signed in as {user.name}. Open a call on WhatsApp Web, OmeTV or Google Meet and click the BolBridge icon.</p>
          <button type="button" className="btn outline" onClick={connect}>Sign in again</button>
        </div>
      )}

      {(state === 'ready' || state === 'failed') && (
        <div className="card stack">
          <p>We found BolBridge in this browser.</p>
          <button type="button" className="btn primary lg" onClick={connect}>Sign the extension in as {user.name}</button>
          {state === 'failed' && <p className="alert error">That didn't work. Reload the extension in chrome://extensions and try again.</p>}
        </div>
      )}

      {state === 'missing' && (
        <div className="card stack" style={{ gap: 16 }}>
          <h2>Install it (developer version)</h2>
          <ol className="stack" style={{ margin: 0, paddingLeft: 20, gap: 8 }}>
            <li>Open <code>chrome://extensions</code> in Chrome.</li>
            <li>Turn on <strong>Developer mode</strong> (top right).</li>
            <li>Click <strong>Load unpacked</strong> and choose the <code>extension</code> folder of this project.</li>
            <li>Copy the extension's <strong>ID</strong> shown on its card and paste it here.</li>
          </ol>
          <form className="row" onSubmit={saveId}>
            <label className="field grow">
              <span>Extension ID</span>
              <input className="input" value={id} onChange={(e) => setId(e.target.value)} placeholder="32 letters, a to p" />
            </label>
            <button type="submit" className="btn dark" style={{ alignSelf: 'flex-end' }}>Check again</button>
          </form>
        </div>
      )}

      {state === 'checking' && <p className="muted">Looking for the extension…</p>}

      <details className="card" style={{ marginTop: 24 }}>
        <summary style={{ cursor: 'pointer', fontWeight: 600 }}>Other browsers or manual setup</summary>
        <p className="muted" style={{ margin: '12px 0' }}>The extension also works without signing in while the server runs in developer mode. If automatic sign-in fails, open the extension, expand "Account and server" and paste this key into "Account key". Keep it private, like a password.</p>
        {showToken ? (
          <code style={{ display: 'block', wordBreak: 'break-all', background: 'var(--bg)', padding: 12, borderRadius: 12 }}>{getToken()}</code>
        ) : (
          <button type="button" className="btn outline" onClick={() => setShowToken(true)}>Show my key</button>
        )}
      </details>
    </div>
  );
}
