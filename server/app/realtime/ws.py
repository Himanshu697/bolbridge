from __future__ import annotations

import logging

from fastapi import APIRouter, WebSocket

from ..languages import get_language
from ..models import User, VoiceProfile
from ..security import read_token
from ..usage import minutes_left
from .session import StreamOptions, TranslationSession

log = logging.getLogger(__name__)
router = APIRouter()


def _flag(value: str | None, default: bool = False) -> bool:
    if value is None:
        return default
    return value.lower() in {"1", "true", "yes", "on"}


@router.websocket("/ws/translate")
async def translate_stream(ws: WebSocket) -> None:
    app = ws.app
    settings = app.state.settings
    params = ws.query_params
    await ws.accept()

    src, tgt = get_language(params.get("src")), get_language(params.get("tgt"))
    if src is None or tgt is None:
        await ws.send_json({"type": "error", "code": "bad_language", "message": "Unknown src or tgt language."})
        await ws.close(code=4400)
        return

    user_id: int | None = None
    left: float | None = None
    clone_profile: str | None = None
    gender = params.get("gender") or "female"
    token = params.get("token")
    if token:
        uid = read_token(token, settings.secret_key)
        with app.state.db.SessionLocal() as db:
            user = db.get(User, uid) if uid else None
            if user is not None:
                user_id = user.id
                left = minutes_left(user)
                gender = params.get("gender") or user.voice_gender
                profile = db.query(VoiceProfile).filter(VoiceProfile.user_id == user.id).first()
                if profile is not None and profile.status == "ready":
                    clone_profile = f"user-{user.id}"
                db.commit()  # persists a monthly reset, if one happened
    if user_id is None and not settings.allow_anonymous_ws:
        await ws.send_json({"type": "error", "code": "auth", "message": "Please log in again."})
        await ws.close(code=4401)
        return

    options = StreamOptions(
        src=src.code,
        tgt=tgt.code,
        direction="in" if params.get("direction") == "in" else "out",
        speak=_flag(params.get("speak"), True),
        use_my_voice=_flag(params.get("voice"), False),
        announce=_flag(params.get("announce"), False),
        gender="male" if gender == "male" else "female",
        platform=(params.get("platform") or "web")[:40],
        peer=(params.get("peer") or "")[:120],
    )
    session = TranslationSession(
        ws,
        app.state.pipeline,
        app.state.db,
        settings,
        options,
        user_id=user_id,
        minutes_left=left,
        clone_profile=clone_profile,
    )
    log.info("Stream %s %s->%s (%s) user=%s", session.id, options.src, options.tgt, options.direction, user_id)
    await session.run()
