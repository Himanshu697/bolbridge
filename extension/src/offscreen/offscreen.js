// BolBridge "tab audio": hears the other person by capturing the call tab's
// own sound, however the site plays it (WebRTC, Web Audio, WebAssembly...).
// Chrome mutes a tab while it is captured, so this page also plays the call
// back to you: the original at full volume, or turned down while the
// translation speaks. The translation of their voice plays here too, so it is
// never captured and translated again.
//
//   offscreen.js <-port 'bb-offscreen'-> background.js <-WebSocket-> server
const TARGET_RATE = 16000;
const captures = new Map(); // tabId -> capture
const outbox = [];
let port = null;

function send(msg) {
  if (port) {
    try {
      port.postMessage(msg);
      return;
    } catch (e) {
      port = null;
    }
  }
  if (msg.type !== 'audio') outbox.push(msg);
}

function connect() {
  port = chrome.runtime.connect({ name: 'bb-offscreen' });
  port.onMessage.addListener(onMessage);
  port.onDisconnect.addListener(() => {
    port = null;
    setTimeout(connect, 300); // the service worker restarted: reconnect
  });
  port.postMessage({ type: 'hello', active: [...captures.keys()] });
  while (outbox.length) port.postMessage(outbox.shift());
}

function onMessage(msg) {
  const c = captures.get(msg.tabId);
  switch (msg.type) {
    case 'start':
      start(msg.tabId, msg.streamId, msg).catch((err) => send({ type: 'error', tabId: msg.tabId, error: String((err && err.message) || err) }));
      break;
    case 'stop':
      stop(msg.tabId, 'asked');
      break;
    case 'session':
      if (c) {
        c.speech = !!msg.speech;
        levels(c);
      }
      break;
    case 'options':
      for (const x of captures.values()) {
        x.hearOriginal = !!msg.hearOriginal;
        levels(x);
      }
      break;
    case 'tts':
      if (c && typeof msg.b64 === 'string') play(c, msg.sampleRate || 24000, fromB64(msg.b64));
      break;
  }
}

async function start(tabId, streamId, opts) {
  stop(tabId, 'restart');
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: { mandatory: { chromeMediaSource: 'tab', chromeMediaSourceId: streamId } },
    video: false,
  });
  const ctx = new AudioContext();
  const src = ctx.createMediaStreamSource(stream);
  const original = ctx.createGain(); // the call as you would normally hear it
  src.connect(original);
  original.connect(ctx.destination);
  const meter = ctx.createAnalyser();
  meter.fftSize = 1024;
  src.connect(meter);
  const proc = ctx.createScriptProcessor(4096, 1, 1);
  const sink = ctx.createGain();
  sink.gain.value = 0;
  src.connect(proc);
  proc.connect(sink);
  sink.connect(ctx.destination);
  const voice = ctx.createGain(); // the translation of their voice
  voice.connect(ctx.destination);
  const c = {
    tabId, stream, ctx, original, meter, proc, voice,
    nextStart: 0, speech: false, hearOriginal: !!opts.hearOriginal, chunks: 0, played: 0, hist: [],
  };
  proc.onaudioprocess = (e) => {
    const pcm = resample(e.inputBuffer.getChannelData(0), ctx.sampleRate);
    c.chunks++;
    send({ type: 'audio', tabId, b64: toB64(pcm.buffer) });
  };
  for (const t of stream.getAudioTracks()) t.addEventListener('ended', () => stop(tabId, 'capture ended'));
  captures.set(tabId, c);
  levels(c);
  if (ctx.state === 'suspended') ctx.resume().catch(() => {});
  send({ type: 'started', tabId });
}

function levels(c) {
  c.original.gain.value = c.speech ? (c.hearOriginal ? 0.15 : 0) : 1;
}

function stop(tabId, why) {
  const c = captures.get(tabId);
  if (!c) return;
  captures.delete(tabId);
  c.proc.onaudioprocess = null;
  for (const t of c.stream.getTracks()) t.stop(); // Chrome plays the tab normally again
  c.ctx.close().catch(() => {});
  send({ type: 'stopped', tabId, why });
}

function play(c, sampleRate, buffer) {
  const pcm = new Int16Array(buffer);
  if (!pcm.length || c.ctx.state === 'closed') return;
  const audioBuffer = c.ctx.createBuffer(1, pcm.length, sampleRate);
  const ch = audioBuffer.getChannelData(0);
  for (let i = 0; i < pcm.length; i++) ch[i] = pcm[i] / 32768;
  const node = c.ctx.createBufferSource();
  node.buffer = audioBuffer;
  node.connect(c.voice);
  // queue sentences one after another, never on top of each other
  const startAt = Math.max(c.ctx.currentTime + 0.02, c.nextStart);
  node.start(startAt);
  c.nextStart = startAt + audioBuffer.duration;
  c.played++;
}

// Loudness of the tab over the last ~5 s, for Diagnostics.
const meterBuf = new Float32Array(1024);
setInterval(() => {
  for (const c of captures.values()) {
    c.meter.getFloatTimeDomainData(meterBuf);
    let s = 0;
    for (let i = 0; i < meterBuf.length; i++) s += meterBuf[i] * meterBuf[i];
    c.hist.push(Math.sqrt(s / meterBuf.length));
    if (c.hist.length > 20) c.hist.shift();
  }
}, 250);
setInterval(() => {
  for (const c of captures.values()) {
    send({
      type: 'level', tabId: c.tabId, level: Math.round(Math.max(0, ...c.hist) * 1000) / 1000,
      original: c.original.gain.value, chunks: c.chunks, played: c.played, audio: c.ctx.state,
    });
  }
}, 1000);

function resample(input, inRate) {
  const ratio = inRate / TARGET_RATE;
  const outLen = Math.floor(input.length / ratio);
  const out = new Int16Array(outLen);
  for (let i = 0; i < outLen; i++) {
    const start = Math.floor(i * ratio);
    const end = Math.min(input.length, Math.max(start + 1, Math.floor((i + 1) * ratio)));
    let sum = 0;
    for (let j = start; j < end; j++) sum += input[j];
    const v = Math.max(-1, Math.min(1, sum / (end - start)));
    out[i] = v < 0 ? v * 0x8000 : v * 0x7fff;
  }
  return out;
}

function toB64(buffer) {
  const bytes = new Uint8Array(buffer);
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

function fromB64(b64) {
  const s = atob(b64);
  const bytes = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) bytes[i] = s.charCodeAt(i);
  return bytes.buffer;
}

connect();
