"""Supported languages and how each engine refers to them.

A language can be used in two ways:
  * as a *source* (what someone speaks): needs ASR + MT support
  * as a *target* (what someone hears): needs MT + TTS support

Languages without a TTS voice still work for captions (subtitles), but the
other person will hear the original voice instead of a translated one.
"""
from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class Language:
    code: str  # our code, ISO 639-1
    name: str  # English name
    native: str  # name in the language itself
    whisper: str  # faster-whisper language code
    m2m: str  # M2M100 language code
    kokoro_lang: str | None  # Kokoro lang_code, None = no open-source voice yet
    voice_female: str | None
    voice_male: str | None
    announce: str  # "this call is translated" notice, spoken in this language

    @property
    def has_voice(self) -> bool:
        return self.kokoro_lang is not None

    def voice(self, gender: str = "female") -> str | None:
        if gender == "male" and self.voice_male:
            return self.voice_male
        return self.voice_female or self.voice_male


LANGUAGES: dict[str, Language] = {
    lang.code: lang
    for lang in [
        # ---- full voice support (Kokoro-82M, Apache-2.0) ----
        Language("hi", "Hindi", "हिन्दी", "hi", "hi", "h", "hf_alpha", "hm_omega",
                 "यह कॉल BolBridge द्वारा लाइव ट्रांसलेट की जा रही है।"),
        Language("en", "English", "English", "en", "en", "a", "af_heart", "am_michael",
                 "This call is being translated live by BolBridge."),
        Language("fr", "French", "Français", "fr", "fr", "f", "ff_siwis", None,
                 "Cet appel est traduit en direct par BolBridge."),
        Language("es", "Spanish", "Español", "es", "es", "e", "ef_dora", "em_alex",
                 "Esta llamada se está traduciendo en directo con BolBridge."),
        Language("it", "Italian", "Italiano", "it", "it", "i", "if_sara", "im_nicola",
                 "Questa chiamata è tradotta in tempo reale da BolBridge."),
        Language("pt", "Portuguese", "Português", "pt", "pt", "p", "pf_dora", "pm_alex",
                 "Esta chamada está sendo traduzida ao vivo pelo BolBridge."),
        Language("ja", "Japanese", "日本語", "ja", "ja", "j", "jf_alpha", "jm_kumo",
                 "この通話はBolBridgeによってリアルタイムで翻訳されています。"),
        Language("zh", "Mandarin Chinese", "中文", "zh", "zh", "z", "zf_xiaobei", "zm_yunjian",
                 "本次通话正在由BolBridge实时翻译。"),
        # ---- captions only for now (no open-source voice wired in yet) ----
        Language("ar", "Arabic", "العربية", "ar", "ar", None, None, None,
                 "تتم ترجمة هذه المكالمة مباشرة بواسطة BolBridge."),
        Language("de", "German", "Deutsch", "de", "de", None, None, None,
                 "Dieses Gespräch wird live von BolBridge übersetzt."),
        Language("ru", "Russian", "Русский", "ru", "ru", None, None, None,
                 "Этот звонок переводится в реальном времени с помощью BolBridge."),
        Language("ko", "Korean", "한국어", "ko", "ko", None, None, None,
                 "이 통화는 BolBridge가 실시간으로 번역하고 있습니다."),
        Language("ta", "Tamil", "தமிழ்", "ta", "ta", None, None, None,
                 "இந்த அழைப்பு BolBridge மூலம் நேரடியாக மொழிபெயர்க்கப்படுகிறது."),
        Language("bn", "Bengali", "বাংলা", "bn", "bn", None, None, None,
                 "এই কলটি BolBridge সরাসরি অনুবাদ করছে।"),
        Language("mr", "Marathi", "मराठी", "mr", "mr", None, None, None,
                 "हा कॉल BolBridge द्वारे थेट भाषांतरित केला जात आहे."),
        Language("ur", "Urdu", "اردو", "ur", "ur", None, None, None,
                 "یہ کال BolBridge کے ذریعے براہ راست ترجمہ کی جا رہی ہے۔"),
    ]
}


def get_language(code: str | None) -> Language | None:
    if not code:
        return None
    return LANGUAGES.get(code.lower().strip())


def public_list() -> list[dict]:
    return [
        {"code": l.code, "name": l.name, "native": l.native, "voice": l.has_voice}
        for l in LANGUAGES.values()
    ]
