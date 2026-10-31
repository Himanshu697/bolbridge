import { useEffect, useRef, useState } from 'react';
import { api } from '../api.js';
import { useAuth } from '../auth.jsx';
import { VoiceRecorder } from '../audio.js';
import Icon from '../components/Icons.jsx';
import { Switch } from '../components/ui.jsx';

const SCRIPT = {
  hi: 'नमस्ते, मेरा नाम ___ है। मैं BolBridge पर अपनी आवाज़ रिकॉर्ड कर रहा हूँ, ताकि लोग मुझे मेरी अपनी आवाज़ में उनकी भाषा में सुन सकें। आज मौसम बहुत अच्छा है और मैं अपने दोस्तों से बात करने के लिए उत्साहित हूँ। एक, दो, तीन, चार, पाँच।',
  en: "Hello, my name is ___. I'm recording my voice on BolBridge so people can hear me in their own language, in my own voice. The weather is lovely today, and I'm looking forward to talking with my friends. One, two, three, four, five.",
};

const TARGET = 30;

export default function Voice() {
  const { user, refresh } = useAuth();
  const [voice, setVoice] = useState(null);
  const [consent, setConsent] = useState(false);
  const [recording, setRecording] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const [level, setLevel] = useState(0);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState(null);
  const recorder = useRef(null);
  const timer = useRef(null);

  useEffect(() => {
    api('/api/voice').then(setVoice).catch(() => {});
    return () => {
      clearInterval(timer.current);
      recorder.current?.stop();
    };
  }, []);

  async function start() {
    setMessage(null);
    try {
      const r = new VoiceRecorder(setLevel);
      await r.start();
      recorder.current = r;
      setRecording(true);
      setSeconds(0);
      timer.current = setInterval(() => {
        const s = r.seconds;
        setSeconds(s);
        if (s >= TARGET) finish();
      }, 250);
    } catch (err) {
      setMessage({ kind: 'error', text: err.name === 'NotAllowedError' ? 'Please allow the microphone.' : err.message });
    }
  }

  async function finish() {
    clearInterval(timer.current);
    const r = recorder.current;
    recorder.current = null;
    if (!r) return;
    setRecording(false);
    setLevel(0);
    const blob = await r.stop();
    setBusy(true);
    try {
      const form = new FormData();
      form.append('file', blob, 'voice.wav');
      const res = await api('/api/voice', { method: 'POST', form });
      setVoice(res);
      setMessage({
        kind: 'info',
        text: res.status === 'ready'
          ? 'Done. Translations will now sound like you.'
          : 'Saved. Voice cloning turns on when the voice service is running (see voice-clone-service/README.md).',
      });
    } catch (err) {
      setMessage({ kind: 'error', text: err.message });
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    await api('/api/voice', { method: 'DELETE' });
    setVoice({ has_voice: false, cloning_available: voice?.cloning_available });
    setMessage({ kind: 'info', text: 'Your voice sample was deleted.' });
  }

  async function toggleUse(value) {
    await api('/api/me', { method: 'PATCH', body: { use_my_voice: value } });
    refresh();
  }

  return (
    <>
      <div className="page-head">
        <div className="stack" style={{ gap: 4 }}>
          <h1>My voice</h1>
          <p className="muted">Record 30 seconds so translations sound like you, not like a robot.</p>
        </div>
      </div>

      <section className="card stack" style={{ gap: 16 }}>
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <div className="stack" style={{ gap: 2 }}>
            <strong>Speak in my own voice</strong>
            <span className="small muted">{voice?.has_voice ? `Sample saved, ${Math.round(voice.seconds)} seconds · ${voice.status === 'ready' ? 'cloning active' : 'waiting for the voice service'}` : 'No sample yet'}</span>
          </div>
          <Switch checked={!!user.use_my_voice} onChange={toggleUse} label="Speak in my own voice" />
        </div>
        {!voice?.cloning_available && (
          <p className="alert info">The voice-clone service is not running on this server, so calls use a natural stock voice for now. Your sample is kept for when it is switched on.</p>
        )}
      </section>

      <section className="card stack" style={{ gap: 16 }}>
        <h2>Record your sample</h2>
        <p className="muted">Read this out loud in a quiet room, at your normal speed:</p>
        <blockquote style={{ margin: 0, background: 'var(--bg)', borderRadius: 16, padding: '16px 20px', fontSize: 18, lineHeight: 1.6 }}>
          {SCRIPT[user.speaks] || SCRIPT.en}
        </blockquote>
        <label className="check">
          <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} disabled={recording} />
          <span>This is my own voice. I allow BolBridge to use it only to speak my translations, and I can delete it at any time.</span>
        </label>
        <div className="row">
          {!recording ? (
            <button type="button" className="mic-btn" onClick={start} disabled={!consent || busy}>
              <Icon name="mic" size={22} />
              {voice?.has_voice ? 'Record again' : 'Start recording'}
            </button>
          ) : (
            <button type="button" className="mic-btn live" onClick={finish}>
              <Icon name="stop" size={22} />
              Stop ({Math.floor(seconds)} / {TARGET} s)
            </button>
          )}
          {recording && <div className="meter" aria-hidden="true"><div style={{ width: `${Math.round(level * 100)}%` }} /></div>}
          {busy && <span className="muted">Saving…</span>}
          {voice?.has_voice && !recording && (
            <button type="button" className="btn outline" onClick={remove}><Icon name="trash" size={18} />Delete my voice</button>
          )}
        </div>
        {message && <p className={`alert ${message.kind}`} role="status">{message.text}</p>}
      </section>
    </>
  );
}
