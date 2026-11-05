import { DEFAULTS, LANGUAGES, hasVoice, langName, siteFor } from '../shared/languages.js';

const $ = (id) => document.getElementById(id);
let settings = { ...DEFAULTS };
let tab = null;
let lastStatus = null;

async function init() {
  settings = { ...DEFAULTS, ...(await chrome.storage.local.get(DEFAULTS)) };
  // ?tab=<id> shows another tab's status (handy when the popup is opened as a page for debugging)
  const forced = Number(new URLSearchParams(location.search).get('tab'));
  [tab] = forced ? [await chrome.tabs.get(forced)] : await chrome.tabs.query({ active: true, currentWindow: true });

  for (const select of [$('myLang'), $('theirLang')]) {
    for (const l of LANGUAGES) {
      const opt = document.createElement('option');
      opt.value = l.code;
      opt.textContent = l.voice ? l.name : `${l.name} (subtitles)`;
      select.appendChild(opt);
    }
  }

  $('onSwitch').addEventListener('click', () => save({ on: !settings.on }));
  $('myLang').addEventListener('change', (e) => save({ myLang: e.target.value }));
  $('theirLang').addEventListener('change', (e) => save({ theirLang: e.target.value }));
  $('swap').addEventListener('click', () => save({ myLang: settings.theirLang, theirLang: settings.myLang }));
  for (const btn of document.querySelectorAll('.toggles .switch')) {
    btn.addEventListener('click', () => save({ [btn.dataset.key]: !settings[btn.dataset.key] }));
  }
  $('serverUrl').addEventListener('change', (e) => save({ serverUrl: e.target.value.trim() || DEFAULTS.serverUrl }));
  $('webUrl').addEventListener('change', (e) => save({ webUrl: e.target.value.trim() || DEFAULTS.webUrl }));
  $('tokenInput').addEventListener('change', (e) => {
    const token = e.target.value.trim();
    e.target.value = '';
    save({ token: token || null, minutesLeft: null });
  });
  $('openDashboard').addEventListener('click', (e) => openWeb(e, '/app'));
  $('getMinutes').addEventListener('click', (e) => openWeb(e, '/app/plan'));
  $('connectAccount').addEventListener('click', (e) => openWeb(e, '/connect-extension'));
  $('enableSiteBtn').addEventListener('click', enableSite);
  $('testServer').addEventListener('click', testServer);
  $('copyDiag').addEventListener('click', copyDiag);

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return;
    for (const [k, { newValue }] of Object.entries(changes)) settings[k] = newValue;
    render();
  });

  render();
  await refreshStatus();
  setInterval(refreshStatus, 1000);
}

function save(patch) {
  Object.assign(settings, patch);
  render();
  return chrome.storage.local.set(patch);
}

function openWeb(event, path) {
  event.preventDefault();
  const base = (settings.webUrl || DEFAULTS.webUrl).replace(/\/$/, '');
  chrome.tabs.create({ url: base + path });
}

function setSwitch(el, on) {
  el.setAttribute('aria-checked', on ? 'true' : 'false');
}

function render() {
  setSwitch($('onSwitch'), settings.on);
  $('mainCard').classList.toggle('on', !!settings.on);
  $('onLabel').textContent = settings.on ? 'Translation on' : 'Translation off';
  $('onSub').textContent = settings.on ? 'They hear you in their language' : 'Tap to translate this call';
  $('myLang').value = settings.myLang;
  $('theirLang').value = settings.theirLang;
  for (const btn of document.querySelectorAll('.toggles .switch')) setSwitch(btn, !!settings[btn.dataset.key]);
  if (document.activeElement !== $('serverUrl')) $('serverUrl').value = settings.serverUrl || '';
  if (document.activeElement !== $('webUrl')) $('webUrl').value = settings.webUrl || '';

  const warn = [];
  if (!hasVoice(settings.theirLang)) warn.push(`No ${langName(settings.theirLang)} voice yet: they will hear your real voice, and you get subtitles.`);
  if (!hasVoice(settings.myLang)) warn.push(`No ${langName(settings.myLang)} voice yet: you will see their words as subtitles.`);
  $('voiceWarning').textContent = warn.join(' ');
  $('voiceWarning').classList.toggle('hidden', warn.length === 0);

  $('accountLine').textContent = settings.token
    ? `Signed in${settings.userName ? ' as ' + settings.userName : ''}. Minutes are counted on your plan.`
    : 'Not signed in. Works in developer mode; sign in to use your plan.';
  $('connectAccount').textContent = settings.token ? 'Reconnect account' : 'Connect my account';
  $('minutes').textContent = settings.token && settings.minutesLeft != null
    ? `${Math.floor(settings.minutesLeft)} min left`
    : settings.token ? 'Signed in' : 'Not signed in';
}

