"""One utterance in, translated text and speech out.

    audio (16 kHz) -> ASR -> text -> MT -> translated text -> TTS -> [voice clone] -> audio
"""
from __future__ import annotations

import logging
import threading
import time
from dataclasses import dataclass, field

import numpy as np

from .engines import Engines
from .languages import get_language

log = logging.getLogger(__name__)


@dataclass
class UtteranceResult:
    source_text: str
    translated_text: str
    src: str
    tgt: str
    audio: np.ndarray | None = None
    sample_rate: int = 24000
    voice_cloned: bool = False
    timings_ms: dict[str, int] = field(default_factory=dict)


@dataclass
class VoiceOptions:
    speak: bool = True  # produce translated speech at all
    gender: str = "female"
    clone_profile: str | None = None  # voice-clone profile id, if the user opted in


class TranslationPipeline:
    def __init__(self, engines: Engines) -> None:
        self.engines = engines
        # Models are shared between calls. Locks keep each model single-file;
        # scale out with more worker processes (see docs/ARCHITECTURE.md).
        self._asr_lock = threading.Lock()
        self._mt_lock = threading.Lock()
        self._tts_lock = threading.Lock()

    def can_speak(self, lang: str) -> bool:
        l = get_language(lang)
        return bool(l) and self.engines.tts.supports(lang)

    def process(
        self,
        audio: np.ndarray,
        src: str,
        tgt: str,
        voice: VoiceOptions | None = None,
        glossary: dict[str, str] | None = None,
    ) -> UtteranceResult | None:
        voice = voice or VoiceOptions()
        timings: dict[str, int] = {}
        src_lang = get_language(src)

        t0 = time.perf_counter()
        with self._asr_lock:
            asr = self.engines.asr.transcribe(audio, language=src_lang.whisper if src_lang else None)
        timings["asr"] = int((time.perf_counter() - t0) * 1000)
        text = (asr.text or "").strip()
        if not text:
            return None

        t1 = time.perf_counter()
        with self._mt_lock:
            translated = self.engines.mt.translate(text, src, tgt, glossary)
        timings["mt"] = int((time.perf_counter() - t1) * 1000)

        result = UtteranceResult(source_text=text, translated_text=translated, src=src, tgt=tgt, timings_ms=timings)
        if voice.speak and translated.strip() and self.can_speak(tgt):
            self._speak(result, translated, tgt, voice)
        return result

    def warm_up(self, langs: list[str]) -> dict[str, int]:
        """Load each language's voice and the translator now, so the first call is not slow.
        Returns milliseconds per language."""
        codes = [code for code in langs if get_language(code)]
        timings: dict[str, int] = {}
        for code in codes:
            lang = get_language(code)
            t = time.perf_counter()
            if self.can_speak(code):
                with self._tts_lock:
                    self.engines.tts.synthesize(lang.announce, code, "female")
            for other in codes:
                if other != code:
                    with self._mt_lock:
                        self.engines.mt.translate(lang.announce, code, other)
            timings[code] = int((time.perf_counter() - t) * 1000)
        return timings

    def speak_text(self, text: str, lang: str, voice: VoiceOptions | None = None) -> UtteranceResult | None:
        """Speak a fixed sentence (used for the 'this call is translated' notice)."""
        if not self.can_speak(lang):
            return None
        result = UtteranceResult(source_text=text, translated_text=text, src=lang, tgt=lang)
        self._speak(result, text, lang, voice or VoiceOptions())
        return result

    def _speak(self, result: UtteranceResult, text: str, lang: str, voice: VoiceOptions) -> None:
        t2 = time.perf_counter()
        with self._tts_lock:
            audio, rate = self.engines.tts.synthesize(text, lang, voice.gender)
        result.timings_ms["tts"] = int((time.perf_counter() - t2) * 1000)

        if voice.clone_profile and self.engines.voice.available():
            t3 = time.perf_counter()
            try:
                source_voice = self.engines.tts.voice_id(lang, voice.gender) or lang
                audio, rate = self.engines.voice.convert(audio, rate, voice.clone_profile, source_voice)
                result.voice_cloned = True
            except Exception as exc:  # keep the call going with the stock voice
                log.warning("Voice clone failed, using stock voice: %s", exc)
            result.timings_ms["voice"] = int((time.perf_counter() - t3) * 1000)

        result.audio = audio
        result.sample_rate = rate
