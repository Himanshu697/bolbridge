// BolBridge service worker.
// Holds the WebSocket connections to the translation server, one per call
// direction per frame, and relays audio between the page and the server.
//
//   page (main-world.js) <-postMessage-> bridge.js <-port-> background.js <-WebSocket-> server
import { DEFAULTS, langName } from './shared/languages.js';

let settings = { ...DEFAULTS };
const settingsReady = chrome.storage.local.get(DEFAULTS).then((s) => {
  settings = { ...DEFAULTS, ...s };
});

chrome.runtime.onInstalled.addListener(async () => {
  const current = await chrome.storage.local.get(null);
  await chrome.storage.local.set({ ...DEFAULTS, ...current });
});

// Settings that change what a stream means: reconnect when they change.
const STREAM_KEYS = ['on', 'myLang', 'theirLang', 'useMyVoice', 'announce', 'token', 'serverUrl'];

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local') return;
  for (const [key, { newValue }] of Object.entries(changes)) settings[key] = newValue;
  if (STREAM_KEYS.some((k) => k in changes)) {
    for (const f of frames.values()) {
      closeSockets(f);
      // tab audio: their real voice until a new session is ready
      if (f.virtual) safePost(f, { type: 'session', dir: 'in', speech: false });
    }
  }
  if ('on' in changes && !changes.on.newValue) {
    for (const [tabId, t] of tabAudio) if (t.state === 'on' || t.state === 'starting') stopTabAudio(tabId, 'translation off');
  }
  if ('hearOriginal' in changes) offscreenSend({ type: 'options', hearOriginal: !!changes.hearOriginal.newValue });
});

/** key `${tabId}:${frameId}` -> frame state */
const frames = new Map();
/** tabId -> { captions: [], error: string|null, speech: {out, in} } */
const tabs = new Map();

function tabState(tabId) {
  if (!tabs.has(tabId)) tabs.set(tabId, { captions: [], error: null, speech: { out: null, in: null } });
  return tabs.get(tabId);
}

chrome.tabs.onRemoved.addListener((tabId) => {
  tabs.delete(tabId);
  if (tabAudio.has(tabId)) stopTabAudio(tabId, 'tab closed');
  tabAudio.delete(tabId);
});

// Leaving the call site ends tab audio (moving around inside the site does not).
const tabHosts = new Map();
chrome.tabs.onUpdated.addListener((tabId, change) => {
  if (!change.url) return;
  let host = '';
  try {
    host = new URL(change.url).hostname;
  } catch {
    /* ignore */
  }
  const before = tabHosts.get(tabId);
  tabHosts.set(tabId, host);
  const t = tabAudio.get(tabId);
  if (before && before !== host && t && (t.state === 'on' || t.state === 'starting')) stopTabAudio(tabId, 'left the call site');
});

chrome.runtime.onConnect.addListener((port) => {
  if (port.name === 'bb-offscreen') {
    onOffscreen(port);
    return;
  }
  if (port.name !== 'bb-call' || !port.sender || !port.sender.tab) return;
  const tabId = port.sender.tab.id;
  const frameId = port.sender.frameId || 0;
  const key = `${tabId}:${frameId}`;
  const f = {
    key, port, tabId, frameId,
    platform: 'web',
    callActive: false,
    sockets: { out: null, in: null },
    queues: { out: [], in: [] },
    header: { out: null, in: null },
    blockedUntil: { out: 0, in: 0 },
    diag: null,
    top: frameId === 0,
    net: { out: newNet(), in: newNet() },
  };
  frames.set(key, f);
  port.onMessage.addListener((msg) => onFrameMessage(f, msg));
  port.onDisconnect.addListener(() => {
    closeSockets(f);
    frames.delete(key);
    if (!tabHasCall(tabId)) {
      const v = frames.get(`${tabId}:tab`);
      if (v) closeSockets(v);
    }
    notifyCallState(tabId);
  });
});

function newNet() {
  return { socket: 'none', bytes: 0, results: 0, noSpeech: 0, pending: 0, lastClose: null, lastError: null, lastResultAt: null };
}

