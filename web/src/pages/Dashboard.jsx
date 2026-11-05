import { useEffect, useState } from 'react';
import { api } from '../api.js';
import { useAuth } from '../auth.jsx';
import Icon from '../components/Icons.jsx';
import { LanguageSelect } from '../components/ui.jsx';
import { pingExtension } from '../extension.js';
import { langName } from '../languages.js';
import { Link } from '../router.jsx';

const SITES = [
  ['WhatsApp Web', 'Finds calls on its own'],
  ['OmeTV', 'Finds calls on its own'],
  ['Google Meet', 'Finds calls on its own'],
  ['Zoom on the web', 'Finds calls on its own'],
  ['Any other site that uses your mic', 'Turn on from the extension'],
];

const PLATFORM_NAMES = { 'whatsapp-web': 'WhatsApp Web', ometv: 'OmeTV', 'google-meet': 'Google Meet', 'zoom-web': 'Zoom', 'web-test': 'Test page' };

function formatWhen(iso) {
  const d = new Date(iso);
  return d.toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
}

export default function Dashboard() {
  const { user, usage } = useAuth();
  const [ext, setExt] = useState({ installed: false, connected: false, checked: false });
  const [voice, setVoice] = useState(null);
  const [contacts, setContacts] = useState([]);
  const [calls, setCalls] = useState([]);
  const [draft, setDraft] = useState({ name: '', language: 'fr' });
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    pingExtension().then((r) => setExt({ ...r, checked: true }));
    api('/api/voice').then(setVoice).catch(() => {});
    api('/api/contacts').then(setContacts).catch((e) => setError(e.message));
    api('/api/calls').then(setCalls).catch(() => {});
  }, []);

  async function addContact(e) {
    e.preventDefault();
    setError('');
    try {
      const c = await api('/api/contacts', { method: 'POST', body: draft });
      setContacts([...contacts, c].sort((a, b) => a.name.localeCompare(b.name)));
      setDraft({ name: '', language: draft.language });
      setAdding(false);
    } catch (err) {
      setError(err.message);
    }
  }

  async function removeContact(id) {
    await api(`/api/contacts/${id}`, { method: 'DELETE' });
    setContacts(contacts.filter((c) => c.id !== id));
  }

  const steps = [
    ['Install the Chrome extension', ext.installed],
    ['Record your voice (optional)', !!voice?.has_voice],
    ['Make your first translated call', calls.length > 0],
  ];
  const done = steps.filter((s) => s[1]).length;
  const quota = usage?.minutes_quota || 0;
  const left = usage?.minutes_left ?? 0;

  return (
    <>
      <div className="page-head">
        <div className="stack" style={{ gap: 4 }}>
          <h1>Namaste, {user.name.split(' ')[0]}</h1>
          <p className="muted">{ext.installed ? 'Your extension is ready. Open a call and turn BolBridge on.' : 'Add the Chrome extension, then open a call on WhatsApp Web, OmeTV or Google Meet.'}</p>
        </div>
        <div className="row">
          <Link to="/app/try" className="btn outline"><Icon name="mic" size={18} />Try it here first</Link>
          <a href="/app/extension-test" className="btn outline"><Icon name="puzzle" size={18} />Test the extension</a>
          <Link to="/connect-extension" className="btn primary"><Icon name="puzzle" size={18} />{ext.connected ? 'Extension connected' : 'Connect the extension'}</Link>
        </div>
      </div>

      <div className="tile-row">
        <div className="card tight stack">
          <div className="row"><span className="tile-icon" style={{ background: 'var(--blue-tint)', color: 'var(--blue-dark)' }}><Icon name="puzzle" size={22} /></span><strong>Chrome extension</strong></div>
          <span className="row" style={{ gap: 8, fontWeight: 600 }}>
            <span className={`dot ${ext.installed ? '' : 'off'}`} />
            {!ext.checked ? 'Checking…' : ext.installed ? (ext.connected ? 'Installed and signed in' : 'Installed, not signed in') : 'Not found in this browser'}
          </span>
          <Link to="/connect-extension" className="small" style={{ fontWeight: 600 }}>{ext.installed ? 'Manage' : 'How to install'}</Link>
        </div>
        <div className="card tight stack">
          <div className="row"><span className="tile-icon" style={{ background: 'var(--orange-tint)', color: 'var(--orange-text)' }}><Icon name="mic" size={22} /></span><strong>My voice</strong></div>
          <span className="muted">{voice?.has_voice ? `Voice sample saved (${Math.round(voice.seconds)} s)` : 'No voice sample yet'}</span>
          <Link to="/app/voice" className="small" style={{ fontWeight: 600 }}>{voice?.has_voice ? 'Record again' : 'Record 30 seconds'}</Link>
        </div>
        <div className="card tight stack">
          <div className="row" style={{ justifyContent: 'space-between' }}><strong>Minutes this month</strong><span className="tiny" style={{ textTransform: 'capitalize' }}>{usage?.plan} plan</span></div>
          <span style={{ fontFamily: 'var(--display)', fontSize: 28, fontWeight: 700 }}>{Math.floor(left)} <span className="muted" style={{ fontSize: 16, fontWeight: 500, fontFamily: 'var(--font)' }}>of {quota} left</span></span>
          <div className="progress" role="img" aria-label={`${Math.floor(left)} of ${quota} minutes left`}><div style={{ width: `${quota ? (left / quota) * 100 : 0}%` }} /></div>
          <Link to="/app/plan" className="small" style={{ fontWeight: 600 }}>Get more minutes</Link>
        </div>
      </div>

      <section className="card stack" aria-labelledby="start-h">
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <h2 id="start-h">Getting started</h2>
          <span className="small muted" style={{ fontWeight: 600 }}>{done} of 3 done</span>
        </div>
        {steps.map(([label, ok]) => (
          <div key={label} className="row" style={{ minHeight: 44 }}>
            <span className="avatar" style={{ width: 28, height: 28, background: ok ? 'var(--blue)' : 'transparent', border: ok ? 0 : '2px solid var(--line-strong)', color: '#fff' }}>{ok && <Icon name="check" size={16} stroke={3} />}</span>
            <span style={ok ? { color: 'var(--ink-2)', textDecoration: 'line-through' } : { fontWeight: 600 }}>{label}</span>
          </div>
        ))}
      </section>

      <div className="tile-row">
        <section className="card stack" aria-labelledby="works-h" style={{ flexBasis: 340, gap: 4 }}>
          <h2 id="works-h" style={{ marginBottom: 8 }}>Works on</h2>
          {SITES.map(([name, mode]) => (
            <div key={name} className="list-row" style={{ justifyContent: 'space-between' }}><strong style={{ fontWeight: 600 }}>{name}</strong><span className="small muted">{mode}</span></div>
          ))}
        </section>

        <section className="card stack" aria-labelledby="contacts-h" style={{ flexBasis: 340, gap: 4 }}>
          <div className="row" style={{ justifyContent: 'space-between', marginBottom: 8 }}>
            <h2 id="contacts-h">Contacts and their languages</h2>
            <button type="button" className="btn outline" onClick={() => setAdding(!adding)}>{adding ? 'Cancel' : 'Add contact'}</button>
          </div>
          {adding && (
            <form onSubmit={addContact} className="stack" style={{ marginBottom: 12 }}>
              <label className="field"><span>Name</span><input className="input" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} placeholder="Camille" required /></label>
              <LanguageSelect id="contact-lang" label="They speak" value={draft.language} onChange={(v) => setDraft({ ...draft, language: v })} />
              <button type="submit" className="btn dark">Save contact</button>
            </form>
          )}
          {error && <p className="alert error">{error}</p>}
          {contacts.length === 0 && !adding && <p className="empty">Save the people you call and the language they speak.</p>}
          {contacts.map((c) => (
            <div key={c.id} className="list-row">
              <span className="avatar soft">{c.name.slice(0, 1).toUpperCase()}</span>
              <strong className="grow" style={{ fontWeight: 600 }}>{c.name}</strong>
              <span className="pill outline" style={{ fontWeight: 500 }}>{langName(c.language)}</span>
              <button type="button" className="btn link" aria-label={`Delete ${c.name}`} onClick={() => removeContact(c.id)}><Icon name="trash" size={18} /></button>
            </div>
          ))}
        </section>
      </div>

      <section className="card stack" aria-labelledby="calls-h">
        <h2 id="calls-h">Recent translated calls</h2>
        {calls.length === 0 ? (
          <p className="empty">No calls yet. Your translated calls show up here (we keep the details, never the audio).</p>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr><th scope="col">With</th><th scope="col">Where</th><th scope="col">Languages</th><th scope="col">Talked</th><th scope="col">When</th></tr>
              </thead>
              <tbody>
                {calls.map((c) => (
                  <tr key={c.id}>
                    <td>{c.peer_name || (c.direction === 'in' ? 'Them' : 'You')}</td>
                    <td>{PLATFORM_NAMES[c.platform] || c.platform}</td>
                    <td>{langName(c.src_lang)} → {langName(c.tgt_lang)}</td>
                    <td>{Math.max(1, Math.round(c.seconds_processed / 60))} min</td>
                    <td>{formatWhen(c.started_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}
