import Icon from '../components/Icons.jsx';
import { Silhouette } from '../components/ui.jsx';
import { Waitlist } from './Learn.jsx';

export default function Chat() {
  return (
    <>
      <div className="page-head">
        <div className="stack" style={{ gap: 4 }}>
          <span className="pill gray" style={{ alignSelf: 'flex-start' }}>Coming later</span>
          <h1>Talk to the World</h1>
          <p className="muted">Random video chat where everyone speaks their own language. Until it opens, use Live Translate on OmeTV.</p>
        </div>
        <Waitlist product="chat" />
      </div>

      <div className="tile-row">
        <div style={{ flex: '999 1 560px' }} className="stack">
          <div className="stage">
            <Silhouette label="Preview: the other person's video goes here" />
            <span className="tag"><strong>Lucas</strong> · Brazil · speaks Portuguese</span>
            <div className="self">You</div>
            <div className="subs">
              <span className="big">हाय! तुम भारत में कहाँ से हो?</span>
              <span className="small">Original (Portuguese): Oi! De que parte da Índia você é?</span>
            </div>
          </div>
          <div className="card tight row" style={{ justifyContent: 'space-between' }}>
            <div className="row">
              <button type="button" className="btn outline" disabled><Icon name="flag" size={18} />Report</button>
              <button type="button" className="btn outline" disabled>Blur my video</button>
            </div>
            <button type="button" className="btn orange lg" disabled>Next person <Icon name="next" size={20} /></button>
          </div>
        </div>
        <section className="card tight stack" style={{ flex: '1 1 300px', background: 'var(--ink)', color: '#fff', borderColor: 'var(--ink)' }}>
          <h2 style={{ fontSize: 18 }}>Safety comes first</h2>
          <ul style={{ margin: 0, paddingLeft: 18, color: 'var(--on-dark-2)' }} className="stack">
            <li>Adults 18 and over only</li>
            <li>Skip anyone with Next, report with one tap</li>
            <li>Calls are never recorded</li>
            <li>Automatic checks for nudity and abuse before launch</li>
          </ul>
        </section>
      </div>
    </>
  );
}
