import { DEFAULTS, LANGUAGES, hasVoice, langName, siteFor } from '../shared/languages.js';

const $ = (id) => document.getElementById(id);
let settings = { ...DEFAULTS };
let tab = null;

async function init() {
  settings = { ...DEFAULTS, ...(await chrome.storage.local.get(DEFAULTS)) };
  [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

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
