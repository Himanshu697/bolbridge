// BolBridge: runs inside the call page itself (MAIN world), before the page's
// own scripts, so it can sit between the call and your microphone / speakers.
//
// Your voice (out). Every way a voice can get onto a call goes through us:
//   * the page asks for the microphone: it gets a stream we control;
//   * the page puts some other voice track on a call connection (its own
//     processed copy, a clone, a microphone it got elsewhere): the connection
//     gets our copy of that track, while the page still sees its own.
//   Translation off or the server not ready: your real voice passes through.
//   Translation on and the server ready: they hear only the translation.
// Their voice (in). Remote audio is found through the call connections
//   ('track' events plus a regular look at every receiver) and through the
//   elements that play it. It goes to the server; the translation plays to
//   you, and the original is turned down whether the page plays it through
//   <audio>/<video> or through Web Audio.
//
// One engine runs per page. A same-origin child frame (such as about:blank,
// which pages use to get untouched browser objects) hands its hooks to the
// parent's engine. This script cannot use chrome.* APIs; it talks to
// bridge.js through postMessage.
(() => {
  const VERSION = '0.4.0';
  if (window.__bolbridgeMain) return;
  try {
    const parentEngine = window.parent !== window ? window.parent.__bolbridgeMain : null;
    if (parentEngine && typeof parentEngine.adopt === 'function') {
      parentEngine.adopt(window);
      return;
    }
  } catch (err) {
    /* cross-origin parent: this frame runs its own engine */
  }

  const W = window;
  const FROM_BRIDGE = 'bb-bridge';
  const TO_BRIDGE = 'bb-main';
  const TARGET_RATE = 16000;
  const LOG = '[BolBridge]';
  const GESTURES = ['pointerdown', 'mousedown', 'keydown', 'touchstart', 'click'];

  // Untouched browser functions, taken before any hook goes in.
  const desc = (proto, name) => (proto ? Object.getOwnPropertyDescriptor(proto, name) : undefined);
  const PCP = W.RTCPeerConnection && W.RTCPeerConnection.prototype;
  const N = {
    MediaStream: W.MediaStream,
    Audio: W.Audio,
    AudioContext: W.AudioContext || W.webkitAudioContext,
    stop: W.MediaStreamTrack.prototype.stop,
    getSettings: W.MediaStreamTrack.prototype.getSettings,
    senderTrack: W.RTCRtpSender ? desc(W.RTCRtpSender.prototype, 'track').get : null,
    replaceTrack: W.RTCRtpSender ? W.RTCRtpSender.prototype.replaceTrack : null,
    getTransceivers: PCP ? PCP.getTransceivers : null,
    getReceivers: PCP ? PCP.getReceivers : null,
    volume: desc(W.HTMLMediaElement.prototype, 'volume'),
    srcObject: desc(W.HTMLMediaElement.prototype, 'srcObject'),
  };

  const engine = {};
  Object.defineProperty(engine, 'version', { value: VERSION, enumerable: true });
  Object.defineProperty(engine, 'adopt', { value: adopt });
  Object.defineProperty(W, '__bolbridgeMain', { value: engine, configurable: true });

  const state = {
    ready: false, // settings received
    on: false,
    hearOriginal: false,
    // true only once the server said it can speak the target language.
    // Until then (or after any error) the real voice passes through, so the
    // other person never sits in silence.
    speech: { out: false, in: false },
    // their voice comes from the tab's sound (the extension's offscreen page):
    // the page then neither captures nor turns down their voice itself
    tabAudio: false,
  };
  const stats = {
    chunks: { out: 0, in: 0 }, played: { out: 0, in: 0 }, ttsDropped: 0,
    gumCalls: 0, micRequests: 0, displayCalls: 0, sendWraps: 0, wrapErrors: 0,
    pageSources: 0, pageSourcesUnknown: 0,
  };
  const found = { event: 0, receiver: 0, element: 0, webaudio: 0 };

  const post = (msg, transfer) => W.postMessage({ ...msg, __bb: TO_BRIDGE }, '*', transfer || []);
  const active = () => state.ready && state.on;
  const translatingOut = () => active() && state.speech.out;

  // ---------------------------------------------------------------- audio engine
  let ctx = null;
  function audioCtx() {
    if (!ctx) {
      ctx = new N.AudioContext();
      ctx.addEventListener('statechange', () => sendDiag());
    }
    unlock();
    return ctx;
  }

  // Chrome keeps an AudioContext "suspended" until the page has had a click or
  // key press. Call pages ask for the mic before that (the "ready to join"
  // screen), so resume on the first gesture and keep checking.
  function unlock() {
    if (ctx && ctx.state === 'suspended') ctx.resume().catch(() => {});
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

  // ---------------------------------------------------------------- registries
  // An "entry" is one place where your voice leaves through us:
  //   kind 'mic'  - a microphone stream we handed to the page
  //   kind 'send' - a voice track the page put on a call; the call gets our copy
  const entries = new Set();
  const byOutTrack = new Map(); // id of a track we made (or a copy the page made of it) -> entry
  const wrapsByPageTrack = new Map(); // id of a page track we stand in for -> entry
  const ownIds = new Set(); // every track we made
  const displayIds = new Set(); // screen-share audio: never translated
  const remoteIds = new Set(); // their voice, and copies the page made of it
  const remoteAlias = new Map(); // copy id -> original remote track id
  const pcs = new Set(); // call connections
  const ignoredPCs = new WeakSet();
  const ignoredSenders = new WeakSet();
  const pageTrackOf = new WeakMap(); // sender -> the track the page believes it sends
  const replacing = new WeakSet();
  const adopted = new Set(); // windows whose hooks lead to this engine
  const mediaElements = new Set(); // elements the page plays streams through
  const keepers = new WeakSet(); // our own hidden <audio> helpers
  const savedVolume = new WeakMap();
  const duckedEls = new WeakSet();

  let route = { capture: null, gate: null, sent: [], targets: [], muted: false };
  let callInfo = {
    calls: 0, audioSlots: 0, carried: 0, empty: 0,
    senders: { audio: 0, ours: 0, wrapped: 0, other: 0 },
    receivers: { audio: 0, receiving: 0 },
  };
  let elementInfo = { playing: 0, known: 0, unknown: 0, local: 0 };
  let duckedElements = 0;
  let duckedWebAudio = 0;

  // ---------------------------------------------------------------- your voice
  function makeEntry(kind, inputTrack) {
    const c = audioCtx();
    const src = c.createMediaStreamSource(new N.MediaStream([inputTrack]));
    const dest = c.createMediaStreamDestination();
    const passGain = c.createGain(); // your real voice
    const ttsGain = c.createGain(); // your translated voice
    const inMeter = c.createAnalyser();
    const outMeter = c.createAnalyser();
    inMeter.fftSize = 1024;
    outMeter.fftSize = 1024;
    src.connect(passGain);
    passGain.connect(dest);
    ttsGain.connect(dest);
    src.connect(inMeter);
    passGain.connect(outMeter);
    ttsGain.connect(outMeter);
    passGain.gain.value = translatingOut() ? 0 : 1;
    const outTrack = dest.stream.getAudioTracks()[0];
    const e = {
      kind, inputTrack, src, dest, passGain, ttsGain, inMeter, outMeter, outTrack,
      handed: new Set(), senders: new Set(), alive: true, created: Date.now(),
    };
    entries.add(e);
    byOutTrack.set(outTrack.id, e);
    ownIds.add(outTrack.id);
    return e;
  }

  function wrapMic(stream, win) {
    const micTrack = stream.getAudioTracks()[0];
    const e = makeEntry('mic', micTrack);
    e.handed.add(e.outTrack);
    micTrack.addEventListener('ended', () => endEntry(e, 'microphone ended'));
    scanSoon();
    const Stream = (win && win.MediaStream) || N.MediaStream;
    return new Stream([e.outTrack, ...stream.getVideoTracks()]);
  }

  function sendEntryFor(track) {
    const old = wrapsByPageTrack.get(track.id);
    if (old && old.alive) return old;
    let e;
    try {
      e = makeEntry('send', track);
    } catch (err) {
      stats.wrapErrors++;
      console.warn(LOG, 'could not take over a call track, it is sent untranslated', err);
      return null;
    }
    wrapsByPageTrack.set(track.id, e);
    stats.sendWraps++;
    track.addEventListener('ended', () => endEntry(e, 'their track ended'));
    return e;
  }

  // Put our copy on a call connection in place of the page's own track.
  function standIn(sender, track) {
    const e = sendEntryFor(track);
    if (!e) return null;
    pageTrackOf.set(sender, track);
    replacing.add(sender);
    N.replaceTrack.call(sender, e.outTrack).then(
      () => replacing.delete(sender),
      (err) => {
        replacing.delete(sender);
        pageTrackOf.delete(sender);
        stats.wrapErrors++;
        console.warn(LOG, 'could not take over a call track', err);
      },
    );
    return e;
  }

  function takeOver(sender, track) {
    if (!sender || !track || track.kind !== 'audio' || ignoredSenders.has(sender)) return;
    if (!byOutTrack.has(track.id) && isVoiceCandidate(track)) standIn(sender, track);
    scanSoon();
  }

  function endEntry(e, why) {
    if (!e.alive) return;
    e.alive = false;
    e.ended = why;
    try {
      e.src.disconnect();
    } catch (err) {
      /* ignore */
    }
    if (e.kind === 'mic') {
      try {
        N.stop.call(e.inputTrack); // our own copy of the microphone
      } catch (err) {
        /* already stopped */
      }
      // Tell the page its microphone ended (stop() alone fires no 'ended').
      for (const t of e.handed) {
        if (t.readyState !== 'live') continue;
        try {
          N.stop.call(t);
          t.dispatchEvent(new Event('ended'));
        } catch (err) {
          /* ignore */
        }
      }
    } else {
      try {
        N.stop.call(e.outTrack);
      } catch (err) {
        /* ignore */
      }
      wrapsByPageTrack.delete(e.inputTrack.id);
    }
    entries.delete(e);
    scanSoon();
  }

  const handedEntry = (t) => {
    const e = t && byOutTrack.get(t.id);
    return e && e.kind === 'mic' ? e : null;
  };

  function trackStopped(t) {
    const e = handedEntry(t);
    if (e && [...e.handed].every((h) => h.readyState === 'ended')) endEntry(e, 'the page stopped it');
    const s = wrapsByPageTrack.get(t.id);
    if (s) endEntry(s, 'the page stopped it');
  }

  function trackCloned(orig, copy) {
    const e = handedEntry(orig);
    if (e) {
      e.handed.add(copy);
      byOutTrack.set(copy.id, e);
    }
    if (displayIds.has(orig.id)) displayIds.add(copy.id);
    if (remoteIds.has(orig.id)) {
      remoteIds.add(copy.id);
      remoteAlias.set(copy.id, remoteAlias.get(orig.id) || orig.id);
    }
  }

  const pageTrack = (sender) => (pageTrackOf.has(sender) ? pageTrackOf.get(sender) : N.senderTrack.call(sender));

  // Does the page currently let this voice out (not muted, not stopped)?
  function voiceOn(e) {
    if (!e || !e.alive) return false;
    const tracks = e.senders.size ? [...e.senders].map(pageTrack) : e.kind === 'mic' ? [...e.handed] : [e.inputTrack];
    return tracks.some((t) => t && t.enabled && t.readyState === 'live');
  }

  function isReceiverTrack(t) {
    for (const pc of pcs) {
      try {
        if (N.getReceivers.call(pc).some((r) => r.track === t)) return true;
      } catch (err) {
        /* ignore */
      }
    }
    return false;
  }

  // A track that could be your voice: not ours, not theirs, not screen sound.
  function isVoiceCandidate(t) {
    if (!t || t.kind !== 'audio' || t.readyState !== 'live') return false;
    if (ownIds.has(t.id) || byOutTrack.has(t.id) || displayIds.has(t.id) || remoteIds.has(t.id)) return false;
    return !isReceiverTrack(t);
  }

  function isLocalInput(t) {
    for (const e of entries) if (e.inputTrack.id === t.id) return true;
    try {
      const st = N.getSettings.call(t);
      if (st && st.deviceId) return true; // a microphone or capture device
    } catch (err) {
      /* ignore */
    }
    return false;
  }

  // One capture of your voice at a time, from the best source.
  const outCap = { node: null, proc: null, entry: null };
  function setCapture(entry) {
    if (entry === outCap.entry) return;
    if (outCap.entry) {
      try {
        outCap.entry.src.disconnect(outCap.node);
      } catch (err) {
        /* ignore */
      }
    }
    outCap.entry = entry;
    if (!entry) return;
    const c = audioCtx();
    if (!outCap.node) {
      outCap.node = c.createGain();
      outCap.proc = c.createScriptProcessor(4096, 1, 1);
      const sink = c.createGain();
      sink.gain.value = 0;
      outCap.node.connect(outCap.proc);
      outCap.proc.connect(sink);
      sink.connect(c.destination);
      outCap.proc.onaudioprocess = (ev) => {
        // respect the call's own mute button
        if (!outCap.entry || !active() || !voiceOn(route.gate)) return;
        const pcm = resample(ev.inputBuffer.getChannelData(0), c.sampleRate);
        stats.chunks.out++;
        post({ type: 'audio', dir: 'out', buffer: pcm.buffer }, [pcm.buffer]);
      };
    }
    entry.src.connect(outCap.node);
  }

  // Which entry we listen to, which entries get the translated voice.
  function pickRoute() {
    const live = [...entries].filter((e) => e.alive && e.inputTrack.readyState === 'live');
    const sent = live.filter((e) => e.senders.size > 0);
    const mics = live.filter((e) => e.kind === 'mic').sort((a, b) => b.created - a.created);
    const inCall = callInfo.calls > 0 || theirLive() > 0 || state.tabAudio;
    let capture = null;
    let gate = null;
    let muted = false;
    if (sent.length) {
      // Listen to the raw microphone when we have it: the page may process
      // (and our translation may replace) what actually goes on the call.
      const sentMic = sent.find((e) => e.kind === 'mic');
      capture = sentMic || mics[0] || sent[0];
      gate = sentMic || sent[0];
    } else if (inCall) {
      if (callInfo.audioSlots > 0 && callInfo.carried === 0) muted = true; // the call's voice slot is empty
      else capture = gate = mics[0] || null;
    }
    route = { capture, gate, sent, targets: sent.length ? sent : live, muted };
    setCapture(capture);
  }

  // ---------------------------------------------------------------- their voice
  const incoming = { mix: null, proc: null, play: null, meter: null, tracks: new Map() };

  function ensureIncoming() {
    if (incoming.mix) return;
    const c = audioCtx();
    incoming.mix = c.createGain();
    incoming.proc = c.createScriptProcessor(4096, 1, 1);
    incoming.meter = c.createAnalyser();
    incoming.meter.fftSize = 1024;
    const sink = c.createGain();
    sink.gain.value = 0;
    incoming.mix.connect(incoming.proc);
    incoming.mix.connect(incoming.meter);
    incoming.proc.connect(sink);
    sink.connect(c.destination);
    incoming.proc.onaudioprocess = (e) => {
      if (!active() || state.tabAudio || theirLive() === 0) return;
      const pcm = resample(e.inputBuffer.getChannelData(0), c.sampleRate);
      stats.chunks.in++;
      post({ type: 'audio', dir: 'in', buffer: pcm.buffer }, [pcm.buffer]);
    };
    incoming.play = c.createGain();
    incoming.play.connect(c.destination);
  }

  function remoteEntry(t) {
    return incoming.tracks.get(remoteAlias.get(t.id) || t.id) || null;
  }

  function addRemoteTrack(track, how) {
    if (!track || track.kind !== 'audio' || track.readyState !== 'live' || remoteEntry(track)) return;
    const c = audioCtx();
    ensureIncoming();
    remoteIds.add(track.id);
    const stream = new N.MediaStream([track]);
    // Chrome only feeds a remote WebRTC stream into Web Audio if it is also
    // attached to a media element, so keep a muted one.
    const keeper = new N.Audio();
    keepers.add(keeper);
    keeper.muted = true;
    keeper.srcObject = stream;
    keeper.play().catch(() => {});
    const src = c.createMediaStreamSource(stream);
    src.connect(incoming.mix);
    incoming.tracks.set(track.id, { track, src, keeper, duck: null, how });
    found[how] = (found[how] || 0) + 1;
    track.addEventListener('ended', () => removeRemoteTrack(track.id));
    applyLevels();
    scanSoon();
  }

  function removeRemoteTrack(id) {
    const t = incoming.tracks.get(id);
    if (!t) return;
    try {
      t.src.disconnect();
    } catch (e) {
      /* ignore */
    }
    if (t.duck) {
      try {
        t.duck.gain.disconnect();
      } catch (e) {
        /* ignore */
      }
    }
    t.keeper.srcObject = null;
    incoming.tracks.delete(id);
    scanSoon();
  }

  function theirLive() {
    let n = 0;
    for (const t of incoming.tracks.values()) if (t.track.readyState === 'live') n++;
    return n;
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
      ownIds.add(t.duck.track.id);
      applyLevels();
    }
    return t.duck.track;
  }

  function swapRemoteStream(stream, win) {
    if (!stream || typeof stream.getAudioTracks !== 'function') return stream;
    const tracks = stream.getAudioTracks();
    let swapped = false;
    const out = tracks.map((tr) => {
      let t = remoteEntry(tr);
      if (!t && tr.readyState === 'live' && !isLocalInput(tr) && isReceiverTrack(tr)) {
        addRemoteTrack(tr, 'webaudio'); // the page got to it before our 'track' listener
        t = remoteEntry(tr);
      }
      if (!t) return tr;
      swapped = true;
      return duckedTrack(t);
    });
    if (!swapped) {
      if (tracks.some((tr) => !ownIds.has(tr.id) && !byOutTrack.has(tr.id) && !isLocalInput(tr))) stats.pageSourcesUnknown++;
      return stream;
    }
    duckedWebAudio++;
    const Stream = (win && win.MediaStream) || N.MediaStream;
    return new Stream([...out, ...stream.getVideoTracks()]);
  }

  function playsRemoteAudio(el) {
    let s;
    try {
      s = N.srcObject.get.call(el);
    } catch (err) {
      return false;
    }
    if (!s || typeof s.getAudioTracks !== 'function') return false;
    return s.getAudioTracks().some((t) => remoteIds.has(t.id));
  }

  function allMediaElements() {
    const set = new Set();
    for (const el of mediaElements) {
      let has = false;
      try {
        has = !!N.srcObject.get.call(el);
      } catch (err) {
        /* ignore */
      }
      if (!el.isConnected && !has) mediaElements.delete(el);
      else set.add(el);
    }
    for (const w of adopted) {
      try {
        for (const el of w.document.querySelectorAll('audio, video')) set.add(el);
      } catch (err) {
        /* window went away */
      }
    }
    return set;
  }

  // Whatever the page plays from the call is their voice, even if we missed
  // the connection it came from.
  function scanElements() {
    const info = { playing: 0, known: 0, unknown: 0, local: 0 };
    for (const el of allMediaElements()) {
      if (keepers.has(el)) continue;
      let s;
      try {
        s = N.srcObject.get.call(el);
      } catch (err) {
        continue;
      }
      if (!s || typeof s.getAudioTracks !== 'function') continue;
      const volume = duckedEls.has(el) ? savedVolume.get(el) : N.volume.get.call(el);
      if (el.paused || el.muted || !(volume > 0)) continue;
      info.playing++;
      for (const t of s.getAudioTracks()) {
        if (t.readyState !== 'live') continue;
        if (remoteIds.has(t.id)) info.known++;
        else if (ownIds.has(t.id) || byOutTrack.has(t.id) || displayIds.has(t.id) || isLocalInput(t)) info.local++;
        else {
          info.unknown++;
          addRemoteTrack(t, 'element');
        }
      }
    }
    elementInfo = info;
  }

  // ---------------------------------------------------------------- levels
  function applyLevels() {
    // What the other person hears from you.
    const out = translatingOut() ? 0 : 1;
    for (const e of entries) e.passGain.gain.value = out;

    // What you hear from them.
    const translateIn = active() && state.speech.in && !state.tabAudio;
    const original = translateIn ? (state.hearOriginal ? 0.15 : 0) : 1;
    let ducked = 0;
    for (const el of allMediaElements()) {
      if (keepers.has(el) || !playsRemoteAudio(el)) continue;
      try {
        if (original === 1) {
          if (duckedEls.has(el)) {
            duckedEls.delete(el);
            N.volume.set.call(el, savedVolume.has(el) ? savedVolume.get(el) : 1);
          }
        } else {
          if (!duckedEls.has(el)) {
            savedVolume.set(el, N.volume.get.call(el));
            duckedEls.add(el);
          }
          if (N.volume.get.call(el) !== original) N.volume.set.call(el, original);
          ducked++;
        }
      } catch (err) {
        /* ignore */
      }
    }
    duckedElements = ducked;
    for (const t of incoming.tracks.values()) {
      if (t.duck) t.duck.gain.gain.value = original;
    }
  }

  // ---------------------------------------------------------------- scanning
  function notePC(pc) {
    if (!pc || pcs.has(pc) || ignoredPCs.has(pc)) return;
    pcs.add(pc);
    try {
      pc.addEventListener('track', (ev) => {
        if (ev.track && ev.track.kind === 'audio') addRemoteTrack(ev.track, 'event');
      });
    } catch (err) {
      /* ignore */
    }
    scanSoon();
  }

  let scanTimer = 0;
  function scanSoon() {
    if (!scanTimer) scanTimer = setTimeout(scan, 30);
  }

  function scan() {
    clearTimeout(scanTimer);
    scanTimer = 0;
    try {
      for (const w of [...adopted]) if (w !== W && w.closed) adopted.delete(w);
      for (const e of [...entries]) if (e.inputTrack.readyState === 'ended') endEntry(e, 'input ended');
      for (const e of entries) e.senders.clear();
      const info = {
        calls: 0, audioSlots: 0, carried: 0, empty: 0,
        senders: { audio: 0, ours: 0, wrapped: 0, other: 0 },
        receivers: { audio: 0, receiving: 0 },
      };
      for (const pc of [...pcs]) {
        let list;
        try {
          if (pc.signalingState === 'closed') {
            pcs.delete(pc);
            continue;
          }
          list = N.getTransceivers.call(pc);
        } catch (err) {
          continue;
        }
        if (list.length) info.calls++;
        for (const tr of list) {
          let rt = null;
          try {
            rt = tr.receiver && tr.receiver.track;
          } catch (err) {
            /* ignore */
          }
          if (!rt || rt.kind !== 'audio') continue;
          info.receivers.audio++;
          if (rt.readyState === 'live') {
            if (!rt.muted) info.receivers.receiving++;
            addRemoteTrack(rt, 'receiver');
          }
          if (tr.stopped || !(tr.direction === 'sendrecv' || tr.direction === 'sendonly')) continue;
          info.audioSlots++;
          const s = tr.sender;
          const actual = N.senderTrack.call(s);
          if (!actual) {
            info.empty++;
            continue;
          }
          info.carried++;
          info.senders.audio++;
          let e = byOutTrack.get(actual.id) || (replacing.has(s) ? wrapsByPageTrack.get(actual.id) : null);
          // The page put a voice on the call without us seeing it: take it over now.
          if (!e && !ignoredSenders.has(s) && isVoiceCandidate(actual)) e = standIn(s, actual);
          if (e && e.alive) {
            e.senders.add(s);
            info.senders[e.kind === 'send' ? 'wrapped' : 'ours']++;
          } else {
            info.senders.other++;
          }
        }
      }
      callInfo = info;
      scanElements();
      pickRoute();
      applyLevels();
      updateCall();
    } catch (err) {
      console.warn(LOG, 'scan failed', err);
    }
  }

  // ---------------------------------------------------------------- playback
  const nextStart = { out: 0, in: 0 };
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
      // only into what actually goes on the call, so nothing plays twice
      const targets = route.targets.filter((e) => e.alive);
      if (!targets.length) {
        stats.ttsDropped++;
        return;
      }
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
    const live = theirLive() > 0 || route.sent.length > 0 || ((callInfo.calls > 0 || state.tabAudio) && entries.size > 0);
    if (live !== callActive) {
      callActive = live;
      post({ type: 'call', active: live });
    }
  }

  // ---------------------------------------------------------------- diagnostics
  const meterBuf = new Float32Array(1024);
  function rms(an) {
    if (!an) return 0;
    an.getFloatTimeDomainData(meterBuf);
    let s = 0;
    for (let i = 0; i < meterBuf.length; i++) s += meterBuf[i] * meterBuf[i];
    return Math.sqrt(s / meterBuf.length);
  }
  const hist = { mic: [], sent: [], theirs: [] }; // last ~5 s
  const pushLevel = (k, v) => {
    hist[k].push(v);
    if (hist[k].length > 20) hist[k].shift();
  };
  const peak = (k) => Math.round((hist[k].length ? Math.max(...hist[k]) : 0) * 1000) / 1000;
  setInterval(() => {
    if (!ctx) return;
    try {
      pushLevel('mic', outCap.entry ? rms(outCap.entry.inMeter) : 0);
      pushLevel('sent', route.sent.length ? Math.max(...route.sent.map((e) => rms(e.outMeter))) : 0);
      pushLevel('theirs', incoming.meter ? rms(incoming.meter) : 0);
    } catch (err) {
      /* ignore */
    }
  }, 250);

  function sendDiag() {
    try {
      const alive = [...entries].filter((e) => e.alive);
      let sendPath = 'nocall';
      if (callInfo.calls > 0) {
        if (route.sent.length) sendPath = 'ours';
        else if (callInfo.audioSlots === 0) sendPath = 'none';
        else if (callInfo.carried === 0) sendPath = 'muted';
        else sendPath = 'around';
      }
      post({
        type: 'diag',
        diag: {
          v: VERSION,
          frame: W === W.top ? 'top' : 'frame',
          windows: adopted.size,
          hooked: true,
          audio: ctx ? ctx.state : 'not started',
          sampleRate: ctx ? ctx.sampleRate : null,
          userClicked: !!(navigator.userActivation && navigator.userActivation.hasBeenActive),
          gumCalls: stats.gumCalls,
          micRequests: stats.micRequests,
          displayCalls: stats.displayCalls,
          mics: alive.filter((e) => e.kind === 'mic').length,
          wraps: alive.filter((e) => e.kind === 'send').length,
          micMuted: route.muted || (!!route.gate && !voiceOn(route.gate)),
          capture: route.capture ? route.capture.kind : null,
          calls: callInfo.calls,
          sendPath,
          senders: callInfo.senders,
          receivers: callInfo.receivers,
          theirTracks: theirLive(),
          found: { ...found },
          elements: elementInfo,
          duckedElements,
          duckedWebAudio,
          pageSources: stats.pageSources,
          pageSourcesUnknown: stats.pageSourcesUnknown,
          levels: ctx ? { mic: peak('mic'), sent: peak('sent'), theirs: peak('theirs') } : null,
          chunks: { ...stats.chunks },
          played: { ...stats.played },
          ttsDropped: stats.ttsDropped,
          speech: { ...state.speech },
          tabAudio: state.tabAudio,
          on: state.on,
          wrapErrors: stats.wrapErrors,
        },
      });
    } catch (err) {
      /* never break the page */
    }
  }

  // ---------------------------------------------------------------- hooks
  // A frame keeps its window object when it navigates but gets fresh browser
  // objects, so remember what we patched by those objects, not by the window.
  const patchedRealms = new WeakSet();
  const realmKey = (win) => (win.MediaStreamTrack ? win.MediaStreamTrack.prototype : null); // throws if cross-origin

  function adopt(win) {
    try {
      const key = win && realmKey(win);
      if (!key || patchedRealms.has(key)) return;
      install(win);
      Object.defineProperty(win, '__bolbridgeMain', { value: Object.freeze({ version: VERSION, shared: true }), configurable: true });
    } catch (err) {
      /* cross-origin or already gone */
    }
  }

  function install(win) {
    patchedRealms.add(realmKey(win));
    adopted.add(win);
    for (const ev of GESTURES) win.addEventListener(ev, unlock, { capture: true, passive: true });
    hookMedia(win);
    hookCalls(win);
    hookPlayback(win);
    hookFrames(win);
  }

  function hookMedia(win) {
    const MD = win.MediaDevices && win.MediaDevices.prototype;
    const wrapGUM = (native) =>
      function getUserMedia(constraints) {
        return native.call(this, constraints).then((stream) => {
          stats.gumCalls++;
          if (!constraints || !constraints.audio || stream.getAudioTracks().length === 0) return stream;
          stats.micRequests++;
          try {
            return wrapMic(stream, win);
          } catch (err) {
            stats.wrapErrors++;
            console.warn(LOG, 'could not attach to the microphone, call continues untranslated', err);
            return stream;
          }
        });
      };
    if (MD && MD.getUserMedia) MD.getUserMedia = wrapGUM(MD.getUserMedia);
    const md = win.navigator.mediaDevices;
    if (md && Object.prototype.hasOwnProperty.call(md, 'getUserMedia')) md.getUserMedia = wrapGUM(md.getUserMedia);
    if (MD && MD.getDisplayMedia) {
      const native = MD.getDisplayMedia;
      MD.getDisplayMedia = function getDisplayMedia(...args) {
        return native.apply(this, args).then((stream) => {
          stats.displayCalls++;
          for (const t of stream.getAudioTracks()) displayIds.add(t.id);
          return stream;
        });
      };
    }

    // Our microphone copy should look and behave like the real microphone.
    const TP = win.MediaStreamTrack && win.MediaStreamTrack.prototype;
    if (TP) {
      const nStop = TP.stop;
      TP.stop = function stop() {
        nStop.call(this);
        trackStopped(this);
      };
      const nClone = TP.clone;
      TP.clone = function clone() {
        const copy = nClone.call(this);
        trackCloned(this, copy);
        return copy;
      };
      for (const name of ['getSettings', 'getConstraints', 'getCapabilities', 'applyConstraints']) {
        const n = TP[name];
        if (typeof n !== 'function') continue;
        TP[name] = function (...args) {
          const e = handedEntry(this);
          return n.apply(e ? e.inputTrack : this, args);
        };
      }
      const label = desc(TP, 'label');
      if (label && label.get) {
        Object.defineProperty(TP, 'label', {
          configurable: true,
          enumerable: label.enumerable,
          get() {
            const e = handedEntry(this);
            return label.get.call(e ? e.inputTrack : this);
          },
        });
      }
    }
    const SP = win.MediaStream && win.MediaStream.prototype;
    if (SP && SP.clone) {
      const nClone = SP.clone;
      SP.clone = function clone() {
        const copy = nClone.call(this);
        const a = this.getTracks();
        const b = copy.getTracks();
        for (let i = 0; i < a.length && i < b.length; i++) if (a[i].kind === b[i].kind) trackCloned(a[i], b[i]);
        return copy;
      };
    }
  }

  function hookCalls(win) {
    const NativePC = win.RTCPeerConnection || win.webkitRTCPeerConnection;
    if (!NativePC) return;
    const P = NativePC.prototype;
    const PatchedPC = function RTCPeerConnection(...args) {
      const pc = Reflect.construct(NativePC, args, new.target || PatchedPC);
      // BolBridge's own test page marks its pretend "other person" this way.
      if (args[0] && args[0].bolbridgeIgnore) ignoredPCs.add(pc);
      else notePC(pc);
      return pc;
    };
    PatchedPC.prototype = P;
    Object.setPrototypeOf(PatchedPC, NativePC);
    try {
      Object.defineProperty(P, 'constructor', { value: PatchedPC, writable: true, configurable: true, enumerable: false });
    } catch (err) {
      /* ignore */
    }
    win.RTCPeerConnection = PatchedPC;
    if (win.webkitRTCPeerConnection) win.webkitRTCPeerConnection = PatchedPC;

    const wrap = (name, make) => {
      if (typeof P[name] === 'function') P[name] = make(P[name]);
    };
    // Any use of a connection tells us about it, however it was created.
    for (const name of ['createOffer', 'createAnswer', 'setLocalDescription', 'setRemoteDescription', 'addIceCandidate']) {
      wrap(name, (n) => function (...args) {
        notePC(this);
        return n.apply(this, args);
      });
    }
    wrap('addTrack', (n) => function addTrack(track, ...streams) {
      const sender = n.call(this, track, ...streams);
      if (ignoredPCs.has(this)) {
        ignoredSenders.add(sender);
        return sender;
      }
      notePC(this);
      takeOver(sender, track);
      return sender;
    });
    wrap('addTransceiver', (n) => function addTransceiver(trackOrKind, ...rest) {
      const tr = n.call(this, trackOrKind, ...rest);
      if (ignoredPCs.has(this)) {
        ignoredSenders.add(tr.sender);
        return tr;
      }
      notePC(this);
      if (trackOrKind && typeof trackOrKind === 'object') takeOver(tr.sender, trackOrKind);
      return tr;
    });
    wrap('getStats', (n) => function getStats(selector, ...rest) {
      if (selector && typeof selector === 'object' && selector.kind === 'audio') {
        const e = wrapsByPageTrack.get(selector.id);
        if (e && e.alive) selector = e.outTrack;
      }
      return n.call(this, selector, ...rest);
    });

    const SP = win.RTCRtpSender && win.RTCRtpSender.prototype;
    if (!SP) return;
    const track = desc(SP, 'track');
    if (track && track.get) {
      Object.defineProperty(SP, 'track', {
        configurable: true,
        enumerable: track.enumerable,
        get() {
          return pageTrackOf.has(this) ? pageTrackOf.get(this) : track.get.call(this);
        },
      });
    }
    const nReplace = SP.replaceTrack;
    if (nReplace) {
      SP.replaceTrack = function replaceTrack(t) {
        const later = (v) => {
          scanSoon();
          return v;
        };
        if (ignoredSenders.has(this) || !t || t.kind !== 'audio' || byOutTrack.has(t.id) || !isVoiceCandidate(t)) {
          pageTrackOf.delete(this);
          return nReplace.call(this, t).then(later);
        }
        const e = sendEntryFor(t);
        if (!e) {
          pageTrackOf.delete(this);
          return nReplace.call(this, t).then(later);
        }
        pageTrackOf.set(this, t);
        return nReplace.call(this, e.outTrack).then(later, (err) => {
          pageTrackOf.delete(this);
          throw err;
        });
      };
    }
  }

  function hookPlayback(win) {
    // Pages that play the other person through Web Audio.
    const AC = win.AudioContext || win.webkitAudioContext;
    if (AC && AC.prototype.createMediaStreamSource) {
      const n = AC.prototype.createMediaStreamSource;
      AC.prototype.createMediaStreamSource = function createMediaStreamSource(stream) {
        if (this === ctx) return n.call(this, stream); // our own graph
        stats.pageSources++;
        return n.call(this, swapRemoteStream(stream, win));
      };
    }
    if (win.MediaStreamAudioSourceNode) {
      const NativeNode = win.MediaStreamAudioSourceNode;
      const PatchedNode = function MediaStreamAudioSourceNode(context, options) {
        if (context !== ctx && options && options.mediaStream) {
          stats.pageSources++;
          options = { ...options, mediaStream: swapRemoteStream(options.mediaStream, win) };
        }
        return Reflect.construct(NativeNode, [context, options], new.target || PatchedNode);
      };
      PatchedNode.prototype = NativeNode.prototype;
      Object.setPrototypeOf(PatchedNode, NativeNode);
      try {
        Object.defineProperty(NativeNode.prototype, 'constructor', { value: PatchedNode, writable: true, configurable: true, enumerable: false });
      } catch (err) {
        /* ignore */
      }
      win.MediaStreamAudioSourceNode = PatchedNode;
    }

    // Remember every element the page plays a stream through, so we can turn
    // the original voice down while the translation plays.
    const HP = win.HTMLMediaElement && win.HTMLMediaElement.prototype;
    const so = desc(HP, 'srcObject');
    if (so && so.set) {
      Object.defineProperty(HP, 'srcObject', {
        configurable: true,
        enumerable: so.enumerable,
        get() {
          return so.get.call(this);
        },
        set(value) {
          so.set.call(this, value);
          if (value && !keepers.has(this)) {
            mediaElements.add(this);
            try {
              applyLevels();
            } catch (err) {
              /* ignore */
            }
          }
        },
      });
    }
    // While we turn an element down, the page still reads and sets its own volume.
    const vol = desc(HP, 'volume');
    if (vol && vol.set) {
      Object.defineProperty(HP, 'volume', {
        configurable: true,
        enumerable: vol.enumerable,
        get() {
          if (duckedEls.has(this)) return savedVolume.has(this) ? savedVolume.get(this) : 1;
          return vol.get.call(this);
        },
        set(v) {
          const n = Number(v);
          if (duckedEls.has(this) && n >= 0 && n <= 1) savedVolume.set(this, n);
          else vol.set.call(this, v);
        },
      });
    }
  }

  // A page can reach a fresh same-origin frame before the extension runs in
  // it: cover the frame the moment the page touches it.
  function hookFrames(win) {
    const FP = win.HTMLIFrameElement && win.HTMLIFrameElement.prototype;
    if (!FP) return;
    for (const prop of ['contentWindow', 'contentDocument']) {
      const d = desc(FP, prop);
      if (!d || !d.get) continue;
      Object.defineProperty(FP, prop, {
        configurable: true,
        enumerable: d.enumerable,
        get() {
          const v = d.get.call(this);
          const child = prop === 'contentWindow' ? v : v && v.defaultView;
          if (child) adopt(child); // cross-origin frames run their own engine if the extension covers them
          return v;
        },
      });
    }
  }

  // ---------------------------------------------------------------- bridge
  W.addEventListener('message', (event) => {
    if (event.source !== W || !event.data || event.data.__bb !== FROM_BRIDGE) return;
    const msg = event.data;
    if (msg.type === 'settings' && msg.settings) {
      const wasOn = state.on;
      state.ready = true;
      state.on = !!msg.settings.on;
      state.hearOriginal = !!msg.settings.hearOriginal;
      const wasTab = state.tabAudio;
      state.tabAudio = !!msg.settings.tabAudio;
      if (wasTab !== state.tabAudio) state.speech.in = false; // their side waits for its new session
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
      scanSoon();
    } else if (msg.type === 'session') {
      state.speech[msg.dir] = !!msg.speech;
      applyLevels();
      sendDiag();
    } else if (msg.type === 'tts' && msg.buffer) {
      if (active()) playTranslated(msg.dir, msg.sampleRate || 24000, msg.buffer);
    }
  });

  install(W);
  setInterval(scan, 1500);
  setInterval(sendDiag, 2000);
  post({ type: 'hello' });
})();
