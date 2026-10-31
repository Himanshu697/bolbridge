"""Interfaces every engine implements. Swap engines without touching the rest."""
from __future__ import annotations

from dataclasses import dataclass
from typing import Protocol

import numpy as np


@dataclass
class ASRResult:
    text: str
    language: str | None = None
    confidence: float | None = None


class ASREngine(Protocol):
    name: str

    def transcribe(self, audio: np.ndarray, language: str | None = None) -> ASRResult:
        """audio: float32 mono at 16 kHz. language: ISO code or None to auto-detect."""
        ...


class Translator(Protocol):
    name: str

    def translate(self, text: str, src: str, tgt: str, glossary: dict[str, str] | None = None) -> str:
        ...


class TTSEngine(Protocol):
    name: str

    def supports(self, lang: str) -> bool:
        ...

    def synthesize(self, text: str, lang: str, gender: str = "female") -> tuple[np.ndarray, int]:
        """Return float32 mono audio and its sample rate."""
        ...

    def voice_id(self, lang: str, gender: str = "female") -> str | None:
        ...


class VoiceConverter(Protocol):
    name: str

    def available(self) -> bool:
        ...

    def has_profile(self, profile_id: str) -> bool:
        ...

    def save_profile(self, profile_id: str, wav_bytes: bytes) -> bool:
        ...

    def delete_profile(self, profile_id: str) -> None:
        ...

    def convert(
        self, audio: np.ndarray, sample_rate: int, profile_id: str, source_voice: str
    ) -> tuple[np.ndarray, int]:
        ...