async function onFrameMessage(f, msg) {
  await settingsReady;
  switch (msg && msg.type) {
    case 'hello':
      f.platform = String(msg.platform || 'web').slice(0, 40);
      if (tabAudioOn(f.tabId)) safePost(f, { type: 'mode', tabAudio: true });
      break;
    case 'call':
      f.callActive = !!msg.active;
      if (!f.callActive) closeSockets(f);
      if (!tabHasCall(f.tabId)) {
        const v = frames.get(`${f.tabId}:tab`);
        if (v) closeSockets(v); // call over: tab audio stops sending
      }
      notifyCallState(f.tabId);
      break;
    case 'audio':
      if (msg.dir === 'out' || msg.dir === 'in') sendAudio(f, msg.dir, msg.b64);
      break;
    case 'stop':
      if (msg.dir === 'out' || msg.dir === 'in') closeSocket(f, msg.dir);
      break;
    case 'diag':
      f.diag = msg.diag && typeof msg.diag === 'object' ? msg.diag : null;
      f.top = !!msg.top;
      break;
  }
}

function sendAudio(f, dir, b64) {
  if (!settings.on || typeof b64 !== 'string') return;
  if (Date.now() < f.blockedUntil[dir]) return;
  let ws = f.sockets[dir];
  if (!ws || ws.readyState === WebSocket.CLOSING || ws.readyState === WebSocket.CLOSED) {
    ws = openSocket(f, dir);
    if (!ws) return;
  }
  const buf = b64ToBuffer(b64);
  f.net[dir].bytes += buf.byteLength;
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(buf);
  } else {
    const q = f.queues[dir];
    q.push(buf);
    if (q.length > 50) q.shift(); // ~10 s of audio while connecting
  }
}

function openSocket(f, dir) {
  const src = dir === 'out' ? settings.myLang : settings.theirLang;
  const tgt = dir === 'out' ? settings.theirLang : settings.myLang;
  const params = new URLSearchParams({
    src,
    tgt,
    direction: dir,
    platform: f.platform,
    speak: '1',
    voice: dir === 'out' && settings.useMyVoice ? '1' : '0',
    announce: dir === 'out' && settings.announce ? '1' : '0',
  });
  if (settings.token) params.set('token', settings.token);
  let url;
  try {
    const base = new URL(settings.serverUrl);
    base.protocol = base.protocol === 'https:' ? 'wss:' : 'ws:';
    base.pathname = base.pathname.replace(/\/$/, '') + '/ws/translate';
    base.search = params.toString();
    url = base.toString();
  } catch {
    setError(f.tabId, 'The server address in settings is not valid.');
    f.net[dir].lastError = 'bad server address';
    f.blockedUntil[dir] = Date.now() + 10000;
    return null;
  }

  const ws = new WebSocket(url);
  ws.binaryType = 'arraybuffer';
  f.sockets[dir] = ws;
  f.net[dir].socket = 'connecting';
  ws.onopen = () => {
    f.net[dir].socket = 'open';
    setError(f.tabId, null);
    for (const buf of f.queues[dir]) ws.send(buf);
    f.queues[dir] = [];
  };
  ws.onmessage = (ev) => onServerMessage(f, dir, ev.data);
  ws.onerror = () => {
    f.net[dir].lastError = 'cannot reach ' + new URL(url).host;
    setError(f.tabId, 'Cannot reach the translation server. Is it running?');
    f.blockedUntil[dir] = Date.now() + 5000;
    // Never leave the other person in silence: fall back to the real voice.
    tabState(f.tabId).speech[dir] = false;
    safePost(f, { type: 'session', dir, speech: false });
  };
  ws.onclose = (ev) => {
    f.net[dir].socket = 'closed';
    f.net[dir].lastClose = ev.code;
    if (f.sockets[dir] === ws) {
      // Not closed by us (server restarted, tunnel dropped, quota...): give the
      // real voice back until a new session is ready.
      f.sockets[dir] = null;
      tabState(f.tabId).speech[dir] = false;
      safePost(f, { type: 'session', dir, speech: false });
    }
    f.queues[dir] = [];
    if (ev.code === 4401 || ev.code === 4402 || ev.code === 4400) {
      f.blockedUntil[dir] = Date.now() + 30000;
    }
  };
  return ws;
}