async function refreshStatus() {
  const site = tab && tab.url ? siteFor(tab.url) : null;
  let status = { injected: false, callActive: false, captions: [], error: null };
  if (tab) {
    try {
      status = await chrome.runtime.sendMessage({ type: 'bb-status', tabId: tab.id });
    } catch {
      /* service worker waking up */
    }
  }
  $('siteName').textContent = site ? site.name : tab && tab.url ? hostOf(tab.url) : 'This tab';
  const supported = !!site || status.injected;
  $('enableSite').classList.toggle('hidden', supported || !isWeb(tab && tab.url));
  let text;
  if (!supported) text = 'not set up';
  else if (!status.injected) text = 'refresh the page to start';
  else if (status.callActive) text = settings.on ? 'call found, translating' : 'call found, translation off';
  else text = 'waiting for a call';
  $('statusText').textContent = text;
  $('statusDot').classList.toggle('on', !!(status.callActive && settings.on));

  $('error').textContent = status.error || '';
  $('error').classList.toggle('hidden', !status.error);

  lastStatus = status;
  renderDiag(status);

  const box = $('captions');
  box.replaceChildren();
  if (!status.captions || status.captions.length === 0) {
    const p = document.createElement('p');
    p.className = 'muted';
    p.textContent = 'Subtitles show here during a call.';
    box.appendChild(p);
  } else {
    for (const c of status.captions.slice(-2)) {
      const p = document.createElement('p');
      const who = document.createElement('strong');
      who.textContent = c.dir === 'in' ? 'They: ' : 'You: ';
      p.append(who, document.createTextNode(c.translated));
      box.appendChild(p);
    }
  }
}

async function enableSite() {
  if (!tab || !tab.url) return;
  const origin = new URL(tab.url).origin;
  const granted = await chrome.permissions.request({ origins: [origin + '/*'] });
  if (!granted) return;
  const res = await chrome.runtime.sendMessage({ type: 'bb-enable-site', origin });
  if (res && res.ok) {
    $('statusText').textContent = 'ready, reloading the page…';
    chrome.tabs.reload(tab.id);
  }
}

// ------------------------------------------------------------ diagnostics
const CLOSE_REASONS = {
  1006: 'connection dropped (server stopped, or the address changed)',
  4400: 'language not supported',
  4401: 'login needed: paste a fresh account key below',
  4402: 'no minutes left this month',
};

function seconds(bytes) {
  return Math.round(bytes / 32000); // 16 kHz, 16-bit mono
}

function serverLine(n) {
  if (n.socket === 'open') return ['ok', 'connected'];
  if (n.socket === 'connecting') return ['wait', 'connecting…'];
  if (n.lastClose && CLOSE_REASONS[n.lastClose]) return ['bad', CLOSE_REASONS[n.lastClose]];
  if (n.lastError) return ['bad', n.lastError];
  if (n.socket === 'closed') return ['wait', `closed${n.lastClose ? ' (code ' + n.lastClose + ')' : ''}`];
  return ['wait', 'not used yet'];
}

