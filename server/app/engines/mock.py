"""Mock engines: no ML libraries, no downloads, instant.

They let you run and test the whole product (web app, extension, server)
on any laptop before installing the real open-source models.
"""
from __future__ import annotations

import itertools

import numpy as np

from .base import ASRResult

SAMPLE_PHRASES = {
    "hi": ["नमस्ते, आज तुम्हारा दिन कैसा रहा?", "मैं अगले हफ्ते दिल्ली आ रहा हूँ।", "क्या तुम मेरी आवाज़ सुन पा रहे हो?"],
    "en": ["Hello, how was your day?", "I am coming to Delhi next week.", "Can you hear me clearly?"],
    "fr": ["Bonjour, comment s'est passée ta journée ?", "Je viens à Delhi la semaine prochaine.", "Tu m'entends bien ?"],
    "es": ["Hola, ¿qué tal tu día?", "Voy a Delhi la próxima semana.", "¿Me escuchas bien?"],
    "zh": ["你好，你今天过得怎么样？", "我下周去德里。", "你能听清楚我吗？"],
}

# The same three sentences in each language, so mock "translation" looks real.
_INDEX = {text: (lang, i) for lang, texts in SAMPLE_PHRASES.items() for i, text in enumerate(texts)}


class MockASR:
    name = "mock-asr"

    def __init__(self) -> None:
        self._counter = itertools.count()

    def transcribe(self, audio: np.ndarray, language: str | None = None) -> ASRResult:
        lang = language if language in SAMPLE_PHRASES else "en"
        phrases = SAMPLE_PHRASES[lang]
        text = phrases[next(self._counter) % len(phrases)]
        return ASRResult(text=text, language=lang, confidence=1.0)


class MockTranslator:
    name = "mock-mt"

    def translate(self, text: str, src: str, tgt: str, glossary: dict[str, str] | None = None) -> str:
        if src == tgt:
            return text
        hit = _INDEX.get(text)
        if hit and tgt in SAMPLE_PHRASES:
            return SAMPLE_PHRASES[tgt][hit[1]]
        return f"[{tgt}] {text}"


class MockTTS:
    """Speaks a soft two-tone beep pattern whose length follows the text."""

    name = "mock-tts"
    sample_rate = 24000

    def supports(self, lang: str) -> bool:
        return True

    def voice_id(self, lang: str, gender: str = "female") -> str | None:
        return f"mock-{lang}-{gender}"

    def synthesize(self, text: str, lang: str, gender: str = "female") -> tuple[np.ndarray, int]:
        seconds = min(4.0, 0.25 + 0.04 * len(text))
        t = np.arange(int(seconds * self.sample_rate)) / self.sample_rate
        freq = np.where((t * 4).astype(int) % 2 == 0, 440.0, 554.0)
        envelope = np.minimum(1.0, np.minimum(t, seconds - t) * 20)
        audio = 0.15 * np.sin(2 * np.pi * freq * t) * envelope
        return audio.astype(np.float32), self.sample_rate


class NoVoiceConverter:
    name = "none"

    def available(self) -> bool:
        return False

    def has_profile(self, profile_id: str) -> bool:
        return False

    def save_profile(self, profile_id: str, wav_bytes: bytes) -> bool:
        return False

    def delete_profile(self, profile_id: str) -> None:
        return None

    def convert(self, audio, sample_rate, profile_id, source_voice):
        return audio, sample_rate
