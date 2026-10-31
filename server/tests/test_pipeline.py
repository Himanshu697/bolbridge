import numpy as np

from app.audio import float_to_pcm16, from_wav_bytes, pcm16_to_float, resample, to_wav_bytes
from app.engines.base import ASRResult
from app.engines.translators import apply_glossary
from app.languages import LANGUAGES, get_language
from app.pipeline import TranslationPipeline, VoiceOptions
from conftest import mock_engines, tone


def test_hindi_to_french_with_speech():
    p = TranslationPipeline(mock_engines())
    r = p.process(tone(1.0), "hi", "fr")
    assert r is not None
    assert r.source_text.startswith("नमस्ते")
    assert r.translated_text.startswith("Bonjour")
    assert r.audio is not None and len(r.audio) > 0
    assert r.sample_rate == 24000
    assert set(r.timings_ms) >= {"asr", "mt", "tts"}


def test_captions_only_when_speech_off():
    p = TranslationPipeline(mock_engines())
    r = p.process(tone(1.0), "fr", "hi", VoiceOptions(speak=False))
    assert r is not None and r.audio is None


def test_empty_transcript_returns_nothing():
    engines = mock_engines()

    class SilentASR:
        name = "silent"

        def transcribe(self, audio, language=None):
            return ASRResult(text="  ")

    engines.asr = SilentASR()
    assert TranslationPipeline(engines).process(tone(1.0), "hi", "fr") is None


def test_voice_clone_is_used_when_available():
    engines = mock_engines()
    calls = []

    class FakeVoice:
        name = "fake"

        def available(self):
            return True

        def convert(self, audio, rate, profile, source_voice):
            calls.append((profile, source_voice))
            return audio * 0.5, rate

    engines.voice = FakeVoice()
    r = TranslationPipeline(engines).process(tone(1.0), "hi", "fr", VoiceOptions(clone_profile="user-1"))
    assert r.voice_cloned is True
    assert calls and calls[0][0] == "user-1"


def test_voice_clone_failure_falls_back_to_stock_voice():
    engines = mock_engines()

    class BrokenVoice:
        name = "broken"

        def available(self):
            return True

        def convert(self, *args):
            raise RuntimeError("service down")

    engines.voice = BrokenVoice()
    r = TranslationPipeline(engines).process(tone(1.0), "hi", "fr", VoiceOptions(clone_profile="user-1"))
    assert r.voice_cloned is False and r.audio is not None


def test_announcement():
    p = TranslationPipeline(mock_engines())
    r = p.speak_text(get_language("fr").announce, "fr")
    assert r is not None and r.audio is not None


def test_audio_helpers_round_trip():
    a = tone(0.5)
    back = pcm16_to_float(float_to_pcm16(a))
    assert np.max(np.abs(back - a)) < 1e-3
    wav = to_wav_bytes(a, 16000)
    b, rate = from_wav_bytes(wav)
    assert rate == 16000 and len(b) == len(a)
    assert len(resample(a, 16000, 24000)) == int(0.5 * 24000)


def test_language_table_is_consistent():
    for code, lang in LANGUAGES.items():
        assert lang.code == code
        assert lang.announce
        if lang.has_voice:
            assert lang.voice("female") or lang.voice("male")
    assert get_language("HI").code == "hi"
    assert get_language("xx") is None


def test_glossary():
    assert apply_glossary("price per piece", {"piece": "pièce"}) == "price per pièce"


def test_routed_asr_sends_hindi_to_its_own_engine():
    from app.engines.base import ASRResult
    from app.engines.indic_asr import RoutedASR
    from app.engines.mock import MockASR

    class Hindi:
        name = "hindi-asr"

        def transcribe(self, audio, language=None):
            return ASRResult(text="हिंदी", language="hi")

    routed = RoutedASR(MockASR(), {"hi": Hindi()})
    audio = np.zeros(16000, dtype=np.float32)
    assert routed.name == "mock-asr+hindi-asr:hi"
    assert routed.transcribe(audio, language="hi").text == "हिंदी"
    assert routed.transcribe(audio, language="en").text.startswith("Hello")


def test_missing_indic_engine_falls_back_to_whisper(tmp_path):
    from app.engines import with_indic_asr
    from app.engines.mock import MockASR
    from conftest import make_settings

    asr = MockASR()
    settings = make_settings(tmp_path, hindi_asr="indicconformer", indic_asr_model="no/such-model")
    assert with_indic_asr(asr, settings) is asr  # onnx-asr missing or model not found: keep going


def test_warm_up_loads_voices_and_translator():
    p = TranslationPipeline(mock_engines())
    took = p.warm_up(["hi", "en", "xx"])
    assert set(took) == {"hi", "en"}  # unknown codes are skipped


def test_european_engine_that_fails_to_load_is_skipped(tmp_path):
    from app.engines import with_language_asr
    from app.engines.mock import MockASR
    from conftest import make_settings

    asr = MockASR()
    settings = make_settings(tmp_path, european_asr="parakeet", parakeet_model="no/such-model")
    assert with_language_asr(asr, settings) is asr


def test_routed_asr_name_groups_languages():
    from app.engines.base import ASRResult
    from app.engines.indic_asr import RoutedASR
    from app.engines.mock import MockASR

    class Fast:
        name = "fast"

        def transcribe(self, audio, language=None):
            return ASRResult(text=language or "", language=language)

    fast = Fast()
    routed = RoutedASR(MockASR(), {"en": fast, "fr": fast})
    assert routed.name == "mock-asr+fast:en/fr"
    assert routed.transcribe(np.zeros(160, dtype=np.float32), language="fr").text == "fr"