function diagRows(status) {
  const d = status.diag;
  const rows = [];
  if (!status.injected || !d) {
    rows.push(['bad', 'BolBridge is not running on this page. Reload the call page (after installing or updating the extension).']);
    return rows;
  }
  const p = d.page;
  if (!p) {
    rows.push(['wait', 'Page ready. Waiting for the call to use the microphone.']);
  } else {
    if (p.mics > 0) rows.push(p.micMuted ? ['warn', 'Microphone captured, but you are muted in the call.'] : ['ok', 'Microphone captured.']);
    else rows.push(['wait', p.micRequests > 0 ? 'Microphone was released.' : 'No microphone yet: join the call.']);
    if (p.audio === 'running') rows.push(['ok', `Audio engine running (${p.sampleRate} Hz).`]);
    else if (p.audio === 'suspended') rows.push(['bad', 'Audio is paused by Chrome: click anywhere on the call page once.']);
    else rows.push(['wait', `Audio engine: ${p.audio}.`]);
    rows.push(p.theirTracks > 0 ? ['ok', `Their audio found (${p.theirTracks} stream${p.theirTracks > 1 ? 's' : ''}).`] : ['wait', 'Waiting for the other person to join.']);
  }
  if (!d.on) rows.push(['warn', 'Translation is off.']);
  const [outCls, outText] = serverLine(d.net.out);
  const [inCls, inText] = serverLine(d.net.in);
  rows.push([outCls, `Server, your side: ${outText}.`]);
  rows.push([inCls, `Server, their side: ${inText}.`]);
  rows.push(['wait', `Sent to server: your audio ${seconds(d.net.out.bytes)} s, theirs ${seconds(d.net.in.bytes)} s.`]);
  const tr = (n) => `${n.results} done${n.pending ? `, ${n.pending} in progress` : ''}${n.noSpeech ? `, ${n.noSpeech} with no words heard` : ''}`;
  rows.push([d.net.out.results || d.net.in.results ? 'ok' : 'wait', `Translations: you → them ${tr(d.net.out)}; them → you ${tr(d.net.in)}.`]);
  if (p && d.on) {
    rows.push(p.speech.out ? ['ok', 'They hear your translated voice.'] : ['warn', 'They hear your real voice (server not ready yet).']);
    if (p.theirTracks > 0) {
      const ducked = (p.duckedElements || 0) + (p.duckedWebAudio || 0);
      if (!p.speech.in) rows.push(['warn', 'You hear their real voice (server not ready yet).']);
      else rows.push(ducked ? ['ok', 'Their real voice is turned down for you.'] : ['warn', "Can't turn their real voice down on this site: you may hear both."]);
    }
  }
  if (!d.signedIn) rows.push(['warn', 'Not signed in: paste your account key below if the server needs login.']);
  return rows;
}

function renderDiag(status) {
  const list = $('diagList');
  const icons = { ok: '✓', bad: '✕', warn: '!', wait: '·' };
  list.replaceChildren(
    ...diagRows(status).map(([cls, text]) => {
      const li = document.createElement('li');
      li.className = cls;
      const ic = document.createElement('span');
      ic.className = 'ic';
      ic.textContent = icons[cls];
      li.append(ic, document.createTextNode(text));
      return li;
    }),
  );
}

async function testServer() {
  const note = $('diagNote');
  const base = (settings.serverUrl || '').replace(/\/$/, '');
  note.textContent = `Checking ${base}…`;
  try {
    const res = await fetch(base + '/health', { cache: 'no-store' });
    const h = await res.json();
    const e = h.engines || {};
    note.textContent = h.ok ? `Server OK (version ${h.version}): ${e.asr}, ${e.mt}, ${e.tts}.` : 'The server answered but is not ready.';
  } catch {
    note.textContent = `Cannot reach ${base}. Is the server running, and is this the latest address?`;
  }
}

async function copyDiag() {
  const report = { at: new Date().toISOString(), site: tab && tab.url ? hostOf(tab.url) : null, status: lastStatus };
  try {
    await navigator.clipboard.writeText(JSON.stringify(report, null, 2));
    $('diagNote').textContent = 'Copied. Paste it to whoever is helping you.';
  } catch {
    $('diagNote').textContent = 'Could not copy.';
  }
}

function hostOf(url) {
  try {
    return new URL(url).hostname;
  } catch {
    return 'This tab';
  }
}

function isWeb(url) {
  return !!url && /^https?:\/\//.test(url);
}

init();
