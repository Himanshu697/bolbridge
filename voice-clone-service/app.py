"""BolBridge voice-clone service (optional).

Turns the stock TTS voice into the user's own voice with OpenVoice V2
(MIT licence, MyShell.ai). Every output carries OpenVoice's audio watermark,
so cloned speech can be identified later.

Runs separately from the main server because OpenVoice pins old library
versions. Start it with:
    uvicorn app:app --port 8100
"""
from __future__ import annotations

import io
import logging
import os
import re
import tempfile
import threading
from pathlib import Path

import soundfile as sf
import torch
from fastapi import FastAPI, File, Form, HTTPException, Response, UploadFile

from openvoice import se_extractor
from openvoice.api import ToneColorConverter

logging.basicConfig(level=logging.INFO)
log = logging.getLogger("voice-clone")

HERE = Path(__file__).resolve().parent
CKPT = Path(os.environ.get("OPENVOICE_CHECKPOINTS", HERE / "checkpoints_v2"))
STORE = Path(os.environ.get("VOICE_STORE", HERE / "store"))
PROFILES = STORE / "profiles"
SOURCES = STORE / "sources"
for folder in (PROFILES, SOURCES):
    folder.mkdir(parents=True, exist_ok=True)

DEVICE = "cuda:0" if torch.cuda.is_available() else "cpu"
WATERMARK = os.environ.get("WATERMARK_MESSAGE", "@BolBridge")
SAFE_ID = re.compile(r"^[A-Za-z0-9_.-]{1,64}$")

converter = ToneColorConverter(str(CKPT / "converter" / "config.json"), device=DEVICE)
converter.load_ckpt(str(CKPT / "converter" / "checkpoint.pth"))
lock = threading.Lock()
app = FastAPI(title="BolBridge voice clone")


def _check_id(value: str) -> str:
    if not SAFE_ID.match(value):
        raise HTTPException(400, "Bad id")
    return value


def _extract_se(wav_bytes: bytes, work: Path) -> torch.Tensor:
    path = work / "ref.wav"
    path.write_bytes(wav_bytes)
    se, _ = se_extractor.get_se(str(path), converter, target_dir=str(work / "processed"), vad=True)
    return se


def _source_se(source_voice: str, wav_bytes: bytes, work: Path) -> torch.Tensor:
    """Tone embedding of the stock TTS voice; computed once, then cached."""
    cached = SOURCES / f"{source_voice}.pth"
    if cached.exists():
        return torch.load(cached, map_location=DEVICE)
    try:
        se = _extract_se(wav_bytes, work)
        torch.save(se, cached)
        return se
    except Exception as exc:  # too short to analyse: fall back to a base speaker
        log.warning("Could not analyse source voice %s yet (%s), using base speaker", source_voice, exc)
        return torch.load(CKPT / "base_speakers" / "ses" / "en-default.pth", map_location=DEVICE)


@app.get("/health")
def health() -> dict:
    return {"ok": True, "device": DEVICE}


@app.get("/profiles/{profile_id}")
def has_profile(profile_id: str) -> dict:
    if not (PROFILES / f"{_check_id(profile_id)}.pth").exists():
        raise HTTPException(404, "No profile")
    return {"ok": True}


@app.post("/profiles/{profile_id}")
async def save_profile(profile_id: str, file: UploadFile = File(...)) -> dict:
    _check_id(profile_id)
    data = await file.read()
    with tempfile.TemporaryDirectory() as tmp, lock:
        try:
            se = _extract_se(data, Path(tmp))
        except Exception as exc:
            raise HTTPException(422, f"Could not learn this voice: {exc}")
    torch.save(se, PROFILES / f"{profile_id}.pth")
    return {"ok": True}


@app.delete("/profiles/{profile_id}")
def delete_profile(profile_id: str) -> dict:
    (PROFILES / f"{_check_id(profile_id)}.pth").unlink(missing_ok=True)
    return {"ok": True}


@app.post("/sources/{source_voice}")
async def warm_source(source_voice: str, file: UploadFile = File(...)) -> dict:
    """Optional: send ~10 s of a stock voice once, for a better source embedding."""
    _check_id(source_voice)
    data = await file.read()
    with tempfile.TemporaryDirectory() as tmp, lock:
        se = _extract_se(data, Path(tmp))
    torch.save(se, SOURCES / f"{source_voice}.pth")
    return {"ok": True}


@app.post("/convert")
async def convert(profile_id: str = Form(...), source_voice: str = Form(...), file: UploadFile = File(...)) -> Response:
    _check_id(profile_id)
    _check_id(source_voice)
    target = PROFILES / f"{profile_id}.pth"
    if not target.exists():
        raise HTTPException(404, "No voice profile for this user")
    data = await file.read()
    with tempfile.TemporaryDirectory() as tmp, lock:
        work = Path(tmp)
        src_path = work / "tts.wav"
        src_path.write_bytes(data)
        tgt_se = torch.load(target, map_location=DEVICE)
        src_se = _source_se(source_voice, data, work)
        audio = converter.convert(audio_src_path=str(src_path), src_se=src_se, tgt_se=tgt_se, message=WATERMARK)
    buf = io.BytesIO()
    sf.write(buf, audio, converter.hps.data.sampling_rate, format="WAV", subtype="PCM_16")
    return Response(buf.getvalue(), media_type="audio/wav")
