import json
import time

import numpy as np

from app.audio import float_to_pcm16
from conftest import signup, silence, tone


def speak(ws, *parts, chunk=3200):
    audio = float_to_pcm16(np.concatenate(parts))
    for i in range(0, len(audio), chunk):
        ws.send_bytes(audio[i : i + chunk])


def read_until(ws, kind, limit=20):
    """Read JSON messages (skipping binary audio frames) until one of `kind` arrives."""
    seen = []
    for _ in range(limit):
        raw = ws.receive()
        if raw.get("text") is None:
            continue  # binary audio
        msg = json.loads(raw["text"])
        seen.append(msg)
        if msg["type"] == kind:
            return msg, seen
    raise AssertionError(f"never got {kind}: {seen}")


def test_anonymous_stream_hi_to_fr(client):
    with client.websocket_connect("/ws/translate?src=hi&tgt=fr&direction=out") as ws:
        ready = ws.receive_json()
        assert ready["type"] == "ready" and ready["speech"] is True and ready["minutes_left"] is None
        speak(ws, silence(0.3), tone(1.0), silence(0.6))
        result, _ = read_until(ws, "result")
        assert result["source_text"].startswith("नमस्ते")
        assert result["translated_text"].startswith("Bonjour")
        assert result["has_audio"] is True
        header = ws.receive_json()
        assert header["type"] == "audio" and header["sample_rate"] == 24000
        pcm = ws.receive_bytes()
        assert len(pcm) == header["bytes"] > 0


def test_flush_and_ping(client):
    with client.websocket_connect("/ws/translate?src=en&tgt=hi&speak=0") as ws:
        assert ws.receive_json()["speech"] is False
        ws.send_text('{"type":"ping"}')
        read_until(ws, "pong")
        speak(ws, tone(1.0))
        ws.send_text('{"type":"flush"}')
        result, _ = read_until(ws, "result")
        assert result["has_audio"] is False


def test_config_change_mid_call(client):
    with client.websocket_connect("/ws/translate?src=hi&tgt=fr") as ws:
        ws.receive_json()
        ws.send_text('{"type":"config","src":"hi","tgt":"es"}')
        cfg, _ = read_until(ws, "config")
        assert cfg["tgt"] == "es"
        speak(ws, tone(1.0), silence(0.6))
        result, _ = read_until(ws, "result")
        assert result["tgt"] == "es" and result["translated_text"].startswith("Hola")


def test_announcement_comes_first(client):
    with client.websocket_connect("/ws/translate?src=hi&tgt=fr&announce=1") as ws:
        ws.receive_json()
        msg = ws.receive_json()
        assert msg["type"] == "announcement" and "BolBridge" in msg["translated_text"]


def test_bad_language(client):
    with client.websocket_connect("/ws/translate?src=hi&tgt=xx") as ws:
        assert ws.receive_json()["code"] == "bad_language"


def test_login_required_when_anonymous_disabled(strict_client):
    with strict_client.websocket_connect("/ws/translate?src=hi&tgt=fr") as ws:
        assert ws.receive_json()["code"] == "auth"


def test_logged_in_stream_counts_minutes_and_saves_call(client):
    token = signup(client)
    with client.websocket_connect(f"/ws/translate?src=hi&tgt=fr&token={token}&platform=whatsapp-web&peer=Camille") as ws:
        ready = ws.receive_json()
        assert ready["minutes_left"] == 15
        speak(ws, tone(2.0), silence(0.6))
        usage, _ = read_until(ws, "usage")
        assert usage["minutes_left"] < 15
    # The server finishes the call record right after the socket closes.
    for _ in range(40):
        calls = client.get("/api/calls", headers={"Authorization": f"Bearer {token}"}).json()
        if calls and calls[0]["ended_at"]:
            break
        time.sleep(0.05)
    assert len(calls) == 1
    assert calls[0]["platform"] == "whatsapp-web" and calls[0]["peer_name"] == "Camille"
    assert calls[0]["utterances"] == 1 and calls[0]["ended_at"] is not None


def test_stream_stops_when_minutes_run_out(client):
    from app.models import User

    token = signup(client)
    db = client.app.state.db.SessionLocal()
    user = db.query(User).first()
    user.seconds_used = 15 * 60 - 1  # one second left on the free plan
    db.commit()
    db.close()
    with client.websocket_connect(f"/ws/translate?src=hi&tgt=fr&token={token}") as ws:
        assert ws.receive_json()["minutes_left"] > 0
        speak(ws, tone(2.0), silence(0.6))
        err, _ = read_until(ws, "error")
        assert err["code"] == "quota_exceeded"

    # A new stream is refused straight away.
    with client.websocket_connect(f"/ws/translate?src=hi&tgt=fr&token={token}") as ws:
        assert ws.receive_json()["minutes_left"] == 0
        assert ws.receive_json()["code"] == "quota_exceeded"


def test_status_counts_sentences_in_translation(client):
    with client.websocket_connect("/ws/translate?src=hi&tgt=fr") as ws:
        ws.receive_json()
        speak(ws, tone(1.0), silence(0.6))
        busy, _ = read_until(ws, "status")
        assert busy["pending"] == 1
        _, seen = read_until(ws, "result")
        done, _ = read_until(ws, "status")
        assert done["pending"] == 0


def test_no_speech_notice_when_nothing_is_recognised(client):
    from app.engines.base import ASRResult

    client.app.state.pipeline.engines.asr.transcribe = lambda audio, language=None: ASRResult(text="", language=language)
    with client.websocket_connect("/ws/translate?src=hi&tgt=fr") as ws:
        ws.receive_json()
        speak(ws, tone(1.0), silence(0.6))
        notice, _ = read_until(ws, "notice")
        assert notice["code"] == "no_speech"
        done, _ = read_until(ws, "status")
        assert done["pending"] == 0
