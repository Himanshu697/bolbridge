import { useState } from 'react';
import Icon from '../components/Icons.jsx';
import { Logo } from '../components/ui.jsx';
import { Link } from '../router.jsx';

const PLANS = {
  IN: [
    { name: 'Free', price: '₹0', per: 'to start', blurb: '15 minutes every month', features: ['Hindi, English and 14 more languages', 'WhatsApp Web, OmeTV, Google Meet', 'Natural AI voice'], cta: 'Start free' },
    { name: 'Basic', price: '₹299', per: '/ month', blurb: '100 minutes every month', features: ['All languages', 'Remembers each contact’s language', 'Call history'], cta: 'Choose Basic' },
    { name: 'Pro', price: '₹799', per: '/ month', blurb: '300 minutes every month', features: ['Speak in your own voice', 'Everything in Basic', 'Priority processing'], cta: 'Choose Pro', rec: true },
  ],
  INTL: [
    { name: 'Free', price: '$0', per: 'to start', blurb: '15 minutes every month', features: ['English, Hindi and 14 more languages', 'WhatsApp Web, OmeTV, Google Meet', 'Natural AI voice'], cta: 'Start free' },
    { name: 'Basic', price: '$9', per: '/ month', blurb: '100 minutes every month', features: ['All languages', 'Remembers each contact’s language', 'Call history'], cta: 'Choose Basic' },
    { name: 'Pro', price: '$19', per: '/ month', blurb: '300 minutes every month', features: ['Speak in your own voice', 'Everything in Basic', 'Priority processing'], cta: 'Choose Pro', rec: true },
  ],
};

function Check({ color = '#3D4BFF' }) {
  return <Icon name="check" size={18} stroke={2.5} color={color} />;
}

