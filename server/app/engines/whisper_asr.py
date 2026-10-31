"""Speech-to-text with faster-whisper (MIT licence; Whisper weights MIT)."""
from __future__ import annotations

import logging

import numpy as np

from .base import ASRResult

log = logging.getLogger(__name__)

# Phrases Whisper tends to invent on silence or noise.
HALLUCINATIONS = {
    "thank you for watching",
    "thanks for watching",
    "thank you for watching!",
    "please subscribe",
    "subscribe to my channel",
    "you",
    "bye",
    "bye.",
    "thank you.",
}


def _pick_device(device: str) -> str:
    if device != "auto":
        return device
    try:
        import ctranslate2

        return "cuda" if ctranslate2.get_cuda_device_count() > 0 else "cpu"
    except Exception:  # pragma: no cover - depends on the machine
        return "cpu"


class WhisperASR:
    name = "faster-whisper"

    def __init__(self, model_size: str = "small", device: str = "auto", compute_type: str = "auto", threads: int = 0) -> None:
        from faster_whisper import WhisperModel

        device = _pick_device(device)
        if compute_type == "auto":
            compute_type = "float16" if device == "cuda" else "int8"
        log.info("Loading Whisper %s on %s (%s, %s threads)", model_size, device, compute_type, threads or "auto")
        self.model = WhisperModel(model_size, device=device, compute_type=compute_type, cpu_threads=threads)

    def transcribe(self, audio: np.ndarray, language: str | None = None) -> ASRResult:
        segments, info = self.model.transcribe(
            np.asarray(audio, dtype=np.float32),
            language=language,
            beam_size=1,
            vad_filter=False,  # our segmenter already cut the speech out
            condition_on_previous_text=False,
            without_timestamps=True,
        )
        parts = [
            s.text.strip()
            for s in segments
            if (s.no_speech_prob or 0) < 0.6 and (s.avg_logprob or 0) > -1.0
        ]
        text = " ".join(p for p in parts if p).strip()
        if text.lower().strip(" .!") in {h.strip(" .!") for h in HALLUCINATIONS}:
            text = ""
        return ASRResult(text=text, language=info.language, confidence=info.language_probability)
