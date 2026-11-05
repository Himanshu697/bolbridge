// BolBridge bridge: runs in the extension's isolated world on call pages.
// Relays audio between main-world.js (the page) and the service worker, and
// draws the on-page overlay (status pill + live subtitles) in the top frame.
(() => {
  if (window.__bolbridgeBridge) return;
  window.__bolbridgeBridge = true;

  const FROM_MAIN = 'bb-main';
  const TO_MAIN = 'bb-bridge';
  const IS_TOP = window.top === window;
  const NAMES = {
    hi: 'Hindi', en: 'English', fr: 'French', es: 'Spanish', it: 'Italian', pt: 'Portuguese',
    ja: 'Japanese', zh: 'Mandarin', ar: 'Arabic', de: 'German', ru: 'Russian', ko: 'Korean',
    ta: 'Tamil', bn: 'Bengali', mr: 'Marathi', ur: 'Urdu',
  };
  const PLATFORMS = [
    ['web.whatsapp.com', 'whatsapp-web'],
    ['ome.tv', 'ometv'],
    ['meet.google.com', 'google-meet'],
    ['zoom.us', 'zoom-web'],
  ];
  // about:blank frames have no host of their own: use the page that made them
  const host = location.hostname || (location.ancestorOrigins && location.ancestorOrigins.length ? hostOf(location.ancestorOrigins[0]) : '');
  const platform = (PLATFORMS.find(([h]) => host === h || host.endsWith('.' + h)) || [null, host])[1];

  let settings = null;
  let port = null;

  function hostOf(origin) {
    try {
      return new URL(origin).hostname;
    } catch (e) {
      return '';
    }
  }

  function getPort() {
    if (port) return port;
    try {
      port = chrome.runtime.connect({ name: 'bb-call' });
    } catch (e) {
      return null; // extension was reloaded; this page needs a refresh
    }
    port.postMessage({ type: 'hello', platform });
    port.onMessage.addListener(onBackground);
    port.onDisconnect.addListener(() => {
      port = null;
    });
    return port;
  }

  const toMain = (msg, transfer) => window.postMessage({ ...msg, __bb: TO_MAIN }, '*', transfer || []);

  let lastLangs = null;
  let tabAudio = false; // their voice comes from the tab's sound (see offscreen.js)
  function sendSettings() {
    if (!settings) return;
    const langs = settings.myLang + '>' + settings.theirLang;
    const changed = lastLangs !== null && lastLangs !== langs;
    lastLangs = langs;
    toMain({ type: 'settings', settings: { on: settings.on, hearOriginal: settings.hearOriginal, changed, tabAudio } });
    overlay.render();
  }

  chrome.storage.local.get(null).then((s) => {
    settings = s;
    sendSettings();
  });
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local' || !settings) return;
    for (const [k, { newValue }] of Object.entries(changes)) settings[k] = newValue;
    sendSettings();
  });

  window.addEventListener('message', (event) => {
    if (event.source !== window || !event.data || event.data.__bb !== FROM_MAIN) return;
    const msg = event.data;
    switch (msg.type) {
      case 'hello':
        sendSettings();
        break;
      case 'audio':
        if (settings && settings.on && msg.buffer instanceof ArrayBuffer && (msg.dir === 'out' || msg.dir === 'in')) {
          const p = getPort();
          if (p) p.postMessage({ type: 'audio', dir: msg.dir, b64: toB64(msg.buffer) });
        }
        break;
      case 'call': {
        const p = getPort();
        if (p) p.postMessage({ type: 'call', active: !!msg.active });
        if (IS_TOP) overlay.setCall(!!msg.active);
        break;
      }
      case 'stop':
        if (port) port.postMessage({ type: 'stop', dir: msg.dir });
        break;
      case 'diag': {
        // Only frames that touch a microphone or a call report in; idle frames stay quiet.
        const d = msg.diag || {};
        if (!port && !(d.gumCalls > 0 || d.calls > 0 || d.theirTracks > 0 || d.mics > 0)) break;
        const p = getPort();
        if (p) p.postMessage({ type: 'diag', diag: d, top: IS_TOP });
        break;
      }
    }
  });

  function onBackground(msg) {
    if (msg.type === 'tts' && typeof msg.b64 === 'string') {
      const buffer = fromB64(msg.b64);
      toMain({ type: 'tts', dir: msg.dir, sampleRate: msg.sampleRate, buffer }, [buffer]);
    } else if (msg.type === 'session') {
      toMain({ type: 'session', dir: msg.dir, speech: msg.speech });
    } else if (msg.type === 'mode') {
      tabAudio = !!msg.tabAudio;
      sendSettings();
    }
  }

  chrome.runtime.onMessage.addListener((msg) => {
    if (!IS_TOP || !msg) return;
    if (msg.type === 'bb-caption') overlay.caption(msg.caption);
    else if (msg.type === 'bb-call-state') overlay.setCall(msg.active);
    else if (msg.type === 'bb-error') overlay.error(msg.error);
  });

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

  // ------------------------------------------------------------ overlay
  const overlay = (() => {
    if (!IS_TOP) return { render() {}, caption() {}, setCall() {}, error() {} };

    let root = null;
    let els = {};
    let callActive = false;
    let hidden = false;
    let lastCaptionAt = 0;

    const css = `
      :host { all: initial; }
      .wrap { position: fixed; inset: 0; pointer-events: none; z-index: 2147483646;
        font-family: Inter, system-ui, -apple-system, "Segoe UI", "Noto Sans Devanagari", sans-serif; }
      .pill { position: absolute; top: 12px; left: 50%; transform: translateX(-50%); pointer-events: auto;
        display: flex; align-items: center; gap: 10px; background: #fff; color: #0F1222;
        border-radius: 999px; padding: 6px 6px 6px 14px; box-shadow: 0 8px 24px rgba(0,0,0,.25); font-size: 13px; }
      .dot { width: 8px; height: 8px; border-radius: 999px; background: #3D4BFF; }
      .dot.off { background: #8A90A6; }
      .langs { color: #4A5068; }
      .badge { background: #FFF1E6; color: #B4500C; font-weight: 600; padding: 2px 8px; border-radius: 999px; font-size: 12px; }
      button { font: inherit; cursor: pointer; border: 0; border-radius: 999px; min-height: 32px; padding: 0 12px;
        background: #0F1222; color: #fff; font-weight: 600; }
      button.ghost { background: transparent; color: #4A5068; padding: 0 8px; }
      .subs { position: absolute; left: 50%; bottom: 96px; transform: translateX(-50%); width: min(760px, calc(100vw - 32px));
        display: flex; flex-direction: column; gap: 8px; }
      .card { background: rgba(15,18,34,.92); color: #fff; border-radius: 16px; padding: 12px 16px; }
      .label { font-size: 11px; font-weight: 700; letter-spacing: .06em; color: #FFB27A; text-transform: uppercase; }
      .big { font-size: 20px; font-weight: 600; line-height: 1.35; }
      .small { font-size: 13px; color: #C3C8D8; }
      .mine { align-self: flex-end; max-width: 80%; background: rgba(61,75,255,.92); }
      .mine .label { color: #E4E7FF; }
      .err { background: #FFF1E6; color: #7A3608; font-size: 13px; border-radius: 12px; padding: 8px 12px; align-self: center; }
      .hidden { display: none !important; }
    `;

    function build() {
      const host = document.createElement('div');
      host.id = 'bolbridge-overlay';
      const shadow = host.attachShadow({ mode: 'closed' });
      const style = document.createElement('style');
      style.textContent = css;
      shadow.appendChild(style);
      const wrap = el('div', 'wrap');
      const pill = el('div', 'pill');
      const dot = el('span', 'dot');
      const title = el('strong', '', 'BolBridge');
      const langs = el('span', 'langs');
      const badge = el('span', 'badge', 'Your voice');
      const toggle = el('button', '', 'Pause');
      toggle.addEventListener('click', () => chrome.storage.local.set({ on: !(settings && settings.on) }));
      const close = el('button', 'ghost', '✕');
      close.setAttribute('aria-label', 'Hide BolBridge overlay');
      close.addEventListener('click', () => {
        hidden = true;
        render();
      });
      pill.append(dot, title, langs, badge, toggle, close);
      const subs = el('div', 'subs');
      const theirs = el('div', 'card hidden');
      const theirsLabel = el('div', 'label');
      const theirsBig = el('div', 'big');
      const theirsSmall = el('div', 'small');
      theirs.append(theirsLabel, theirsBig, theirsSmall);
      const mine = el('div', 'card mine hidden');
      const mineLabel = el('div', 'label');
      const mineBig = el('div', 'small');
      mine.append(mineLabel, mineBig);
      const err = el('div', 'err hidden');
      subs.append(theirs, mine, err);
      wrap.append(pill, subs);
      shadow.appendChild(wrap);
      (document.body || document.documentElement).appendChild(host);
      root = host;
      els = { wrap, pill, dot, langs, badge, toggle, theirs, theirsLabel, theirsBig, theirsSmall, mine, mineLabel, mineBig, err };
    }

    function el(tag, cls, text) {
      const e = document.createElement(tag);
      if (cls) e.className = cls;
      if (text) e.textContent = text;
      return e;
    }

    function ensure() {
      if (!root || !root.isConnected) {
        if (!document.body) return false;
        build();
      }
      return true;
    }

    function render() {
      if (!settings) return;
      const show = !hidden && (callActive || Date.now() - lastCaptionAt < 15000);
      if (!show) {
        if (root) root.style.display = 'none';
        return;
      }
      if (!ensure()) return;
      root.style.display = '';
      const mine = NAMES[settings.myLang] || settings.myLang;
      const theirs = NAMES[settings.theirLang] || settings.theirLang;
      els.langs.textContent = `${mine} ⇄ ${theirs}`;
      els.dot.className = settings.on ? 'dot' : 'dot off';
      els.toggle.textContent = settings.on ? 'Pause' : 'Translate';
      els.badge.classList.toggle('hidden', !(settings.on && settings.useMyVoice));
    }

    function caption(c) {
      lastCaptionAt = Date.now();
      hidden = false;
      render();
      if (!root) return;
      if (c.dir === 'in') {
        els.theirsLabel.textContent = `Them · ${c.from} → ${c.to}`;
        els.theirsBig.textContent = c.translated;
        els.theirsSmall.textContent = c.original;
        els.theirs.classList.remove('hidden');
      } else {
        els.mineLabel.textContent = c.kind === 'announcement' ? 'Notice sent' : `You · they hear ${c.to}`;
        els.mineBig.textContent = c.translated;
        els.mine.classList.remove('hidden');
      }
    }

    function setCall(active) {
      callActive = !!active;
      if (callActive) hidden = false;
      render();
    }

    function error(message) {
      if (!root) return;
      els.err.textContent = message || '';
      els.err.classList.toggle('hidden', !message);
    }

    setInterval(render, 5000);
    return { render, caption, setCall, error };
  })();
})();