function onServerMessage(f, dir, data) {
  if (typeof data !== 'string') {
    const header = f.header[dir] || { sample_rate: 24000 };
    f.header[dir] = null;
    safePost(f, { type: 'tts', dir, sampleRate: header.sample_rate, b64: bufferToB64(data) });
    return;
  }
  let msg;
  try {
    msg = JSON.parse(data);
  } catch {
    return;
  }
  const state = tabState(f.tabId);
  switch (msg.type) {
    case 'ready':
      state.speech[dir] = !!msg.speech;
      safePost(f, { type: 'session', dir, speech: !!msg.speech });
      if (msg.minutes_left != null) chrome.storage.local.set({ minutesLeft: msg.minutes_left });
      break;
    case 'status':
      f.net[dir].pending = msg.pending || 0;
      break;
    case 'notice':
      if (msg.code === 'no_speech') f.net[dir].noSpeech++;
      break;
    case 'result':
    case 'announcement':
      if (msg.type === 'result') {
        f.net[dir].results++;
        f.net[dir].lastResultAt = Date.now();
      }
      addCaption(f.tabId, {
        dir,
        kind: msg.type,
        original: msg.source_text,
        translated: msg.translated_text,
        from: langName(msg.src),
        to: langName(msg.tgt),
        at: Date.now(),
      });
      break;
    case 'audio':
      f.header[dir] = msg;
      break;
    case 'usage':
      chrome.storage.local.set({ minutesLeft: msg.minutes_left });
      break;
    case 'error':
      f.net[dir].lastError = msg.code || msg.message || 'error';
      setError(f.tabId, msg.message || 'Translation error');
      if (msg.code === 'quota_exceeded' || msg.code === 'auth') {
        state.speech[dir] = false;
        safePost(f, { type: 'session', dir, speech: false });
      }
      break;
  }
}

function safePost(f, msg) {
  try {
    f.port.postMessage(msg);
  } catch {
    /* frame went away */
  }
}

function addCaption(tabId, caption) {
  const state = tabState(tabId);
  state.captions.push(caption);
  if (state.captions.length > 20) state.captions.shift();
  chrome.tabs.sendMessage(tabId, { type: 'bb-caption', caption }, { frameId: 0 }).catch(() => {});
}

function setError(tabId, error) {
  tabState(tabId).error = error;
  chrome.tabs.sendMessage(tabId, { type: 'bb-error', error }, { frameId: 0 }).catch(() => {});
}

function notifyCallState(tabId) {
  const active = [...frames.values()].some((f) => f.tabId === tabId && f.callActive);
  chrome.tabs.sendMessage(tabId, { type: 'bb-call-state', active }, { frameId: 0 }).catch(() => {});
}

function closeSocket(f, dir) {
  const ws = f.sockets[dir];
  f.sockets[dir] = null;
  if (ws) f.net[dir].socket = 'closed';
  f.queues[dir] = [];
  f.header[dir] = null;
  if (ws && ws.readyState <= WebSocket.OPEN) {
    try {
      ws.close(1000);
    } catch {
      /* ignore */
    }
  }
}

function closeSockets(f) {
  closeSocket(f, 'out');
  closeSocket(f, 'in');
}

// ---- tab audio: hear the other person from the call tab's own sound ----
// The popup (opened by you on the call tab) gets a capture id for the tab; an
// offscreen page captures it, plays the call back to you and sends it here.
// It acts as one more "frame" of the tab, carrying only their voice ('in').
/** tabId -> { state: 'starting'|'on'|'error'|'stopped', error, level, original, chunks, played, why } */
const tabAudio = new Map();
let offscreenPort = null;
const offscreenQueue = [];

const tabAudioOn = (tabId) => {
  const t = tabAudio.get(tabId);
  return !!t && t.state === 'on';
};
const tabHasCall = (tabId) => [...frames.values()].some((f) => f.tabId === tabId && !f.virtual && f.callActive);

function offscreenSend(msg) {
  if (offscreenPort) {
    try {
      offscreenPort.postMessage(msg);
      return;
    } catch {
      offscreenPort = null;
    }
  }
  if (msg.type !== 'tts') offscreenQueue.push(msg);
}

async function ensureOffscreen() {
  const open = await chrome.runtime.getContexts({ contextTypes: ['OFFSCREEN_DOCUMENT'] });
  if (open.length) return;
  try {
    await chrome.offscreen.createDocument({
      url: 'src/offscreen/offscreen.html',
      reasons: ['USER_MEDIA'],
      justification: 'Hear the other person in a call so BolBridge can translate them.',
    });
  } catch (e) {
    if (!/single offscreen|already/i.test(String(e))) throw e;
  }
}

