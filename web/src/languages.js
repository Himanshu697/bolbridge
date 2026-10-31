// Keep in sync with server/app/languages.py
export const LANGUAGES = [
  { code: 'hi', name: 'Hindi / Hinglish', voice: true },
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

export const langName = (code) => (LANGUAGES.find((l) => l.code === code) || { name: code }).name;
