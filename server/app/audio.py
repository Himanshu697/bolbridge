"""Small audio helpers that only need numpy and the standard library."""
from __future__ import annotations

import io
import wave

import numpy as np


def pcm16_to_float(data: bytes) -> np.ndarray:
    if len(data) % 2:
        data = data[:-1]
    return np.frombuffer(data, dtype="<i2").astype(np.float32) / 32768.0


def float_to_pcm16(audio: np.ndarray) -> bytes:
    clipped = np.clip(np.asarray(audio, dtype=np.float32), -1.0, 1.0)
    return (clipped * 32767.0).astype("<i2").tobytes()


def resample(audio: np.ndarray, src_rate: int, dst_rate: int) -> np.ndarray:
    """Linear-interpolation resampler, good enough for speech."""
    if src_rate == dst_rate or len(audio) == 0:
        return np.asarray(audio, dtype=np.float32)
    duration = len(audio) / src_rate
    n_out = max(1, int(round(duration * dst_rate)))
    x_old = np.linspace(0.0, duration, num=len(audio), endpoint=False)
    x_new = np.linspace(0.0, duration, num=n_out, endpoint=False)
    return np.interp(x_new, x_old, audio).astype(np.float32)


def to_wav_bytes(audio: np.ndarray, sample_rate: int) -> bytes:
    buf = io.BytesIO()
    with wave.open(buf, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(sample_rate)
        w.writeframes(float_to_pcm16(audio))
    return buf.getvalue()


def from_wav_bytes(data: bytes) -> tuple[np.ndarray, int]:
    """Read a 16-bit PCM WAV (mono or stereo) into float32 mono."""
    with wave.open(io.BytesIO(data), "rb") as w:
        channels = w.getnchannels()
        rate = w.getframerate()
        width = w.getsampwidth()
        frames = w.readframes(w.getnframes())
    if width != 2:
        raise ValueError("Only 16-bit PCM WAV is supported")
    audio = pcm16_to_float(frames)
    if channels > 1:
        audio = audio.reshape(-1, channels).mean(axis=1)
    return audio.astype(np.float32), rate


def duration_s(audio: np.ndarray, sample_rate: int) -> float:
    return len(audio) / float(sample_rate) if sample_rate else 0.0
