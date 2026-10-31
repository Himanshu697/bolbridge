"""Compare Hindi speech-to-text engines on the same audio.

    cd server && source .venv/bin/activate
    python scripts/compare_asr.py                 # Kokoro speaks a Hindi test sentence
    python scripts/compare_asr.py my_recording.wav

Prints what each engine heard and how long it took (after a warm-up run).
"""
from __future__ import annotations

import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.audio import from_wav_bytes, resample  # noqa: E402

SENTENCE = "आज मौसम बहुत अच्छा है और मैं कल दिल्ली जा रहा हूँ।"


def load_audio():
    if len(sys.argv) > 1:
        audio, rate = from_wav_bytes(Path(sys.argv[1]).read_bytes())
        print(f"Audio: {sys.argv[1]} ({len(audio) / rate:.1f} s)")
    else:
        from app.engines.kokoro_tts import KokoroTTS

        audio, rate = KokoroTTS().synthesize(SENTENCE, "hi", "male")
        print(f"Audio: Kokoro saying {SENTENCE!r} ({len(audio) / rate:.1f} s)")
    return resample(audio, rate, 16000)


def timed(engine, audio):
    engine.transcribe(audio, language="hi")  # warm-up
    t = time.perf_counter()
    text = engine.transcribe(audio, language="hi").text
    return text, int((time.perf_counter() - t) * 1000)


def main() -> None:
    audio = load_audio()
    from app.engines.whisper_asr import WhisperASR

    text, ms = timed(WhisperASR("small"), audio)
    print(f"Whisper small   {ms:>6} ms  {text}")
    try:
        from app.engines.indic_asr import IndicConformerASR

        text, ms = timed(IndicConformerASR(), audio)
        print(f"IndicConformer  {ms:>6} ms  {text}")
    except Exception as exc:
        print(f"IndicConformer  not available: {exc}")


if __name__ == "__main__":
    main()
