import { useEffect, useRef, useState } from 'react';
import Icon from '../components/Icons.jsx';
import { LanguageSelect } from '../components/ui.jsx';
import { API_URL, getToken } from '../api.js';
import { langName } from '../languages.js';

// A pretend call on this page, built like Google Meet:
//   * the page asks for the microphone as soon as it opens, before any click
//   * "you" and a pretend "other person" are joined by WebRTC
//   * the other person says a test sentence; you hear it through an <audio> element
// The BolBridge extension hooks this page exactly as it hooks a real call, so
// both directions can be checked without calling anyone.

const RELOAD_KEY = 'bolbridge.testReloaded';

function hookInfo() {
  return typeof window !== 'undefined' ? window.__bolbridgeMain || null : null;
}

export default function ExtensionTest() {
  const [hook] = useState(hookInfo);
  const [theirLang, setTheirLang] = useState('en');
  const [mic, setMic] = useState({ state: 'asking', label: '' });
  const [call, setCall] = useState('idle'); // idle | connecting | live | ended
  const [error, setError] = useState('');
  const [sentence, setSentence] = useState('');
  const [level, setLevel] = useState(0);
  const [listen, setListen] = useState(false);
  const [theyTalking, setTheyTalking] = useState(false);
  const refs = useRef({});

  // Content scripts load only when a page loads, not when an app switches
  // pages in place, so reload once if the extension is not here yet.
  useEffect(() => {
    if (hook) {
      sessionStorage.removeItem(RELOAD_KEY);
      return;
    }
    if (!sessionStorage.getItem(RELOAD_KEY)) {
      sessionStorage.setItem(RELOAD_KEY, '1');
      window.location.reload();
    }
  }, [hook]);

  // Like Meet's "ready to join" screen: ask for the mic straight away.
  useEffect(() => {
    let cancelled = false;
    navigator.mediaDevices
      .getUserMedia({ audio: true })
      .then((stream) => {
        if (cancelled) return stream.getTracks().forEach((t) => t.stop());
        refs.current.local = stream;
        setMic({ state: 'ready', label: stream.getAudioTracks()[0]?.label || '' });
      })
      .catch(() => setMic({ state: 'blocked', label: '' }));
    return () => {
      cancelled = true;
      endCall();
      refs.current.local?.getTracks().forEach((t) => t.stop());
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function loadSentence(lang) {
    const res = await fetch(`${API_URL}/api/test-speech?lang=${encodeURIComponent(lang)}`, {
      headers: { Authorization: `Bearer ${getToken()}` },
    });
    if (!res.ok) throw new Error(res.status === 422 ? `No ${langName(lang)} voice yet. Pick another language.` : 'Could not load the test sentence.');
    const text = res.headers.get('X-Test-Sentence');
    setSentence(text ? decodeURIComponent(text) : '');
    return res.arrayBuffer();
  }

  async function startCall() {
    setError('');
    if (!refs.current.local) {
      setError('Allow the microphone first (click the mic icon in the address bar).');
      return;
    }
    setCall('connecting');
    try {
      const ac = new AudioContext();
      const wav = await loadSentence(theirLang);
      const buffer = await ac.decodeAudioData(wav);

      // The other person's microphone: the test sentence.
      const theirMic = ac.createMediaStreamDestination();
      // What they hear from you, measured (and played if "Listen as them" is on).
      const analyser = ac.createAnalyser();
      const listenGain = ac.createGain();
      listenGain.gain.value = 0;
      listenGain.connect(ac.destination);

      const pcYou = new RTCPeerConnection();
      const pcThem = new RTCPeerConnection({ bolbridgeIgnore: true }); // the extension leaves the pretend person alone
      pcYou.onicecandidate = (e) => e.candidate && pcThem.addIceCandidate(e.candidate);
      pcThem.onicecandidate = (e) => e.candidate && pcYou.addIceCandidate(e.candidate);

      // You hear them the way Meet plays people: through an <audio> element.
      pcYou.ontrack = (e) => {
        const el = new Audio();
        el.srcObject = e.streams[0] || new MediaStream([e.track]);
        el.play().catch(() => {});
        refs.current.theirEl = el;
      };
      pcThem.ontrack = (e) => {
        const stream = e.streams[0] || new MediaStream([e.track]);
        const keeper = new Audio();
        keeper.muted = true;
        keeper.srcObject = stream;
        keeper.play().catch(() => {});
        const src = ac.createMediaStreamSource(stream);
        src.connect(analyser);
        src.connect(listenGain);
        refs.current.keeper = keeper;
      };

      refs.current.local.getTracks().forEach((t) => pcYou.addTrack(t, refs.current.local));
      theirMic.stream.getTracks().forEach((t) => pcThem.addTrack(t, theirMic.stream));

      const offer = await pcYou.createOffer();
      await pcYou.setLocalDescription(offer);
      await pcThem.setRemoteDescription(offer);
      const answer = await pcThem.createAnswer();
      await pcThem.setLocalDescription(answer);
      await pcYou.setRemoteDescription(answer);

      const data = new Float32Array(2048);
      const timer = setInterval(() => {
        analyser.getFloatTimeDomainData(data);
        let sum = 0;
        for (const v of data) sum += v * v;
        setLevel(Math.min(1, Math.sqrt(sum / data.length) * 6));
      }, 120);

      Object.assign(refs.current, { ac, buffer, theirMic, listenGain, pcYou, pcThem, timer });
      setCall('live');
      setTimeout(() => theySpeak(), 1500);
    } catch (e) {
      setError(e.message || 'Could not start the test call.');
      endCall();
      setCall('idle');
    }
  }

  function theySpeak() {
    const { ac, buffer, theirMic } = refs.current;
    if (!ac || !buffer) return;
    const node = ac.createBufferSource();
    node.buffer = buffer;
    node.connect(theirMic);
    node.onended = () => setTheyTalking(false);
    setTheyTalking(true);
    node.start();
  }

  function toggleListen() {
    const next = !listen;
    setListen(next);
    if (refs.current.listenGain) refs.current.listenGain.gain.value = next ? 1 : 0;
  }

  function endCall() {
    const r = refs.current;
    clearInterval(r.timer);
    r.pcYou?.close();
    r.pcThem?.close();
    if (r.theirEl) r.theirEl.srcObject = null;
    if (r.keeper) r.keeper.srcObject = null;
    r.ac?.close().catch(() => {});
    Object.assign(r, { ac: null, buffer: null, pcYou: null, pcThem: null, timer: null, theirEl: null, keeper: null, listenGain: null });
    setLevel(0);
    setListen(false);
    setTheyTalking(false);
  }

  return (
    <div className="stack" style={{ gap: 24, maxWidth: 820 }}>
      <div className="stack" style={{ gap: 4 }}>
        <h1>Test the extension</h1>
        <p className="muted">A pretend call on this page, built like Google Meet. Check both directions without calling anyone.</p>
      </div>

      <section className="card stack" aria-labelledby="check-h">
        <h2 id="check-h">1. Is BolBridge on this page?</h2>
        {hook ? (
          <p className="row" style={{ gap: 8 }}>
            <span className="dot" /> Yes, extension {hook.version ? `v${hook.version}` : ''} is active here.
          </p>
        ) : (
          <div className="alert error stack" style={{ gap: 6 }}>
            <strong>The extension is not active on this page.</strong>
            <span>Update the BolBridge extension to version 0.3 or newer, reload it in chrome://extensions, then reload this page.</span>
            <button type="button" className="btn outline" onClick={() => window.location.reload()} style={{ alignSelf: 'flex-start' }}>Reload page</button>
          </div>
        )}
        <p className="row" style={{ gap: 8 }}>
          <span className={`dot ${mic.state === 'ready' ? '' : 'off'}`} />
          {mic.state === 'ready' ? 'Microphone ready (asked before any click, like Meet).' : mic.state === 'asking' ? 'Asking for the microphone…' : 'Microphone blocked: allow it from the mic icon in the address bar, then reload.'}
        </p>
      </section>

      <section className="card stack" aria-labelledby="setup-h">
        <h2 id="setup-h">2. Set the languages</h2>
        <p className="muted small">In the extension popup, turn <strong>Translation on</strong> and set <strong>They speak</strong> to the same language as here. Wear headphones.</p>
        <div style={{ maxWidth: 320 }}>
          <LanguageSelect id="their-lang" label="The pretend person speaks" value={theirLang} onChange={setTheirLang} />
        </div>
      </section>

      <section className="card stack" aria-labelledby="call-h">
        <h2 id="call-h">3. Start the test call</h2>
        {error && <p className="alert error" role="alert">{error}</p>}
        {call !== 'live' ? (
          <button type="button" className="btn primary" onClick={startCall} disabled={call === 'connecting' || !hook} style={{ alignSelf: 'flex-start' }}>
            <Icon name="play" size={18} />
            {call === 'connecting' ? 'Connecting…' : 'Start test call'}
          </button>
        ) : (
          <div className="stack" style={{ gap: 20 }}>
            <div className="stack" style={{ gap: 6 }}>
              <strong>They say ({langName(theirLang)})</strong>
              <p className="muted" style={{ margin: 0 }}>{sentence || '…'}</p>
              <p className="small" style={{ margin: 0 }}>
                You should hear this <strong>translated into your language</strong>, not the original. It takes a few seconds.
              </p>
              <button type="button" className="btn outline" onClick={theySpeak} disabled={theyTalking} style={{ alignSelf: 'flex-start' }}>
                <Icon name="speaker" size={18} />
                {theyTalking ? 'They are speaking…' : 'Make them speak again'}
              </button>
            </div>

            <div className="stack" style={{ gap: 6 }}>
              <strong>What they hear from you</strong>
              <p className="small" style={{ margin: 0 }}>
                Say one short sentence in your language, then stop and wait. The bar moves when your <strong>translated voice</strong> reaches them.
              </p>
              <div className="row" style={{ gap: 12 }}>
                <div className="meter" role="img" aria-label="What they hear from you"><div style={{ width: `${Math.round(level * 100)}%` }} /></div>
                <button type="button" className="btn outline" onClick={toggleListen} aria-pressed={listen}>
                  <Icon name="headphones" size={18} />
                  {listen ? 'Stop listening as them' : 'Listen as them'}
                </button>
              </div>
            </div>

            <p className="alert info" style={{ margin: 0 }}>
              Open the BolBridge popup and expand <strong>Diagnostics</strong> to see each step. If something is red, press <strong>Copy diagnostics</strong> and send it for help.
            </p>
            <button
              type="button"
              className="btn dark"
              onClick={() => {
                endCall();
                setCall('idle');
              }}
              style={{ alignSelf: 'flex-start' }}
            >
              <Icon name="stop" size={18} />
              End test call
            </button>
          </div>
        )}
      </section>
    </div>
  );
}
