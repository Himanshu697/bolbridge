// BolBridge: runs inside the call page itself (MAIN world), before the page's
// own scripts, so it can sit between the page and the microphone / speakers.
//
// Outgoing: the page asks for the microphone -> we hand it a stream we control.
//   Translation off: your real voice passes through.
//   Translation on:  your voice goes to the server; the translated speech is
//                    what the other person hears.
// Incoming: every remote audio track the page receives over WebRTC is also
//   sent to the server; the translation plays to you, and the original voice
//   is turned down (or muted).
//
// This script cannot use chrome.* APIs. It talks to bridge.js via postMessage.
(() => {
  if (window.__bolbridgeMain) return;
  window.__bolbridgeMain = true;

  const FROM_BRIDGE = 'bb-bridge';
  const TO_BRIDGE = 'bb-main';
  const TARGET_RATE = 16000;
  const LOG = '[BolBridge]';

  const state = {
    ready: false, // settings received
    on: false,
    hearOriginal: false,
    speech: { out: true, in: true }, // server can speak the target language
  };

  const post = (msg, transfer) => window.postMessage({ ...msg, __bb: TO_BRIDGE }, '*', transfer || []);

  let ctx = null;
  function audioCtx() {
    if (!ctx) ctx = new (window.AudioContext || window.webkitAudioContext)();
    if (ctx.state === 'suspended') ctx.resume().catch(() => {});
    return ctx;
  }

  function downsample(input, inRate) {
    const ratio = inRate / TARGET_RATE;
    const outLen = Math.floor(input.length / ratio);
    const out = new Int16Array(outLen);
    for (let i = 0; i < outLen; i++) {
      const start = Math.floor(i * ratio);
      const end = Math.min(input.length, Math.floor((i + 1) * ratio));
      let sum = 0;
      for (let j = start; j < end; j++) sum += input[j];
      const v = Math.max(-1, Math.min(1, end > start ? sum / (end - start) : 0));
      out[i] = v < 0 ? v * 0x8000 : v * 0x7fff;
    }
    return out;
  }

  const active = (dir) => state.ready && state.on;

  // ---------------------------------------------------------------- outgoing
  const outgoing = new Set();
  const nextStart = { out: 0, in: 0 };

  function wrapMic(stream) {
    const c = audioCtx();
    const micTrack = stream.getAudioTracks()[0];
    const src = c.createMediaStreamSource(new MediaStream([micTrack]));
    const dest = c.createMediaStreamDestination();
    const passGain = c.createGain(); // your real voice
    const ttsGain = c.createGain(); // your translated voice
    src.connect(passGain);
    passGain.connect(dest);
    ttsGain.connect(dest);

    const proc = c.createScriptProcessor(4096, 1, 1);
    const sink = c.createGain();
    sink.gain.value = 0;
    src.connect(proc);
    proc.connect(sink);
    sink.connect(c.destination);

    const outTrack = dest.stream.getAudioTracks()[0];
    const entry = { micTrack, src, dest, passGain, ttsGain, proc, outTrack, alive: true };

    proc.onaudioprocess = (e) => {
      // respect the page's own mute button (it disables the track we gave it)
      if (!entry.alive || !active('out') || !outTrack.enabled || !micTrack.enabled) return;
      const pcm = downsample(e.inputBuffer.getChannelData(0), c.sampleRate);
      post({ type: 'audio', dir: 'out', buffer: pcm.buffer }, [pcm.buffer]);
    };

    const nativeStop = outTrack.stop.bind(outTrack);
    outTrack.stop = () => {
      nativeStop();
      endMic(entry);
    };
    micTrack.addEventListener('ended', () => endMic(entry));

    outgoing.add(entry);
    applyLevels();
    updateCall();
    return new MediaStream([outTrack, ...stream.getVideoTracks()]);
  }

  function endMic(entry) {
    if (!entry.alive) return;
    entry.alive = false;
    try { entry.micTrack.stop(); } catch (e) { /* already stopped */ }
    try { entry.proc.disconnect(); entry.src.disconnect(); } catch (e) { /* ignore */ }
    outgoing.delete(entry);
    updateCall();
  }

  const md = navigator.mediaDevices;
  if (md && typeof md.getUserMedia === 'function') {
    const nativeGUM = md.getUserMedia.bind(md);
    md.getUserMedia = async function (constraints) {
      const stream = await nativeGUM(constraints);
      if (!constraints || !constraints.audio || stream.getAudioTracks().length === 0) return stream;
      try {
        return wrapMic(stream);
      } catch (err) {
        console.warn(LOG, 'could not attach to the microphone, call continues untranslated', err);
        return stream;
      }
    };
  }

  // ---------------------------------------------------------------- incoming
  const incoming = { mix: null, proc: null, play: null, tracks: new Map() };
  const keepers = new WeakSet(); // our own hidden <audio> helpers
  const mediaElements = new Set(); // page elements that play streams
  const savedVolume = new WeakMap();

  function ensureIncoming() {
    if (incoming.mix) return;
    const c = audioCtx();
    incoming.mix = c.createGain();
    incoming.proc = c.createScriptProcessor(4096, 1, 1);
    const sink = c.createGain();
    sink.gain.value = 0;
    incoming.mix.connect(incoming.proc);
    incoming.proc.connect(sink);
    sink.connect(c.destination);
    incoming.proc.onaudioprocess = (e) => {
      if (!active('in') || incoming.tracks.size === 0) return;
      const pcm = downsample(e.inputBuffer.getChannelData(0), c.sampleRate);
      post({ type: 'audio', dir: 'in', buffer: pcm.buffer }, [pcm.buffer]);
    };
    incoming.play = c.createGain();
    incoming.play.connect(c.destination);
  }

  function addRemoteTrack(track) {
    if (incoming.tracks.has(track.id)) return;
    const c = audioCtx();
    ensureIncoming();
    const stream = new MediaStream([track]);
    // Chrome only feeds a remote WebRTC stream into Web Audio if it is also
    // attached to a media element, so keep a muted one.
    const keeper = new Audio();
    keepers.add(keeper);
    keeper.muted = true;
    keeper.srcObject = stream;
    keeper.play().catch(() => {});
    const src = c.createMediaStreamSource(stream);
    src.connect(incoming.mix);
    incoming.tracks.set(track.id, { track, src, keeper });
    track.addEventListener('ended', () => removeRemoteTrack(track.id));
    applyLevels();
    updateCall();
  }

  function removeRemoteTrack(id) {
    const t = incoming.tracks.get(id);
    if (!t) return;
    try { t.src.disconnect(); } catch (e) { /* ignore */ }
    t.keeper.srcObject = null;
    incoming.tracks.delete(id);
    updateCall();
  }

  const NativePC = window.RTCPeerConnection || window.webkitRTCPeerConnection;
  if (NativePC) {
    const PatchedPC = function (...args) {
      const pc = new NativePC(...args);
      try {
        pc.addEventListener('track', (ev) => {
          if (ev.track && ev.track.kind === 'audio') addRemoteTrack(ev.track);
        });
      } catch (err) {
        console.warn(LOG, err);
      }
      return pc;
    };
    PatchedPC.prototype = NativePC.prototype;
    Object.setPrototypeOf(PatchedPC, NativePC);
    window.RTCPeerConnection = PatchedPC;
    if (window.webkitRTCPeerConnection) window.webkitRTCPeerConnection = PatchedPC;
  }

  // Remember every element the page plays a stream through, so we can turn
  // the original voice down while the translation plays.
  const srcObjectDesc = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, 'srcObject');
  if (srcObjectDesc && srcObjectDesc.set) {
    Object.defineProperty(HTMLMediaElement.prototype, 'srcObject', {
      configurable: true,
      enumerable: srcObjectDesc.enumerable,
      get() {
        return srcObjectDesc.get.call(this);
      },
      set(value) {
        srcObjectDesc.set.call(this, value);
        if (value && !keepers.has(this)) {
          mediaElements.add(this);
          applyLevels();
        }
      },
    });
  }

  function playsRemoteAudio(el) {
    const s = el.srcObject;
    if (!s || typeof s.getAudioTracks !== 'function') return false;
    return s.getAudioTracks().some((t) => incoming.tracks.has(t.id));
  }

  function applyLevels() {
    // What the other person hears from you.
    const translateOut = active('out') && state.speech.out;
    for (const e of outgoing) e.passGain.gain.value = translateOut ? 0 : 1;

    // What you hear from them.
    const translateIn = active('in') && state.speech.in;
    const original = translateIn ? (state.hearOriginal ? 0.15 : 0) : 1;
    const all = new Set([...mediaElements, ...document.querySelectorAll('audio, video')]);
    for (const el of all) {
      if (keepers.has(el)) continue;
      if (!el.isConnected && !mediaElements.has(el)) continue;
      if (!playsRemoteAudio(el)) continue;
      if (!savedVolume.has(el)) savedVolume.set(el, el.volume);
      el.volume = original === 1 ? savedVolume.get(el) : original;
    }
  }
  setInterval(applyLevels, 1000);

  // ---------------------------------------------------------------- playback
  function playTranslated(dir, sampleRate, buffer) {
    const c = audioCtx();
    const pcm = new Int16Array(buffer);
    if (!pcm.length) return;
    const audioBuffer = c.createBuffer(1, pcm.length, sampleRate);
    const ch = audioBuffer.getChannelData(0);
    for (let i = 0; i < pcm.length; i++) ch[i] = pcm[i] / 32768;
    const node = c.createBufferSource();
    node.buffer = audioBuffer;
    if (dir === 'out') {
      const targets = [...outgoing].filter((e) => e.alive);
      if (!targets.length) return;
      for (const e of targets) node.connect(e.ttsGain);
    } else {
      ensureIncoming();
      node.connect(incoming.play);
    }
    // queue sentences one after another, never on top of each other
    const startAt = Math.max(c.currentTime + 0.02, nextStart[dir]);
    node.start(startAt);
    nextStart[dir] = startAt + audioBuffer.duration;
  }

  // ---------------------------------------------------------------- call state
  let callActive = false;
  function updateCall() {
    const live = [...outgoing].some((e) => e.alive && e.micTrack.readyState === 'live')
      || [...incoming.tracks.values()].some((t) => t.track.readyState === 'live');
    if (live !== callActive) {
      callActive = live;
      post({ type: 'call', active: live });
    }
  }
  setInterval(updateCall, 2000);

  // ---------------------------------------------------------------- bridge
  window.addEventListener('message', (event) => {
    if (event.source !== window || !event.data || event.data.__bb !== FROM_BRIDGE) return;
    const msg = event.data;
    if (msg.type === 'settings' && msg.settings) {
      const wasOn = state.on;
      state.ready = true;
      state.on = !!msg.settings.on;
      state.hearOriginal = !!msg.settings.hearOriginal;
      if (msg.settings.changed) {
        // languages changed: wait for the new session to tell us about speech
        state.speech = { out: true, in: true };
      }
      if (wasOn && !state.on) {
        post({ type: 'stop', dir: 'out' });
        post({ type: 'stop', dir: 'in' });
        nextStart.out = nextStart.in = 0;
      }
      applyLevels();
    } else if (msg.type === 'session') {
      state.speech[msg.dir] = !!msg.speech;
      applyLevels();
    } else if (msg.type === 'tts' && msg.buffer) {
      if (active(msg.dir)) playTranslated(msg.dir, msg.sampleRate || 24000, msg.buffer);
    }
  });

  post({ type: 'hello' });
})();
