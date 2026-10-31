"""Cuts a live microphone stream into utterances (one sentence at a time).

Simple energy-based voice activity detection with an adaptive noise floor.
An utterance ends after `end_silence_ms` of quiet, or when it reaches
`max_utterance_s` (so long talkers still get translated in chunks).
"""
from __future__ import annotations

from collections import deque

import numpy as np


class UtteranceSegmenter:
    def __init__(
        self,
        sample_rate: int = 16000,
        frame_ms: int = 20,
        start_frames: int = 3,
        end_silence_ms: int = 600,
        pre_roll_ms: int = 300,
        max_utterance_s: float = 12.0,
        min_utterance_ms: int = 200,  # of actual voice, so clicks and coughs are skipped
        threshold_db: float = -45.0,
        noise_margin_db: float = 10.0,
    ) -> None:
        self.sample_rate = sample_rate
        self.frame_len = int(sample_rate * frame_ms / 1000)
        self.frame_ms = frame_ms
        self.start_frames = start_frames
        self.end_frames = max(1, end_silence_ms // frame_ms)
        self.max_frames = int(max_utterance_s * 1000 / frame_ms)
        self.min_frames = max(1, min_utterance_ms // frame_ms)
        self.threshold_db = threshold_db
        self.noise_margin_db = noise_margin_db

        self._pending = np.zeros(0, dtype=np.float32)
        self._pre_roll: deque[np.ndarray] = deque(maxlen=max(1, pre_roll_ms // frame_ms))
        self._current: list[np.ndarray] = []
        self._in_speech = False
        self._speech_run = 0
        self._silence_run = 0
        self._voiced = 0
        self.noise_db = -60.0

    @property
    def in_speech(self) -> bool:
        return self._in_speech

    def _frame_db(self, frame: np.ndarray) -> float:
        rms = float(np.sqrt(np.mean(frame * frame))) if len(frame) else 0.0
        return 20.0 * np.log10(rms + 1e-10)

    def push(self, samples: np.ndarray) -> list[np.ndarray]:
        """Feed float32 mono samples; returns finished utterances (may be empty)."""
        out: list[np.ndarray] = []
        data = np.concatenate([self._pending, np.asarray(samples, dtype=np.float32)])
        n_frames = len(data) // self.frame_len
        for i in range(n_frames):
            frame = data[i * self.frame_len : (i + 1) * self.frame_len]
            utt = self._process_frame(frame)
            if utt is not None:
                out.append(utt)
        self._pending = data[n_frames * self.frame_len :]
        return out

    def flush(self) -> list[np.ndarray]:
        out: list[np.ndarray] = []
        if self._in_speech and self._current:
            utt = self._finish(trim_silence=False)
            if utt is not None:
                out.append(utt)
        self._pending = np.zeros(0, dtype=np.float32)
        return out

    def _process_frame(self, frame: np.ndarray) -> np.ndarray | None:
        db = self._frame_db(frame)
        threshold = max(self.threshold_db, self.noise_db + self.noise_margin_db)
        is_speech = db > threshold

        if not self._in_speech:
            if not is_speech:
                # learn the background noise level while nobody is talking
                self.noise_db = 0.98 * self.noise_db + 0.02 * max(db, -90.0)
            self._pre_roll.append(frame)
            self._speech_run = self._speech_run + 1 if is_speech else 0
            if self._speech_run >= self.start_frames:
                self._in_speech = True
                self._current = list(self._pre_roll)
                self._pre_roll.clear()
                self._silence_run = 0
                self._voiced = self._speech_run
            return None

        self._current.append(frame)
        if is_speech:
            self._voiced += 1
        self._silence_run = 0 if is_speech else self._silence_run + 1
        if self._silence_run >= self.end_frames:
            return self._finish(trim_silence=True)
        if len(self._current) >= self.max_frames:
            return self._finish(trim_silence=False)
        return None

    def _finish(self, trim_silence: bool) -> np.ndarray | None:
        frames = self._current
        if trim_silence and self._silence_run:
            keep_tail = max(1, 150 // self.frame_ms)  # keep 150 ms of the pause
            cut = max(0, self._silence_run - keep_tail)
            frames = frames[: len(frames) - cut] if cut else frames
        voiced = self._voiced
        self._current = []
        self._in_speech = False
        self._speech_run = 0
        self._silence_run = 0
        self._voiced = 0
        if voiced < self.min_frames:
            return None
        return np.concatenate(frames)
