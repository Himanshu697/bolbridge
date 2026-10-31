"""Check a live BolBridge server from the outside, the way a user's browser uses it.

Run from your laptop with the server's virtualenv (it has httpx, websockets, numpy):

    cd ~/bolbridge/server && source .venv/bin/activate
    python ../deploy/smoke_test.py https://bolbridge-yourname.duckdns.org

It signs up a throwaway test account, checks the web pages, makes sure strangers
cannot use the translator without logging in, then streams real speech both ways
(Hindi -> English and English -> Hindi) over the secure WebSocket and reports the
delay. Speech comes from Kokoro if it is installed (made in a separate process),
or pass --hi-wav / --en-wav.
"""
from __future__ import annotations

import argparse
import json
import subprocess
import sys
import tempfile
import time
import uuid
from pathlib import Path
from urllib.parse import urlencode, urlparse

import httpx
import numpy as np
from websockets.sync.client import connect

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "server"))

SENTENCES = {
    "hi": "आज मौसम बहुत अच्छा है और मैं कल दिल्ली जा रहा हूँ।",
    "en": "I am coming to Delhi tomorrow, can we meet in the evening?",
}

results: list[tuple[str, bool, str]] = []


def check(name: str, ok: bool, detail: str = "", warn_only: bool = False) -> bool:
    label = "PASS" if ok else ("WARN" if warn_only else "FAIL")
    if not warn_only or ok:
        results.append((name, ok, detail))
    print(f"[{label}] {name}{': ' + detail if detail else ''}", flush=True)
    return ok


def make_speech(folder: str) -> None:
    """Child process: let Kokoro say the test sentences into WAV files, then exit,
    so the voice model does not sit in memory next to a server on the same laptop."""
    from app.audio import to_wav_bytes
    from app.engines.kokoro_tts import KokoroTTS

    tts = KokoroTTS()
    for lang, text in SENTENCES.items():
        audio, rate = tts.synthesize(text, lang, "male")
        (Path(folder) / f"{lang}.wav").write_bytes(to_wav_bytes(audio, rate))


def speech(lang: str, wav: str | None, folder: str) -> np.ndarray | None:
    from app.audio import from_wav_bytes, resample

    path = Path(wav) if wav else Path(folder) / f"{lang}.wav"
    if not path.exists():
        print(f"(No speech for {lang}. Install Kokoro or pass --{lang}-wav to test real speech.)")
        return None
    audio, rate = from_wav_bytes(path.read_bytes())
    return resample(audio, rate, 16000)


def ws_url(base: str, **params: str) -> str:
    u = urlparse(base)
    scheme = "wss" if u.scheme == "https" else "ws"
    return f"{scheme}://{u.netloc}/ws/translate?{urlencode(params)}"


