"""Builds the engines chosen in settings. Heavy libraries load only if used."""
from __future__ import annotations

import logging
from dataclasses import dataclass

from ..config import Settings
from .base import ASREngine, Translator, TTSEngine, VoiceConverter
from .mock import MockASR, MockTranslator, MockTTS, NoVoiceConverter

log = logging.getLogger(__name__)


@dataclass
class Engines:
    asr: ASREngine
    mt: Translator
    tts: TTSEngine
    voice: VoiceConverter

    def describe(self) -> dict:
        return {"asr": self.asr.name, "mt": self.mt.name, "tts": self.tts.name, "voice": self.voice.name}


def with_language_asr(asr: ASREngine, settings: Settings) -> ASREngine:
    """Route languages to faster, more accurate engines when switched on:
    HINDI_ASR=indicconformer (Hindi) and EUROPEAN_ASR=parakeet (English, French, ...).
    Whatever fails to load is skipped, so the server still starts with Whisper.
    """
    routes: dict[str, ASREngine] = {}
    if settings.hindi_asr == "indicconformer":
        try:
            from .indic_asr import IndicConformerASR

            routes["hi"] = IndicConformerASR(settings.indic_asr_model, settings.indic_asr_quantization, "hi", settings.threads)
        except Exception as exc:
            log.warning("HINDI_ASR=indicconformer could not load (%s). Using %s for Hindi. Install: pip install 'onnx-asr[cpu,hub]'", exc, asr.name)
    if settings.european_asr == "parakeet":
        try:
            from .indic_asr import PARAKEET_LANGUAGES, ParakeetASR

            parakeet = ParakeetASR(settings.parakeet_model, settings.parakeet_quantization, settings.threads)
            routes.update({lang: parakeet for lang in PARAKEET_LANGUAGES})
        except Exception as exc:
            log.warning("EUROPEAN_ASR=parakeet could not load (%s). Using %s for those languages.", exc, asr.name)
    if not routes:
        return asr
    from .indic_asr import RoutedASR

    return RoutedASR(asr, routes)


with_indic_asr = with_language_asr  # older name


def _limit_torch_threads(threads: int) -> None:
    try:
        import torch

        torch.set_num_threads(threads)
    except Exception:  # torch not installed (mock engines)
        pass


def _build_translator(settings: Settings) -> Translator:
    if settings.mt_engine == "m2m100-ct2":
        try:
            from .translators import M2M100CT2Translator

            return M2M100CT2Translator(settings.m2m_ct2_model, settings.m2m_model, settings.mt_device, settings.threads)
        except Exception as exc:
            log.warning("CTranslate2 translator could not load (%s). Falling back to the slower transformers M2M100.", exc)
    if settings.mt_engine in ("m2m100", "m2m100-ct2"):
        from .translators import M2M100Translator

        return M2M100Translator(settings.m2m_model, settings.mt_device)
    if settings.mt_engine == "ollama":
        from .translators import OllamaTranslator

        return OllamaTranslator(settings.ollama_url, settings.ollama_model)
    return MockTranslator()


def build_engines(settings: Settings) -> Engines:
    if settings.asr_engine == "whisper":
        from .whisper_asr import WhisperASR

        asr = WhisperASR(settings.whisper_model, settings.whisper_device, settings.whisper_compute_type, settings.threads)
    else:
        asr = MockASR()
    asr = with_language_asr(asr, settings)

    mt = _build_translator(settings)

    if settings.tts_engine == "kokoro":
        from .kokoro_tts import KokoroTTS

        tts = KokoroTTS(settings.tts_device)
    else:
        tts = MockTTS()

    if settings.voice_engine == "openvoice-service":
        from .voice_remote import RemoteVoiceConverter

        voice = RemoteVoiceConverter(settings.voice_service_url)
    else:
        voice = NoVoiceConverter()

    if settings.asr_engine != "mock" or settings.mt_engine != "mock" or settings.tts_engine != "mock":
        _limit_torch_threads(settings.threads)
    engines = Engines(asr=asr, mt=mt, tts=tts, voice=voice)
    log.info("Engines ready: %s", engines.describe())
    return engines
