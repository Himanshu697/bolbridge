import { useState } from 'react';
import { api } from '../api.js';
import { useAuth } from '../auth.jsx';
import Icon from '../components/Icons.jsx';
import { Silhouette } from '../components/ui.jsx';

export function Waitlist({ product }) {
  const { user } = useAuth();
  const [done, setDone] = useState(false);
  async function join() {
    await api('/api/waitlist', { method: 'POST', body: { email: user.email, product }, auth: false });
    setDone(true);
  }
  return done ? (
    <p className="alert info">You're on the list. We'll email {user.email} when it opens.</p>
  ) : (
    <button type="button" className="btn dark" onClick={join}>Notify me when it opens</button>
  );
}

export default function Learn() {
  return (
    <>
      <div className="page-head">
        <div className="stack" style={{ gap: 4 }}>
          <span className="pill orange" style={{ alignSelf: 'flex-start' }}>Coming next</span>
          <h1>Learn with an AI tutor</h1>
          <p className="muted">Talk face to face with a lifelike tutor. It speaks, listens, corrects you gently and explains in Hindi when you're stuck.</p>
        </div>
        <Waitlist product="learn" />
      </div>

      <div className="tile-row">
        <div style={{ flex: '999 1 560px' }} className="stack">
          <div className="stage">
            <Silhouette label="Preview: the tutor's live avatar video goes here" />
            <span className="tag"><strong>Amélie</strong> · your French tutor</span>
            <div className="self">You</div>
            <div className="subs">
              <span className="big">Bonjour Himanshu ! Qu'est-ce que tu veux boire ?</span>
              <span className="small">नमस्ते हिमांशु! तुम क्या पीना चाहोगे?</span>
            </div>
          </div>
          <div className="card tight row" style={{ justifyContent: 'center' }}>
            <button type="button" className="btn outline" disabled>Hint in Hindi</button>
            <button type="button" className="mic-btn" disabled><Icon name="mic" size={22} />Your turn, speak</button>
            <button type="button" className="btn outline" disabled>Say it slower</button>
          </div>
        </div>
        <div className="stack" style={{ flex: '1 1 300px' }}>
          <section className="card tight stack" style={{ gap: 8 }}>
            <span className="eyebrow">Quick correction</span>
            <span className="small muted">You said</span>
            <span style={{ textDecoration: 'line-through', color: 'var(--ink-2)' }}>Je veux un café.</span>
            <span className="small" style={{ color: 'var(--blue-dark)', fontWeight: 600 }}>Better</span>
            <strong>Je voudrais un café.</strong>
            <p className="alert info small">"Voudrais" is the polite way to ask, like "चाहूँगा" instead of "चाहिए".</p>
          </section>
          <section className="card tight stack" style={{ gap: 8 }}>
            <span className="eyebrow">How it will work</span>
            <ul className="checklist small">
              <li>Same speech engine as Live Translate (Whisper)</li>
              <li>An open-source LLM plays the tutor and checks your sentences</li>
              <li>An open-source talking-head model animates a realistic face</li>
            </ul>
          </section>
        </div>
      </div>
    </>
  );
}
