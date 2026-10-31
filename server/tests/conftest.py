import os
import sys
import tempfile
from pathlib import Path

import numpy as np
import pytest

_tmp = tempfile.mkdtemp(prefix="bolbridge-test-")
os.environ.setdefault("DATA_DIR", _tmp)
os.environ.setdefault("ENGINE_PRESET", "mock")
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from fastapi.testclient import TestClient  # noqa: E402

from app.config import Settings  # noqa: E402
from app.engines import Engines  # noqa: E402
from app.engines.mock import MockASR, MockTranslator, MockTTS, NoVoiceConverter  # noqa: E402
from app.main import create_app  # noqa: E402


def make_settings(tmp_path: Path, **overrides) -> Settings:
    s = Settings(
        secret_key="test-secret-key-that-is-long-enough-1234",
        data_dir=tmp_path,
        database_url=f"sqlite:///{(tmp_path / 'test.db').as_posix()}",
        allow_anonymous_ws=True,
        dev_mode=True,
        vad_end_silence_ms=300,
    )
    for key, value in overrides.items():
        setattr(s, key, value)
    return s


def mock_engines() -> Engines:
    return Engines(asr=MockASR(), mt=MockTranslator(), tts=MockTTS(), voice=NoVoiceConverter())


@pytest.fixture
def client(tmp_path):
    app = create_app(make_settings(tmp_path), engines=mock_engines())
    with TestClient(app) as c:
        yield c


@pytest.fixture
def strict_client(tmp_path):
    app = create_app(make_settings(tmp_path, allow_anonymous_ws=False, dev_mode=False), engines=mock_engines())
    with TestClient(app) as c:
        yield c


def tone(seconds: float, rate: int = 16000, amp: float = 0.3, freq: float = 220.0) -> np.ndarray:
    t = np.arange(int(seconds * rate)) / rate
    return (amp * np.sin(2 * np.pi * freq * t)).astype(np.float32)


def silence(seconds: float, rate: int = 16000) -> np.ndarray:
    return np.zeros(int(seconds * rate), dtype=np.float32)


def signup(client, email="himanshu@example.com", password="secret123", name="Himanshu", **extra):
    body = {"name": name, "email": email, "password": password, "speaks": "hi"}
    body.update(extra)
    r = client.post("/api/auth/signup", json=body)
    assert r.status_code == 201, r.text
    return r.json()["token"]