def stream(base: str, token: str, src: str, tgt: str, audio: np.ndarray) -> None:
    from app.audio import float_to_pcm16

    url = ws_url(base, src=src, tgt=tgt, direction="out", platform="smoke-test", speak="1", token=token)
    pcm = float_to_pcm16(np.concatenate([audio, np.zeros(16000, dtype=np.float32)]))
    with connect(url, open_timeout=20, max_size=None) as ws:
        ready = json.loads(ws.recv(timeout=20))
        if not check(f"{src}->{tgt} stream opens", ready.get("type") == "ready", str(ready.get("engines"))):
            return
        start = time.perf_counter()
        for i in range(0, len(pcm), 3200):  # 100 ms chunks
            ws.send(pcm[i : i + 3200])
        sent = time.perf_counter()
        ws.send(json.dumps({"type": "flush"}))
        result, audio_bytes, deadline = None, 0, time.time() + 180
        while time.time() < deadline:
            msg = ws.recv(timeout=180)
            if isinstance(msg, bytes):
                audio_bytes += len(msg)
                break
            data = json.loads(msg)
            if data["type"] == "result":
                result = data
                if not data.get("has_audio"):
                    break
            elif data["type"] == "notice" and data.get("code") == "no_speech":
                check(f"{src}->{tgt} words recognised", False, "the server heard no words")
                return
            elif data["type"] == "error":
                check(f"{src}->{tgt} translation", False, data.get("message", ""))
                return
        waited = time.perf_counter() - sent
        if not check(f"{src}->{tgt} translation comes back", result is not None, f"after {waited:.1f} s"):
            return
        print(f"      heard: {result['source_text']}\n      sent:  {result['translated_text']}\n      timings: {result['timings_ms']}")
        check(f"{src}->{tgt} translated voice comes back", audio_bytes > 0, f"{audio_bytes / 48000:.1f} s of audio")
        check(f"{src}->{tgt} delay after speaking", True, f"{waited:.1f} s (stream took {sent - start:.1f} s to send)")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("base", help="Live address, e.g. https://bolbridge-yourname.duckdns.org")
    parser.add_argument("--hi-wav", help="16-bit WAV of someone speaking Hindi")
    parser.add_argument("--en-wav", help="16-bit WAV of someone speaking English")
    parser.add_argument("--make-speech", help=argparse.SUPPRESS)
    args = parser.parse_args()
    if args.make_speech:
        make_speech(args.make_speech)
        return 0
    base = args.base.rstrip("/")
    http = httpx.Client(base_url=base, timeout=30, follow_redirects=True)

    if base.startswith("https://"):
        try:
            r = httpx.get(base.replace("https://", "http://", 1) + "/health", timeout=15, follow_redirects=False)
            where = r.headers.get("location", "")
            ok = r.status_code in (301, 302, 307, 308) and where.startswith("https://")
            note = "" if ok else " (free tunnels allow plain http too; share the https link)"
            check("HTTP redirects to HTTPS", ok, f"HTTP {r.status_code} {where}{note}", warn_only=True)
        except Exception as exc:
            check("HTTP redirects to HTTPS", False, str(exc), warn_only=True)

    try:
        health = http.get("/health").json()
    except Exception as exc:
        check("Server reachable", False, str(exc))
        return 1
    check("Server reachable", bool(health.get("ok")), f"preset {health.get('preset')}, engines {health.get('engines')}")
    check("Real models loaded", health.get("preset") != "mock", str(health.get("engines")))

    for path in ("/", "/auth", "/app/try"):
        r = http.get(path)
        check(f"Web page {path}", r.status_code == 200 and "<div id=\"root\"" in r.text, f"HTTP {r.status_code}")

    email = f"smoke-{uuid.uuid4().hex[:8]}@example.com"
    r = http.post("/api/auth/signup", json={"name": "Smoke Test", "email": email, "password": "smoke-test-1234"})
    if not check("Sign up", r.status_code == 201, f"HTTP {r.status_code} {email}"):
        return 1
    token = r.json()["token"]
    r = http.post("/api/auth/login", json={"email": email, "password": "smoke-test-1234"})
    check("Log in", r.status_code == 200, f"HTTP {r.status_code}")
    r = http.get("/api/me", headers={"Authorization": f"Bearer {token}"})
    check("Account page data", r.status_code == 200 and r.json().get("email") == email, f"HTTP {r.status_code}")
    r = http.get("/api/me", headers={"Authorization": "Bearer not-a-real-token"})
    check("Bad token refused", r.status_code == 401, f"HTTP {r.status_code}")

    with connect(ws_url(base, src="hi", tgt="en"), open_timeout=20) as ws:
        first = json.loads(ws.recv(timeout=20))
        check("Translator refuses people who are not logged in", first.get("code") == "auth", first.get("type", ""))

    with tempfile.TemporaryDirectory() as folder:
        if not (args.hi_wav and args.en_wav):
            print("(Making test speech with Kokoro in a separate process...)", flush=True)
            subprocess.run([sys.executable, __file__, base, "--make-speech", folder], capture_output=True)
        for src, tgt in (("hi", "en"), ("en", "hi")):
            audio = speech(src, args.hi_wav if src == "hi" else args.en_wav, folder)
            if audio is not None:
                try:
                    stream(base, token, src, tgt, audio)
                except Exception as exc:  # e.g. the tunnel dropped the connection
                    check(f"{src}->{tgt} stream stays connected", False, f"{type(exc).__name__}: {exc}")

    failed = [name for name, ok, _ in results if not ok]
    print(f"\n{len(results) - len(failed)} passed, {len(failed)} failed" + (f": {', '.join(failed)}" if failed else ""))
    return 1 if failed else 0


if __name__ == "__main__":
    raise SystemExit(main())
