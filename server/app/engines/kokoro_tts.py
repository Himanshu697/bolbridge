"""Text-to-speech with Kokoro-82M (Apache-2.0 code and weights).

Voices: English, Hindi, French, Spanish, Italian, Portuguese, Japanese,
Mandarin. Needs espeak-ng installed on the machine (see docs/MODELS.md).
"""
from __future__ import annotations

import logging
import threading

import numpy as np

from ..languages import get_language

log = logging.getLogger(__name__)


class KokoroTTS:
    name = "kokoro"
    sample_rate = 24000

    def __init__(self, device: str = "auto") -> None:
        from kokoro import KPipeline  # noqa: F401  (fail early if not installed)

        self.device = None if device == "auto" else device
        self._pipelines: dict[str, object] = {}
        self._lock = threading.Lock()
        self._model = None

    def supports(self, lang: str) -> bool:
        l = get_language(lang)
        return bool(l and l.has_voice)

    def voice_id(self, lang: str, gender: str = "female") -> str | None:
        l = get_language(lang)
        return l.voice(gender) if l else None

    def _pipeline(self, lang_code: str):
        from kokoro import KPipeline

        with self._lock:
            pipe = self._pipelines.get(lang_code)
            if pipe is None:
                log.info("Loading Kokoro pipeline for lang_code=%s", lang_code)
                model = self._model if self._model is not None else True
                pipe = KPipeline(lang_code=lang_code, repo_id="hexgrad/Kokoro-82M", model=model, device=self.device)
                if self._model is None:
                    self._model = pipe.model  # share one model between languages
                self._pipelines[lang_code] = pipe
            return pipe

    def synthesize(self, text: str, lang: str, gender: str = "female") -> tuple[np.ndarray, int]:
        l = get_language(lang)
        if l is None or not l.has_voice:
            raise ValueError(f"No voice for language {lang}")
        pipe = self._pipeline(l.kokoro_lang)
        chunks: list[np.ndarray] = []
        for result in pipe(text, voice=l.voice(gender), speed=1.0):
            try:
                audio = result.audio
            except AttributeError:
                _, _, audio = result
            if audio is None:
                continue
            if hasattr(audio, "detach"):
                audio = audio.detach().cpu().numpy()
            chunks.append(np.asarray(audio, dtype=np.float32))
        if not chunks:
            return np.zeros(0, dtype=np.float32), self.sample_rate
        return np.concatenate(chunks), self.sample_rate
