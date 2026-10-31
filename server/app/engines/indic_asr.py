"""Fast speech-to-text engines that run through onnx-asr (MIT), plus per-language routing.

* Hindi: AI4Bharat IndicConformer (MIT), ONNX export by OpenVoiceOS (MIT):
  https://huggingface.co/OpenVoiceOS/ai4bharat-indicconformer-hi-onnx
  Trained on Indian speech, so it hears Hindi better than Whisper small.
* English and other European languages: NVIDIA Parakeet TDT 0.6B v3
  (CC-BY-4.0: commercial use allowed, credit NVIDIA in the app/docs).
* Runtime: onnx-asr, https://github.com/istupakov/onnx-asr

Both are much faster than Whisper on a CPU because they do not pad every clip
to 30 seconds. Languages without a faster engine keep using Whisper (RoutedASR).
"""
from __future__ import annotations

import logging

import numpy as np

from .base import ASRResult

log = logging.getLogger(__name__)

DEFAULT_HINDI_MODEL = "OpenVoiceOS/ai4bharat-indicconformer-hi-onnx"
DEFAULT_EUROPEAN_MODEL = "nemo-parakeet-tdt-0.6b-v3"
# Languages Parakeet v3 hears that BolBridge offers.
PARAKEET_LANGUAGES = ("en", "fr", "es", "it", "pt", "de", "ru")


def _session_options(threads: int):
    """onnxruntime options: a fixed thread count and no busy-waiting between calls,
    so ASR does not steal CPU from the translator and the voice on small machines."""
    try:
        import onnxruntime as rt
    except Exception:  # pragma: no cover - onnx-asr pulls it in
        return None
    opts = rt.SessionOptions()
    if threads > 0:
        opts.intra_op_num_threads = threads
    opts.inter_op_num_threads = 1
    opts.add_session_config_entry("session.intra_op.allow_spinning", "0")
    return opts


class OnnxASR:
    name = "onnx-asr"

    def __init__(self, model_id: str, quantization: str | None = "int8", threads: int = 0, label: str | None = None) -> None:
        import onnx_asr

        if label:
            self.name = label
        quantization = quantization or None
        opts = _session_options(threads)
        log.info("Loading %s (%s, %s threads)", model_id, quantization or "full precision", threads or "auto")
        try:
            self.model = onnx_asr.load_model(model_id, quantization=quantization, sess_options=opts)
        except Exception as exc:
            if quantization is None:
                raise
            log.warning("No %s build of %s (%s), loading the full-precision one", quantization, model_id, exc)
            self.model = onnx_asr.load_model(model_id, sess_options=opts)

    def transcribe(self, audio: np.ndarray, language: str | None = None) -> ASRResult:
        text = self.model.recognize(np.asarray(audio, dtype=np.float32), sample_rate=16000)
        return ASRResult(text=str(text or "").strip(), language=language, confidence=None)


class IndicConformerASR(OnnxASR):
    name = "indicconformer"

    def __init__(self, model_id: str = DEFAULT_HINDI_MODEL, quantization: str | None = "int8", language: str = "hi", threads: int = 0) -> None:
        super().__init__(model_id, quantization, threads)
        self.language = language

    def transcribe(self, audio: np.ndarray, language: str | None = None) -> ASRResult:
        result = super().transcribe(audio, language)
        result.language = self.language
        return result


class ParakeetASR(OnnxASR):
    name = "parakeet"

    def __init__(self, model_id: str = DEFAULT_EUROPEAN_MODEL, quantization: str | None = "int8", threads: int = 0) -> None:
        super().__init__(model_id, quantization, threads)


class RoutedASR:
    """Sends each language to the engine that hears it best, the rest to a default."""

    def __init__(self, default, by_language: dict[str, object]) -> None:
        self.default = default
        self.by_language = dict(by_language)
        groups: dict[str, list[str]] = {}
        for lang, engine in self.by_language.items():
            groups.setdefault(engine.name, []).append(lang)
        extra = ",".join(f"{name}:{'/'.join(langs)}" for name, langs in groups.items())
        self.name = f"{default.name}+{extra}" if extra else default.name

    def transcribe(self, audio: np.ndarray, language: str | None = None) -> ASRResult:
        engine = self.by_language.get(language or "", self.default)
        return engine.transcribe(audio, language=language)
