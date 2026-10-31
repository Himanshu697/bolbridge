"""The user's own voice sample (opt-in) for speaking translations in their voice."""
from __future__ import annotations

import asyncio
from pathlib import Path

from fastapi import APIRouter, Depends, File, HTTPException, Request, Response, UploadFile, status
from sqlalchemy.orm import Session

from ..audio import from_wav_bytes
from ..deps import get_current_user, get_db
from ..models import User, VoiceProfile
from ..schemas import VoiceOut

router = APIRouter(prefix="/api/voice", tags=["voice"])

MAX_BYTES = 8 * 1024 * 1024  # ~4 minutes of 16 kHz WAV
MIN_SECONDS = 8.0


def _out(profile: VoiceProfile | None, cloning: bool) -> VoiceOut:
    if profile is None:
        return VoiceOut(has_voice=False, cloning_available=cloning)
    return VoiceOut(
        has_voice=True,
        seconds=profile.seconds,
        status=profile.status,
        cloning_available=cloning,
        created_at=profile.created_at,
    )


@router.get("", response_model=VoiceOut)
def get_voice(request: Request, user: User = Depends(get_current_user), db: Session = Depends(get_db)) -> VoiceOut:
    profile = db.query(VoiceProfile).filter(VoiceProfile.user_id == user.id).first()
    return _out(profile, request.app.state.engines.voice.available())


@router.post("", response_model=VoiceOut)
async def upload_voice(
    request: Request,
    file: UploadFile = File(...),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> VoiceOut:
    data = await file.read()
    if len(data) > MAX_BYTES:
        raise HTTPException(413, "Recording is too long.")
    try:
        audio, rate = from_wav_bytes(data)
    except Exception:
        raise HTTPException(422, "Please upload a 16-bit WAV recording.")
    seconds = len(audio) / float(rate)
    if seconds < MIN_SECONDS:
        raise HTTPException(422, f"Please record at least {int(MIN_SECONDS)} seconds.")

    settings = request.app.state.settings
    folder = Path(settings.data_dir) / "voices"
    folder.mkdir(parents=True, exist_ok=True)
    path = folder / f"user-{user.id}.wav"
    path.write_bytes(data)

    profile = db.query(VoiceProfile).filter(VoiceProfile.user_id == user.id).first()
    if profile is None:
        profile = VoiceProfile(user_id=user.id, file_path=str(path))
        db.add(profile)
    profile.file_path = str(path)
    profile.seconds = round(seconds, 1)
    profile.status = "saved"

    voice = request.app.state.engines.voice
    if voice.available():
        ok = await asyncio.get_running_loop().run_in_executor(None, voice.save_profile, f"user-{user.id}", data)
        profile.status = "ready" if ok else "failed"
    db.commit()
    return _out(profile, voice.available())


@router.delete("", status_code=204)
def delete_voice(request: Request, user: User = Depends(get_current_user), db: Session = Depends(get_db)) -> Response:
    profile = db.query(VoiceProfile).filter(VoiceProfile.user_id == user.id).first()
    if profile is not None:
        try:
            Path(profile.file_path).unlink(missing_ok=True)
        except OSError:
            pass
        request.app.state.engines.voice.delete_profile(f"user-{user.id}")
        db.delete(profile)
        db.commit()
    return Response(status_code=204)