function onOffscreen(port) {
  offscreenPort = port;
  port.onMessage.addListener((msg) => onOffscreenMessage(msg));
  port.onDisconnect.addListener(() => {
    if (offscreenPort === port) offscreenPort = null;
  });
  while (offscreenQueue.length) port.postMessage(offscreenQueue.shift());
}

async function onOffscreenMessage(msg) {
  await settingsReady;
  if (!msg) return;
  const t = tabAudio.get(msg.tabId);
  switch (msg.type) {
    case 'hello':
      // after a service worker restart: pick up the captures still running
      for (const tabId of msg.active || []) {
        if (tabAudioOn(tabId)) continue;
        tabAudio.set(tabId, { state: 'on', error: null });
        tabAudioFrame(tabId);
        setTabMode(tabId, true);
      }
      break;
    case 'started':
      tabAudio.set(msg.tabId, { ...(t || {}), state: 'on', error: null });
      setTabMode(msg.tabId, true);
      break;
    case 'error':
      tabAudio.set(msg.tabId, { state: 'error', error: msg.error });
      dropTabAudioFrame(msg.tabId);
      setTabMode(msg.tabId, false);
      break;
    case 'stopped':
      endTabAudio(msg.tabId, msg.why);
      break;
    case 'level':
      if (t) Object.assign(t, { level: msg.level, original: msg.original, chunks: msg.chunks, played: msg.played, audio: msg.audio });
      break;
    case 'audio':
      // only during a call, with translation on
      if (!t || t.state !== 'on' || !settings.on || !tabHasCall(msg.tabId)) return;
      sendAudio(tabAudioFrame(msg.tabId), 'in', msg.b64);
      break;
  }
}

function tabAudioFrame(tabId) {
  const key = `${tabId}:tab`;
  let f = frames.get(key);
  if (!f) {
    const real = [...frames.values()].find((x) => x.tabId === tabId && !x.virtual);
    f = {
      key, tabId, frameId: 'tab', virtual: true,
      platform: real ? real.platform : 'web',
      callActive: false,
      sockets: { out: null, in: null },
      queues: { out: [], in: [] },
      header: { out: null, in: null },
      blockedUntil: { out: 0, in: 0 },
      diag: null,
      top: false,
      net: { out: newNet(), in: newNet() },
      // translations and session changes go to the offscreen page
      port: { postMessage: (m) => offscreenSend({ ...m, tabId }) },
    };
    frames.set(key, f);
  }
  return f;
}

function dropTabAudioFrame(tabId) {
  const f = frames.get(`${tabId}:tab`);
  if (!f) return;
  closeSockets(f);
  frames.delete(f.key);
}

/** Tell the page whether their voice now comes from the tab's sound. */
function setTabMode(tabId, on) {
  for (const f of frames.values()) {
    if (f.tabId !== tabId || f.virtual) continue;
    safePost(f, { type: 'mode', tabAudio: on });
    if (on) closeSocket(f, 'in');
  }
}

async function startTabAudio(tabId) {
  await settingsReady;
  if (typeof tabId !== 'number') throw new Error('bad request');
  // Allowed once you have clicked the extension on this tab (the popup).
  // The id is made here so the offscreen page may use it.
  const streamId = await chrome.tabCapture.getMediaStreamId({ targetTabId: tabId });
  tabAudio.set(tabId, { state: 'starting', error: null });
  tabAudioFrame(tabId);
  await ensureOffscreen();
  offscreenSend({ type: 'start', tabId, streamId, hearOriginal: !!settings.hearOriginal });
}

function endTabAudio(tabId, why) {
  dropTabAudioFrame(tabId);
  if (tabAudio.has(tabId)) tabAudio.set(tabId, { state: 'stopped', error: null, why: why || null });
  setTabMode(tabId, false);
}

function stopTabAudio(tabId, why) {
  offscreenSend({ type: 'stop', tabId });
  endTabAudio(tabId, why);
}

