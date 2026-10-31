import { useEffect, useRef, useState } from 'react';
import { LiveTranslator } from '../audio.js';
import { useAuth } from '../auth.jsx';
import Icon from '../components/Icons.jsx';
import { LanguageSelect, Switch } from '../components/ui.jsx';
import { langName } from '../languages.js';

function closeReason(code) {
  if (code === 4402) return 'No minutes left this month.';
  if (code === 4401) return 'Please log in again.';
  if (code === 1011) return 'The translation server hit a problem or took too long (code 1011). Look at the server log, then press Start talking again.';
  return `Lost the connection to the translation server (code ${code}). Is it still running? Press Start talking to try again.`;
}

export default function Try() {
  const { user, refresh } = useAuth();
  const [src, setSrc] = useState(user.speaks || 'hi');
  const [tgt, setTgt] = useState(user.speaks === 'en' ? 'hi' : 'en');
  const [speak, setSpeak] = useState(true);
  const [live, setLive] = useState(false);
  const [level, setLevel] = useState(0);
  const [speaking, setSpeaking] = useState(false);
  const [lines, setLines] = useState([]);
  const [info, setInfo] = useState(null);
  const [error, setError] = useState('');
  const [pending, setPending] = useState(0);
  const [notice, setNotice] = useState('');
  const [micHint, setMicHint] = useState(false);
  const translator = useRef(null);
  const heardSomething = useRef(false);

  useEffect(() => () => translator.current?.stop(), []);

  function onEvent(msg) {
    switch (msg.type) {
      case 'level':
        setLevel(msg.value);
        if (msg.value > 0.05 && !heardSomething.current) {
          heardSomething.current = true;
          setMicHint(false);
        }
        break;
      case 'ready':
        setInfo(msg);
        setError('');
        break;
      case 'vad':
        setSpeaking(msg.speaking);
        if (msg.speaking) setNotice('');
        break;
      case 'status':
        setPending(msg.pending || 0);
        break;
      case 'notice':
        setNotice(msg.message || '');
        break;
      case 'result':
        setNotice('');
        setLines((l) => [{ ...msg, at: Date.now() }, ...l].slice(0, 30));
        break;
      case 'usage':
        refresh();
        break;
      case 'error':
        setError(msg.message || 'Something went wrong.');
        break;
      case 'closed':
        // Still set means we did not press Stop: the connection dropped.
        if (translator.current) {
          translator.current.stop();
          translator.current = null;
          setError(closeReason(msg.code));
        }
        setLive(false);
        setSpeaking(false);
        setPending(0);
        setLevel(0);
        break;
    }
  }

  async function start() {
    setError('');
    setNotice('');
    setPending(0);
    try {
      const t = new LiveTranslator({ src, tgt, speak, onEvent });
      translator.current = t;
      await t.start();
      setLive(true);
      heardSomething.current = false;
      setMicHint(false);
      setTimeout(() => {
        if (translator.current === t && !heardSomething.current) setMicHint(true);
      }, 8000);
    } catch (err) {
      setError(err.name === 'NotAllowedError' ? 'Please allow the microphone to try the translator.' : err.message);
    }
  }

  function stop() {
    translator.current?.stop();
    translator.current = null;
    setLive(false);
    setLevel(0);
    setSpeaking(false);
  }

  function swap() {
    setSrc(tgt);
    setTgt(src);
    translator.current?.setLanguages(tgt, src);
  }

  function changeSrc(v) {
    setSrc(v);
    translator.current?.setLanguages(v, tgt);
  }

  function changeTgt(v) {
    setTgt(v);
    translator.current?.setLanguages(src, v);
  }

  return (
    <>
      <div className="page-head">
        <div className="stack" style={{ gap: 4 }}>
          <h1>Try the translator</h1>
          <p className="muted">Speak into your microphone and hear yourself in another language. This is the same engine the extension uses on calls.</p>
        </div>
      </div>

      <section className="card stack" style={{ gap: 20 }}>
        <div className="lang-pair">
          <LanguageSelect id="try-src" label="I speak" value={src} onChange={changeSrc} />
          <button type="button" className="swap-btn" aria-label="Swap languages" onClick={swap}><Icon name="swap" /></button>
          <LanguageSelect id="try-tgt" label="Translate to" value={tgt} onChange={changeTgt} />
        </div>
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <div className="row">
            <Switch checked={speak} onChange={setSpeak} label="Speak the translation out loud" />
            <span>Speak the translation out loud</span>
          </div>
          <div className="row">
            {live && (
              <>
                <span className="small muted">{speaking ? 'Listening…' : pending > 0 ? 'Translating…' : 'Waiting for you to speak'}</span>
                <div className="meter" aria-hidden="true"><div style={{ width: `${Math.round(level * 100)}%` }} /></div>
              </>
            )}
            <button type="button" className={`mic-btn ${live ? 'live' : ''}`} onClick={live ? stop : start}>
              <Icon name={live ? 'stop' : 'mic'} size={22} />
              {live ? 'Stop' : 'Start talking'}
            </button>
          </div>
        </div>
        {error && <p className="alert error" role="alert">{error}</p>}
        {!error && notice && <p className="alert info">{notice}</p>}
        {live && micHint && (
          <p className="alert info">
            We can't hear anything from your microphone. If the blue bar does not move when you talk, Chrome is using the wrong
            microphone: click the mic icon in the address bar and pick another one, then press Stop and Start talking again.
          </p>
        )}
        {info && (
          <p className="tiny">
            Connected · engines: {info.engines.asr}, {info.engines.mt}, {info.engines.tts}
            {info.speech ? '' : ` · no ${langName(info.tgt)} voice yet, showing text only`}
          </p>
        )}
        <p className="tiny">Tip: use headphones. The microphone pauses while the translation plays, so finish your sentence and wait a moment.</p>
      </section>

      <section className="card stack" aria-live="polite" aria-labelledby="out-h">
        <h2 id="out-h">What you said</h2>
        {pending > 0 && (
          <p className="alert info">
            Translating {pending === 1 ? 'your sentence' : `${pending} sentences`}… On a laptop without a graphics card this can take
            several seconds, and the first sentence in each language is the slowest.
          </p>
        )}
        {lines.length === 0 ? (
          <p className="empty">Your sentences and their translations show up here.</p>
        ) : (
          <div className="transcript">
            {lines.map((l) => (
              <div key={`${l.at}-${l.id}`} className="line">
                <span className="tiny">{langName(l.src)} → {langName(l.tgt)}</span>
                <span className="big">{l.translated_text}</span>
                <span className="muted">{l.source_text}</span>
                <span className="timings">
                  heard in {l.timings_ms.asr} ms · translated in {l.timings_ms.mt} ms
                  {l.timings_ms.tts != null ? ` · voice in ${l.timings_ms.tts} ms` : ''}
                  {l.voice_cloned ? ' · your voice' : ''}
                </span>
              </div>
            ))}
          </div>
        )}
      </section>
    </>
  );
}
