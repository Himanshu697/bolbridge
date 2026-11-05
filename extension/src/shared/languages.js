// Keep in sync with server/app/languages.py
export const LANGUAGES = [
  { code: 'hi', name: 'Hindi', voice: true },
  { code: 'en', name: 'English', voice: true },
  { code: 'fr', name: 'French', voice: true },
  { code: 'es', name: 'Spanish', voice: true },
  { code: 'it', name: 'Italian', voice: true },
  { code: 'pt', name: 'Portuguese', voice: true },
  { code: 'ja', name: 'Japanese', voice: true },
  { code: 'zh', name: 'Mandarin Chinese', voice: true },
  { code: 'ar', name: 'Arabic', voice: false },
  { code: 'de', name: 'German', voice: false },
  { code: 'ru', name: 'Russian', voice: false },
  { code: 'ko', name: 'Korean', voice: false },
  { code: 'ta', name: 'Tamil', voice: false },
  { code: 'bn', name: 'Bengali', voice: false },
  { code: 'mr', name: 'Marathi', voice: false },
  { code: 'ur', name: 'Urdu', voice: false },
];

export function langName(code) {
  const l = LANGUAGES.find((x) => x.code === code);
  return l ? l.name : code;
}

export function hasVoice(code) {
  const l = LANGUAGES.find((x) => x.code === code);
  return !!(l && l.voice);
}

export const SITES = [
  { host: 'web.whatsapp.com', name: 'WhatsApp Web', id: 'whatsapp-web' },
  { host: 'ome.tv', name: 'OmeTV', id: 'ometv' },
  { host: 'meet.google.com', name: 'Google Meet', id: 'google-meet' },
  { host: 'app.zoom.us', name: 'Zoom on the web', id: 'zoom-web' },
];

export function siteFor(url) {
  try {
    const host = new URL(url).hostname;
    return SITES.find((s) => host === s.host || host.endsWith('.' + s.host)) || null;
  } catch {
    return null;
  }
}

export const DEFAULTS = {
  on: true,
  myLang: 'hi',
  theirLang: 'en',
  useMyVoice: false, // needs a voice sample and the voice service
  hearOriginal: false,
  announce: false,
  serverUrl: 'http://localhost:8000',
  webUrl: 'http://localhost:3000',
  token: null,
  userName: null,
  minutesLeft: null,
};