// ---- popup and web app ----
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || typeof msg !== 'object') return;
  if (msg.type === 'bb-status') {
    const state = tabs.get(msg.tabId) || { captions: [], error: null, speech: {} };
    const tabFrames = [...frames.values()].filter((f) => f.tabId === msg.tabId);
    const real = tabFrames.filter((f) => !f.virtual);
    sendResponse({
      injected: real.length > 0,
      callActive: real.some((f) => f.callActive),
      connected: tabFrames.some((f) => f.sockets.out || f.sockets.in),
      captions: state.captions.slice(-4),
      error: state.error,
      speech: state.speech,
      tabAudio: tabAudio.get(msg.tabId) || null,
      diag: tabDiag(tabFrames, msg.tabId),
    });
    return;
  }
  if (msg.type === 'bb-tab-audio-start') {
    startTabAudio(msg.tabId).then(
      () => sendResponse({ ok: true }),
      (e) => sendResponse({ ok: false, error: String((e && e.message) || e) }),
    );
    return true;
  }
  if (msg.type === 'bb-enable-site') {
    enableSite(msg.origin).then(sendResponse, (e) => sendResponse({ ok: false, error: String(e) }));
    return true;
  }
});

/** One summary for the popup: the frame that holds the call, plus its sockets. */
function tabDiag(tabFrames, tabId) {
  const withPage = tabFrames.filter((f) => f.diag);
  const busy = (f) => (f.diag.mics || 0) + (f.diag.wraps || 0) + (f.diag.theirTracks || 0) + (f.diag.calls || 0);
  const best = withPage.sort((a, b) => busy(b) - busy(a) || Number(b.top) - Number(a.top))[0];
  const net = { out: newNet(), in: newNet() };
  for (const f of tabFrames) {
    for (const dir of ['out', 'in']) {
      const a = net[dir];
      const b = f.net[dir];
      a.bytes += b.bytes;
      a.results += b.results;
      a.noSpeech += b.noSpeech;
      a.pending += b.pending;
      if (b.socket !== 'none' && (a.socket === 'none' || b.socket === 'open')) a.socket = b.socket;
      a.lastClose = b.lastClose ?? a.lastClose;
      a.lastError = b.lastError ?? a.lastError;
      a.lastResultAt = Math.max(a.lastResultAt || 0, b.lastResultAt || 0) || null;
    }
  }
  return {
    version: chrome.runtime.getManifest().version,
    page: best ? best.diag : null,
    frames: tabFrames.filter((f) => !f.virtual).length,
    tabAudio: tabAudio.get(tabId) || null,
    // every frame that reported, for "Copy diagnostics"
    frameList: withPage.map((f) => ({ frameId: f.frameId, top: f.top, platform: f.platform, diag: f.diag })),
    net,
    server: settings.serverUrl,
    signedIn: !!settings.token,
    on: !!settings.on,
    langs: `${settings.myLang}>${settings.theirLang}`,
  };
}

async function enableSite(origin) {
  const url = new URL(origin);
  const id = 'site-' + url.hostname.replace(/[^a-z0-9]/gi, '-');
  const matches = [`${url.protocol}//${url.hostname}/*`];
  const existing = await chrome.scripting.getRegisteredContentScripts({ ids: [id + '-main', id + '-bridge'] });
  if (existing.length) return { ok: true, already: true };
  await chrome.scripting.registerContentScripts([
    { id: id + '-main', matches, js: ['src/content/main-world.js'], runAt: 'document_start', world: 'MAIN', allFrames: true, persistAcrossSessions: true },
    { id: id + '-bridge', matches, js: ['src/content/bridge.js'], runAt: 'document_start', allFrames: true, persistAcrossSessions: true },
  ]);
  return { ok: true };
}

// Messages from the BolBridge web app (see manifest "externally_connectable").
chrome.runtime.onMessageExternal.addListener((msg, sender, sendResponse) => {
  if (!msg || typeof msg !== 'object') return;
  if (msg.type === 'BB_PING') {
    sendResponse({ ok: true, version: chrome.runtime.getManifest().version, connected: !!settings.token });
  } else if (msg.type === 'BB_AUTH' && typeof msg.token === 'string') {
    const update = { token: msg.token, userName: msg.name || null };
    if (typeof msg.apiUrl === 'string' && /^https?:\/\//.test(msg.apiUrl)) update.serverUrl = msg.apiUrl;
    if (sender.origin) update.webUrl = sender.origin;
    if (typeof msg.speaks === 'string') update.myLang = msg.speaks;
    chrome.storage.local.set(update).then(() => sendResponse({ ok: true }));
    return true;
  } else if (msg.type === 'BB_LOGOUT') {
    chrome.storage.local.set({ token: null, userName: null }).then(() => sendResponse({ ok: true }));
    return true;
  }
});

// ---- base64 helpers (runtime messages cannot carry ArrayBuffers) ----
function bufferToB64(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary);
}

function b64ToBuffer(b64) {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}
