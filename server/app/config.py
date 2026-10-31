"""Settings, read from environment variables (and server/.env if present)."""
from __future__ import annotations

import os
from dataclasses import dataclass, field
from pathlib import Path

SERVER_DIR = Path(__file__).resolve().parent.parent


def _bool(value: str | None, default: bool = False) -> bool:
    if value is None or value == "":
        return default
    return value.strip().lower() in {"1", "true", "yes", "on"}


def _list(value: str | None, default: list[str]) -> list[str]:
    if not value:
        return default
    return [v.strip() for v in value.split(",") if v.strip()]


# Engine defaults per preset. "mock" needs no ML libraries and no GPU: use it
# to check that the web app, extension and server talk to each other.
PRESETS = {
    "mock": {"asr": "mock", "mt": "mock", "tts": "mock", "voice": "none"},
    "open-source": {"asr": "whisper", "mt": "m2m100-ct2", "tts": "kokoro", "voice": "none"},
}


@dataclass
class Settings:
    app_env: str = "development"
    secret_key: str = "change-me"
    database_url: str = ""
    data_dir: Path = field(default_factory=lambda: SERVER_DIR / "data")
    cors_origins: list[str] = field(default_factory=lambda: ["http://localhost:3000"])
    allow_anonymous_ws: bool = True
    dev_mode: bool = True
    jwt_days: int = 30

    engine_preset: str = "mock"
    asr_engine: str = "mock"
    whisper_model: str = "small"
    whisper_device: str = "auto"
    whisper_compute_type: str = "auto"
    hindi_asr: str = "whisper"  # whisper | indicconformer
    indic_asr_model: str = "OpenVoiceOS/ai4bharat-indicconformer-hi-onnx"
    indic_asr_quantization: str = "int8"
    european_asr: str = "whisper"  # whisper | parakeet (en, fr, es, it, pt, de, ru)
    parakeet_model: str = "nemo-parakeet-tdt-0.6b-v3"
    parakeet_quantization: str = "int8"
    mt_engine: str = "mock"
    m2m_model: str = "facebook/m2m100_418M"
    m2m_ct2_model: str = "jncraton/m2m100_418M-ct2-int8"  # same model, CTranslate2 int8: ~4x smaller and faster on CPU
    mt_device: str = "auto"
    ollama_url: str = "http://localhost:11434"
    ollama_model: str = "qwen2.5:7b-instruct"
    tts_engine: str = "mock"
    tts_device: str = "auto"
    voice_engine: str = "none"
    voice_service_url: str = "http://localhost:8100"

    web_dist: str = ""  # folder with the built web app to serve at "/" (optional)
    cpu_threads: int = 0  # threads per model on CPU; 0 = one per physical core
    warmup_langs: list[str] = field(default_factory=list)  # load voices and translator for these at start

    vad_end_silence_ms: int = 600
    vad_max_utterance_s: float = 12.0
    vad_threshold_db: float = -45.0

    @property
    def threads(self) -> int:
        """Threads each model may use on the CPU (physical cores, not hyper-threads)."""
        if self.cpu_threads > 0:
            return self.cpu_threads
        return max(1, (os.cpu_count() or 2) // 2)

    @property
    def is_production(self) -> bool:
        return self.app_env == "production"

    @classmethod
    def from_env(cls) -> "Settings":
        env = os.environ
        preset = env.get("ENGINE_PRESET", "mock").strip().lower()
        defaults = PRESETS.get(preset, PRESETS["mock"])
        data_dir = Path(env.get("DATA_DIR", str(SERVER_DIR / "data")))
        s = cls(
            app_env=env.get("APP_ENV", "development"),
            secret_key=env.get("SECRET_KEY", "change-me"),
            database_url=env.get("DATABASE_URL", ""),
            data_dir=data_dir,
            cors_origins=_list(env.get("CORS_ORIGINS"), ["http://localhost:3000"]),
            allow_anonymous_ws=_bool(env.get("ALLOW_ANONYMOUS_WS"), True),
            dev_mode=_bool(env.get("DEV_MODE"), True),
            jwt_days=int(env.get("JWT_DAYS", "30")),
            engine_preset=preset,
            asr_engine=env.get("ASR_ENGINE", defaults["asr"]),
            whisper_model=env.get("WHISPER_MODEL", "small"),
            whisper_device=env.get("WHISPER_DEVICE", "auto"),
            whisper_compute_type=env.get("WHISPER_COMPUTE_TYPE", "auto"),
            hindi_asr=env.get("HINDI_ASR", "whisper").strip().lower(),
            indic_asr_model=env.get("INDIC_ASR_MODEL", "OpenVoiceOS/ai4bharat-indicconformer-hi-onnx"),
            indic_asr_quantization=env.get("INDIC_ASR_QUANTIZATION", "int8"),
            european_asr=env.get("EUROPEAN_ASR", "whisper").strip().lower(),
            parakeet_model=env.get("PARAKEET_MODEL", "nemo-parakeet-tdt-0.6b-v3"),
            parakeet_quantization=env.get("PARAKEET_QUANTIZATION", "int8"),
            mt_engine=env.get("MT_ENGINE", defaults["mt"]),
            m2m_model=env.get("M2M_MODEL", "facebook/m2m100_418M"),
            m2m_ct2_model=env.get("M2M_CT2_MODEL", "jncraton/m2m100_418M-ct2-int8"),
            mt_device=env.get("MT_DEVICE", "auto"),
            ollama_url=env.get("OLLAMA_URL", "http://localhost:11434"),
            ollama_model=env.get("OLLAMA_MODEL", "qwen2.5:7b-instruct"),
            tts_engine=env.get("TTS_ENGINE", defaults["tts"]),
            tts_device=env.get("TTS_DEVICE", "auto"),
            voice_engine=env.get("VOICE_ENGINE", defaults["voice"]),
            voice_service_url=env.get("VOICE_SERVICE_URL", "http://localhost:8100"),
            web_dist=env.get("WEB_DIST", ""),
            cpu_threads=int(env.get("CPU_THREADS", "0") or 0),
            warmup_langs=_list(env.get("WARMUP_LANGS"), []),
            vad_end_silence_ms=int(env.get("VAD_END_SILENCE_MS", "600")),
            vad_max_utterance_s=float(env.get("VAD_MAX_UTTERANCE_S", "12")),
            vad_threshold_db=float(env.get("VAD_THRESHOLD_DB", "-45")),
        )
        if not s.database_url:
            s.database_url = f"sqlite:///{(data_dir / 'bolbridge.db').as_posix()}"
        if s.is_production and s.secret_key == "change-me":
            raise RuntimeError("Set SECRET_KEY before running in production.")
        return s