export default function Landing() {
  const [region, setRegion] = useState('IN');
  return (
    <>
      <header className="site-header">
        <nav className="container site-nav" aria-label="Main">
          <Logo />
          <div className="links">
            <a href="#products">Live Translate</a>
            <a href="#products">Learn</a>
            <a href="#products">Video Chat</a>
            <a href="#pricing">Pricing</a>
          </div>
          <div className="row">
            <Link to="/auth?mode=login" className="btn link" style={{ color: 'var(--ink)' }}>Log in</Link>
            <Link to="/auth?product=translate" className="btn primary">Get started</Link>
          </div>
        </nav>
      </header>

      <section className="container hero">
        <div className="stack" style={{ gap: 24 }}>
          <span className="pill blue" style={{ alignSelf: 'flex-start', fontSize: 14 }}>Real-time voice translation, in your own voice</span>
          <h1>Speak your language.<br />Be heard in theirs.</h1>
          <p className="lead">BolBridge translates your calls live on WhatsApp Web, OmeTV, Google Meet and more. You speak Hindi, they hear French in your own voice. They reply in French, you hear Hindi.</p>
          <div className="row">
            <Link to="/auth?product=translate" className="btn primary lg"><Icon name="puzzle" />Add to Chrome, it's free</Link>
            <a href="#how" className="btn outline lg">See how it works</a>
          </div>
          <p className="tiny">15 free minutes · Nothing to install for the person you call</p>
        </div>
        <div>
          <div className="demo" aria-label="Example of a translated call">
            <div className="row" style={{ justifyContent: 'space-between' }}>
              <strong className="row" style={{ gap: 8, fontSize: 15 }}><span className="dot" />Live call · translating both ways</strong>
              <span className="pill outline" style={{ fontWeight: 500 }}>WhatsApp Web</span>
            </div>
            <div className="row">
              <div className="person"><span className="avatar blue">H</span><span><strong>Himanshu</strong><br /><span className="tiny">speaks Hindi</span></span></div>
              <div className="person"><span className="avatar orange">C</span><span><strong>Camille</strong><br /><span className="tiny">speaks French</span></span></div>
            </div>
            <div className="stack" style={{ gap: 6, alignItems: 'flex-start' }}>
              <span className="eyebrow" style={{ fontSize: 12 }}>Himanshu says · Hindi</span>
              <div className="bubble me">नमस्ते! आज तुम्हारा दिन कैसा रहा?</div>
              <span className="row" style={{ gap: 6, fontSize: 13, color: 'var(--blue-dark)', fontWeight: 600 }}><Icon name="down" size={16} />Camille hears it in French, in Himanshu's voice</span>
              <div className="bubble out">Bonjour ! Comment s'est passée ta journée ?</div>
            </div>
            <div className="stack" style={{ gap: 6, alignItems: 'flex-end', textAlign: 'right' }}>
              <span className="eyebrow" style={{ fontSize: 12 }}>Camille says · French</span>
              <div className="bubble them">Très bien, merci ! Je viens à Delhi la semaine prochaine.</div>
              <span className="row" style={{ gap: 6, fontSize: 13, color: 'var(--orange-text)', fontWeight: 600 }}><Icon name="down" size={16} />Himanshu hears it in Hindi</span>
              <div className="bubble out">बहुत बढ़िया, शुक्रिया! मैं अगले हफ्ते दिल्ली आ रही हूँ।</div>
            </div>
          </div>
        </div>
      </section>

      <section id="products" className="section white">
        <div className="container">
          <div className="section-head">
            <h2>One app. Three ways to talk to the world.</h2>
            <p>Pick what you need. Sign-up takes half a minute and takes you straight to it.</p>
          </div>
          <div className="cards">
            <article className="product featured">
              <div className="row" style={{ justifyContent: 'space-between' }}>
                <span className="icon-tile" style={{ background: 'var(--blue)', color: '#fff' }}><Icon name="globe" size={26} /></span>
                <span className="pill blue">Browser extension · Available first</span>
              </div>
              <div className="stack" style={{ gap: 8 }}>
                <h3>Live Translate</h3>
                <p className="muted">Turn BolBridge on during any web call. Your voice reaches them in their language, and they don't need to install anything.</p>
              </div>
              <div className="row" style={{ gap: 8 }}>
                {['WhatsApp Web', 'OmeTV', 'Google Meet', 'Zoom on the web'].map((s) => <span key={s} className="pill outline">{s}</span>)}
              </div>
              <ul className="checklist">
                <li><Check />Speak in your own voice (voice clone)</li>
                <li><Check />Understands Hinglish</li>
                <li><Check />Remembers each contact's language</li>
              </ul>
              <Link to="/auth?product=translate" className="btn primary cta">Start with Live Translate <Icon name="arrow" size={18} /></Link>
            </article>
            <article className="product">
              <div className="row" style={{ justifyContent: 'space-between' }}>
                <span className="icon-tile" style={{ background: 'var(--orange)', color: 'var(--ink)' }}><Icon name="book" size={26} /></span>
                <span className="pill orange">Coming next</span>
              </div>
              <div className="stack" style={{ gap: 8 }}>
                <h3>Learn with an AI tutor</h3>
                <p className="muted">Practise any language face to face with a lifelike AI tutor. It talks, listens, corrects you gently and remembers your progress.</p>
              </div>
              <ul className="checklist">
                <li><Check color="#B4500C" />Realistic human avatar, live on video</li>
                <li><Check color="#B4500C" />Real conversations, not just flashcards</li>
                <li><Check color="#B4500C" />Explains in Hindi when you're stuck</li>
              </ul>
              <Link to="/auth?product=learn" className="btn outline cta">Join the waitlist <Icon name="arrow" size={18} /></Link>
            </article>
            <article className="product dark">
              <div className="row" style={{ justifyContent: 'space-between' }}>
                <span className="icon-tile" style={{ background: '#fff', color: 'var(--ink)' }}><Icon name="video" size={26} /></span>
                <span className="pill" style={{ background: '#262A3D', color: '#E4E7F1' }}>Coming later</span>
              </div>
              <div className="stack" style={{ gap: 8 }}>
                <h3>Talk to the World</h3>
                <p>Meet new people on random video chat. Everyone speaks their own language and live translation does the rest.</p>
              </div>
              <ul className="checklist">
                <li><Check color="#FFB27A" />Pick a country or a language</li>
                <li><Check color="#FFB27A" />Translated voice and live subtitles</li>
                <li><Check color="#FFB27A" />Safety tools: skip, report, blur</li>
              </ul>
              <Link to="/auth?product=chat" className="btn cta" style={{ background: '#fff', color: 'var(--ink)' }}>Join the waitlist <Icon name="arrow" size={18} /></Link>
            </article>
          </div>
        </div>
      </section>

      <section id="how" className="container section">
        <div className="section-head">
          <h2>Live Translate in three steps</h2>
          <p>No settings maze. Turn it on when the call starts.</p>
        </div>
        <div className="cards" style={{ marginBottom: 24 }}>
          {[
            ['Add the extension', 'Install BolBridge in Chrome and record 30 seconds of your voice. The voice step is optional.'],
            ['Open your call', 'Answer on WhatsApp Web, OmeTV or Google Meet. BolBridge notices the call on its own.'],
            ['Pick their language', 'Choose French, English, Japanese or another language and start talking. Translation runs both ways.'],
          ].map(([title, text], i) => (
            <div key={title} className="card stack">
              <span className="step-num">{i + 1}</span>
              <h3 style={{ fontSize: 20 }}>{title}</h3>
              <p className="muted">{text}</p>
            </div>
          ))}
        </div>
        <div className="card flow">
          <div>
            <span className="icon-tile" style={{ width: 64, height: 64, borderRadius: 999, background: 'var(--blue-tint)', color: 'var(--blue-dark)' }}><Icon name="mic" size={28} /></span>
            <strong>You speak Hindi</strong>
            <span className="tiny">on your laptop</span>
          </div>
          <Icon name="arrow" size={32} color="#5C6378" />
          <div className="engine">
            <strong style={{ fontFamily: 'var(--display)', fontSize: 18 }}>BolBridge</strong>
            <span className="small" style={{ color: 'var(--on-dark-2)' }}>listens · translates · speaks in your voice</span>
          </div>
          <Icon name="arrow" size={32} color="#5C6378" />
          <div>
            <span className="icon-tile" style={{ width: 64, height: 64, borderRadius: 999, background: 'var(--orange-tint)', color: 'var(--orange-text)' }}><Icon name="headphones" size={28} /></span>
            <strong>Your friend hears French</strong>
            <span className="tiny">on their normal phone, no app</span>
          </div>
        </div>
      </section>

      <section id="pricing" className="section white">
        <div className="container">
          <div className="row" style={{ justifyContent: 'space-between', alignItems: 'flex-end', marginBottom: 32 }}>
            <div className="section-head" style={{ marginBottom: 0 }}>
              <h2>Start free. Pay when you talk more.</h2>
              <p>Prices are set for your region, so they stay fair in India.</p>
            </div>
            <div className="segmented" role="group" aria-label="Pricing region">
              <button type="button" aria-pressed={region === 'IN'} onClick={() => setRegion('IN')}>India (₹)</button>
              <button type="button" aria-pressed={region === 'INTL'} onClick={() => setRegion('INTL')}>International ($)</button>
            </div>
          </div>
          <div className="cards">
            {PLANS[region].map((p) => (
              <div key={p.name} className="product" style={{ border: p.rec ? '2px solid var(--blue)' : undefined }}>
                <div className="row" style={{ justifyContent: 'space-between', minHeight: 28 }}>
                  <h3 style={{ fontSize: 20 }}>{p.name}</h3>
                  {p.rec && <span className="pill" style={{ background: 'var(--blue)', color: '#fff' }}>Recommended</span>}
                </div>
                <div className="row" style={{ alignItems: 'baseline', gap: 6 }}>
                  <span className="price">{p.price}</span>
                  <span className="tiny">{p.per}</span>
                </div>
                <p style={{ fontWeight: 600, color: 'var(--blue-dark)' }}>{p.blurb}</p>
                <ul className="checklist">
                  {p.features.map((f) => <li key={f} className="muted"><Check />{f}</li>)}
                </ul>
                <Link to="/auth?product=translate" className={`btn cta ${p.rec ? 'primary' : 'outline'}`}>{p.cta}</Link>
              </div>
            ))}
          </div>
          <p className="muted" style={{ marginTop: 24 }}>Need more? Minute packs from {region === 'IN' ? '₹8' : '$0.15'} per minute. Businesses and call centres get per-minute plans: talk to us.</p>
        </div>
      </section>

      <section className="container section">
        <div className="section-head"><h2>Built so people can trust it</h2></div>
        <div className="cards">
          {[
            ['lock', "Your audio isn't stored", 'Calls are translated on the fly. Nothing is saved unless you choose to.'],
            ['user', 'Your voice, your permission', 'Voice cloning only works for the account owner, and you can delete it any time.'],
            ['shield', 'Built for India', 'Designed for the DPDP Act from day one. Servers in India.'],
            ['message', 'Optional translated-call notice', 'Let the other person know the call is translated, with one switch.'],
          ].map(([icon, title, text]) => (
            <div key={title} className="card stack" style={{ gap: 10 }}>
              <Icon name={icon} size={26} color="#3D4BFF" />
              <h3 style={{ fontSize: 18, fontFamily: 'var(--font)' }}>{title}</h3>
              <p className="muted small">{text}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="container" style={{ paddingBottom: 88 }}>
        <div className="cta-band">
          <h2>Your first conversation in another language is two minutes away.</h2>
          <Link to="/auth?product=translate" className="btn orange lg">Add to Chrome, it's free</Link>
        </div>
      </section>

      <footer className="site-footer">
        <div className="container">
          <div className="row"><Logo /><span className="tiny">· Made in Gurugram, India</span></div>
          <div className="row" style={{ gap: '8px 24px' }}>
            <a href="#products">Products</a>
            <a href="#pricing">Pricing</a>
            <a href="#how">Privacy</a>
            <a href="#how">Terms</a>
            <a href="mailto:hello@bolbridge.app">Contact</a>
          </div>
        </div>
      </footer>
    </>
  );
}
