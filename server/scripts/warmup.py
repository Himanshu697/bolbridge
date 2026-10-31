"""Download the models and run sentences through them, so the first real call is fast.

    cd server && source .venv/bin/activate && python scripts/warmup.py

Uses the same settings as the server (server/.env or the environment).
Prints how long each step takes; the second run of each pair is the real speed.
"""
from __future__ import annotations

import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from dotenv import load_dotenv  # noqa: E402

from app.audio import resample  # noqa: E402
from app.config import SERVER_DIR, Settings  # noqa: E402
from app.engines import build_engines  # noqa: E402
from app.pipeline import TranslationPipeline, VoiceOptions  # noqa: E402

VOICES = [
    ("hi", "female", "नमस्ते, आप कैसे हैं?"),
    ("hi", "male", "नमस्ते, आप कैसे हैं?"),
    ("en", "female", "Hello, how are you?"),
    ("en", "male", "Hello, how are you?"),
    ("fr", "female", "Bonjour, comment allez-vous ?"),
]
ROUND_TRIPS = [
    ("hi", "en", "आज मौसम बहुत अच्छा है और मैं कल दिल्ली जा रहा हूँ।"),
    ("en", "hi", "I am coming to Delhi tomorrow, can we meet in the evening?"),
]


def ms(start: float) -> int:
    return int((time.perf_counter() - start) * 1000)


def main() -> None:
    load_dotenv(SERVER_DIR / ".env")
    settings = Settings.from_env()
    t = time.perf_counter()
    engines = build_engines(settings)
    print(f"Engines {engines.describe()} loaded in {ms(t)} ms", flush=True)
    pipeline = TranslationPipeline(engines)

    for lang, gender, text in VOICES:
        if not pipeline.can_speak(lang):
            continue
        t = time.perf_counter()
        audio, rate = engines.tts.synthesize(text, lang, gender)
        print(f"Voice {lang}/{gender}: {len(audio) / rate:.1f} s of audio in {ms(t)} ms", flush=True)

    for src, tgt, text in ROUND_TRIPS:
        audio, rate = engines.tts.synthesize(text, src, "male")
        speech = resample(audio, rate, 16000)
        for attempt in ("first", "second"):
            t = time.perf_counter()
            result = pipeline.process(speech, src, tgt, VoiceOptions())
            total = ms(t)
            if result is None:
                print(f"{src}->{tgt} ({attempt}): nothing recognised in {total} ms", flush=True)
                continue
            print(f"{src}->{tgt} ({attempt}): {total} ms {result.timings_ms}", flush=True)
        if result is not None:
            print(f"   said:  {text}\n   heard: {result.source_text}\n   sent:  {result.translated_text}", flush=True)
    print("WARMUP DONE", flush=True)


if __name__ == "__main__":
    main()
