"""Talks to the optional voice-clone service (OpenVoice V2, MIT licence).

OpenVoice pins old library versions, so it runs as its own small service in
its own Python environment (see voice-clone-service/). This class is the
client the main server uses.
"""
from __future__ import annotations

import logging
import time

import httpx
import numpy as np

from ..audio import from_wav_bytes, to_wav_bytes

log = logging.getLogger(__name__)


class RemoteVoiceConverter:
    name = "openvoice-service"

    def __init__(self, url: str, timeout: float = 30.0) -> None:
        self.url = url.rstrip("/")
        self.client = httpx.Client(timeout=timeout)
        self._ok: bool | None = None
        self._checked_at = 0.0

    def available(self) -> bool:
        now = time.monotonic()
        if self._ok is None or now - self._checked_at > 30:
            try:
                self._ok = self.client.get(f"{self.url}/health", timeout=2.0).status_code == 200
            except httpx.HTTPError:
                self._ok = False
            self._checked_at = now
        return bool(self._ok)

    def has_profile(self, profile_id: str) -> bool:
        try:
            return self.client.get(f"{self.url}/profiles/{profile_id}").status_code == 200
        except httpx.HTTPError:
            return False

    def save_profile(self, profile_id: str, wav_bytes: bytes) -> bool:
        try:
            r = self.client.post(
                f"{self.url}/profiles/{profile_id}",
                files={"file": ("voice.wav", wav_bytes, "audio/wav")},
                timeout=120.0,
            )
            return r.status_code == 200
        except httpx.HTTPError as exc:
            log.warning("Voice profile upload failed: %s", exc)
            return False

    def delete_profile(self, profile_id: str) -> None:
        try:
            self.client.delete(f"{self.url}/profiles/{profile_id}")
        except httpx.HTTPError:
            pass

    def convert(
        self, audio: np.ndarray, sample_rate: int, profile_id: str, source_voice: str
    ) -> tuple[np.ndarray, int]:
        r = self.client.post(
            f"{self.url}/convert",
            data={"profile_id": profile_id, "source_voice": source_voice},
            files={"file": ("tts.wav", to_wav_bytes(audio, sample_rate), "audio/wav")},
        )
        r.raise_for_status()
        return from_wav_bytes(r.content)
