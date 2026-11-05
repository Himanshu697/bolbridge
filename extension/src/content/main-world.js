// BolBridge: runs inside the call page itself (MAIN world), before the page's
// own scripts, so it can sit between the page and the microphone / speakers.
//
// Outgoing: the page asks for the microphone -> we hand it a stream we control.
//   Translation off, or the server is not ready: your real voice passes through.
//   Translation on and the server ready: your voice goes to the server; the
//   translated speech is what the other person hears.
// Incoming: every remote audio track the page receives over WebRTC is also
//   sent to the server; the translation plays to you, and the original voice
//   is turned down (or muted) whether the page plays it through <audio>/<video>
//   or through Web Audio.
//
// This script cannot use chrome.* APIs. It talks to bridge.js via postMessage.
(() => {
  if (window.__bolbridgeMain) return;
  window.__bolbridgeMain = { version: '0.3.0' };

  const FROM_BRIDGE = 'bb-bridge';
  const TO_BRIDGE = 'bb-main';
  const TARGET_RATE = 16000;
  const LOG = '[BolBridge]';

  const state = {
    ready: false, // settings received
    on: false,
    hearOriginal: false,
    // true only once the server said it can speak the target language.
    // Until then (or after any error) the real voice passes through, so the
    // other person never sits in silence.
    speech: { out: false, in: false },
  };
  const stats = { chunks: { out: 0, in: 0 }, played: { out: 0, in: 0 }, micRequests: 0, wrapErrors: 0 };

  const post = (msg, transfer) => window.postMessage({ ...msg, __bb: TO_BRIDGE }, '*', transfer || []);

  // ---------------------------------------------------------------- audio engine
  let ctx = null;
  function audioCtx() {
    if (!ctx) {
      ctx = new (window.AudioContext || window.webkitAudioContext)();
      ctx.addEventListener('statechange', () => sendDiag());
    }
    unlock();
    return ctx;
  }

  // Chrome keeps an AudioContext "suspended" until the page has had a click or
  // key press. Call pages ask for the mic before that (the "ready to join"
  // screen), so resume on the first gesture and keep checking.
  function unlock() {
    if (!ctx || ctx.state === 'running' || ctx.state === 'closed') return;
    ctx.resume().catch(() => {});
  }
  for (const ev of ['pointerdown', 'mousedown', 'keydown', 'touchstart', 'click']) {
    window.addEventListener(ev, unlock, { capture: true, passive: true });
  }
  setInterval(unlock, 1000);

  function resample(input, inRate) {
    const ratio = inRate / TARGET_RATE;
    const outLen = Math.floor(input.length / ratio);
    const out = new Int16Array(outLen);
    if (ratio >= 1) {
      // average the samples that fall into each output sample
      for (let i = 0; i < outLen; i++) {
        const start = Math.floor(i * ratio);
        const end = Math.min(input.length, Math.floor((i + 1) * ratio));
        let sum = 0;
        for (let j = start; j < end; j++) sum += input[j];
        const v = Math.max(-1, Math.min(1, end > start ? sum / (end - start) : input[start] || 0));
        out[i] = v < 0 ? v * 0x8000 : v * 0x7fff;
      }
    } else {
      // device runs below 16 kHz (e.g. a Bluetooth headset): interpolate
      for (let i = 0; i < outLen; i++) {
        const pos = i * ratio;
        const j = Math.floor(pos);
        const frac = pos - j;
        const a = input[j] || 0;
        const b = input[Math.min(input.length - 1, j + 1)] || 0;
        const v = Math.max(-1, Math.min(1, a + (b - a) * frac));
        out[i] = v < 0 ? v * 0x8000 : v * 0x7fff;
      }
    }
    return out;
  }

  const active = () => state.ready && state.on;

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
      if (!entry.alive || !active() || !outTrack.enabled || !micTrack.enabled) return;
      const pcm = resample(e.inputBuffer.getChannelData(0), c.sampleRate);
      stats.chunks.out++;
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

  // Wrap getUserMedia on the prototype (pages may call it from there) and on
  // the instance (pages may have kept a reference to the instance method).
  function wrapGUM(native) {
    return async function (constraints) {
      const stream = await native.call(this, constraints);
      if (!constraints || !constraints.audio || stream.getAudioTracks().length === 0) return stream;
      stats.micRequests++;
      try {
        return wrapMic(stream);
      } catch (err) {
        stats.wrapErrors++;
        console.warn(LOG, 'could not attach to the microphone, call continues untranslated', err);
        return stream;
      }
    };
  }
  if (window.MediaDevices && MediaDevices.prototype.getUserMedia) {
    MediaDevices.prototype.getUserMedia = wrapGUM(MediaDevices.prototype.getUserMedia);
  }
  if (navigator.mediaDevices && Object.prototype.hasOwnProperty.call(navigator.mediaDevices, 'getUserMedia')) {
    navigator.mediaDevices.getUserMedia = wrapGUM(navigator.mediaDevices.getUserMedia);
  }

  // ---------------------------------------------------------------- incoming
  const incoming = { mix: null, proc: null, play: null, tracks: new Map() };
  const keepers = new WeakSet(); // our own hidden <audio> helpers
  const mediaElements = new Set(); // page elements that play streams
  const savedVolume = new WeakMap();
  let duckedElements = 0;
  let duckedWebAudio = 0;

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
      if (!active() || incoming.tracks.size === 0) return;
      const pcm = resample(e.inputBuffer.getChannelData(0), c.sampleRate);
      stats.chunks.in++;
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
    incoming.tracks.set(track.id, { track, src, keeper, duck: null });
    track.addEventListener('ended', () => removeRemoteTrack(track.id));
    applyLevels();
    updateCall();
  }

  function removeRemoteTrack(id) {
    const t = incoming.tracks.get(id);
    if (!t) return;
    try { t.src.disconnect(); } catch (e) { /* ignore */ }
    if (t.duck) {
      try { t.duck.gain.disconnect(); } catch (e) { /* ignore */ }
    }
    t.keeper.srcObject = null;
    incoming.tracks.delete(id);
    updateCall();
  }

  // A copy of a remote track that we can turn down: given to pages that play
  // the other person through Web Audio instead of an <audio> element.
  function duckedTrack(t) {
    if (!t.duck) {
      const c = audioCtx();
      const gain = c.createGain();
      const dest = c.createMediaStreamDestination();
      t.src.connect(gain);
      gain.connect(dest);
      t.duck = { gain, track: dest.stream.getAudioTracks()[0] };
      applyLevels();
    }
    return t.duck.track;
  }

  function swapRemoteStream(stream) {
    if (!stream || typeof stream.getAudioTracks !== 'function') return stream;
    const tracks = stream.getAudioTracks();
    if (!tracks.some((tr) => incoming.tracks.has(tr.id))) return stream;
    duckedWebAudio++;
    return new MediaStream(tracks.map((tr) => (incoming.tracks.has(tr.id) ? duckedTrack(incoming.tracks.get(tr.id)) : tr)));
  }

  const NativePC = window.RTCPeerConnection || window.webkitRTCPeerConnection;
  if (NativePC) {
    const PatchedPC = function (...args) {
      const pc = new NativePC(...args);
      // BolBridge's own test page marks its pretend "other person" this way.
      if (args[0] && args[0].bolbridgeIgnore) return pc;
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

  // Pages that play the other person through Web Audio.
  const NativeAC = window.AudioContext || window.webkitAudioContext;
  if (NativeAC && NativeAC.prototype.createMediaStreamSource) {
    const nativeCMSS = NativeAC.prototype.createMediaStreamSource;
    NativeAC.prototype.createMediaStreamSource = function (stream) {
      if (this === ctx) return nativeCMSS.call(this, stream); // our own graph
      return nativeCMSS.call(this, swapRemoteStream(stream));
    };
  }
  if (window.MediaStreamAudioSourceNode) {
    const NativeNode = window.MediaStreamAudioSourceNode;
    const PatchedNode = function (context, options) {
      if (context !== ctx && options && options.mediaStream) {
        options = { ...options, mediaStream: swapRemoteStream(options.mediaStream) };
      }
      return new NativeNode(context, options);
    };
    PatchedNode.prototype = NativeNode.prototype;
    Object.setPrototypeOf(PatchedNode, NativeNode);
    window.MediaStreamAudioSourceNode = PatchedNode;
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
    const translateOut = active() && state.speech.out;
    for (const e of outgoing) e.passGain.gain.value = translateOut ? 0 : 1;

    // What you hear from them.
    const translateIn = active() && state.speech.in;
    const original = translateIn ? (state.hearOriginal ? 0.15 : 0) : 1;
    let ducked = 0;
    const all = new Set([...mediaElements, ...document.querySelectorAll('audio, video')]);
    for (const el of all) {
      if (keepers.has(el)) continue;
      if (!el.isConnected && !mediaElements.has(el)) continue;
      if (!playsRemoteAudio(el)) continue;
      if (!savedVolume.has(el)) savedVolume.set(el, el.volume);
      el.volume = original === 1 ? savedVolume.get(el) : original;
      ducked++;
    }
    duckedElements = ducked;
    for (const t of incoming.tracks.values()) {
      if (t.duck) t.duck.gain.gain.value = original;
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
    stats.played[dir]++;
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

  // ---------------------------------------------------------------- diagnostics
  function sendDiag() {
    const mics = [...outgoing].filter((e) => e.alive);
    post({
      type: 'diag',
      diag: {
        hooked: true,
        audio: ctx ? ctx.state : 'not started',
        sampleRate: ctx ? ctx.sampleRate : null,
        userClicked: !!(navigator.userActivation && navigator.userActivation.hasBeenActive),
        micRequests: stats.micRequests,
        mics: mics.length,
        micMuted: mics.length > 0 && mics.every((e) => !e.outTrack.enabled || !e.micTrack.enabled),
        theirTracks: [...incoming.tracks.values()].filter((t) => t.track.readyState === 'live').length,
        duckedElements,
        duckedWebAudio,
        chunks: { ...stats.chunks },
        played: { ...stats.played },
        speech: { ...state.speech },
        on: state.on,
        wrapErrors: stats.wrapErrors,
      },
    });
  }
  setInterval(sendDiag, 2000);

  // ---------------------------------------------------------------- bridge
  window.addEventListener('message', (event) => {
    if (event.source !== window || !event.data || event.data.__bb !== FROM_BRIDGE) return;
    const msg = event.data;
    if (msg.type === 'settings' && msg.settings) {
      const wasOn = state.on;
      state.ready = true;
      state.on = !!msg.settings.on;
      state.hearOriginal = !!msg.settings.hearOriginal;
      if (msg.settings.changed || !state.on) {
        // new languages or translation off: real voice until a new session is ready
        state.speech = { out: false, in: false };
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
      sendDiag();
    } else if (msg.type === 'tts' && msg.buffer) {
      if (active()) playTranslated(msg.dir, msg.sampleRate || 24000, msg.buffer);
    }
  });

  post({ type: 'hello' });
})();
