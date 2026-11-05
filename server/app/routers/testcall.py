"""Help for the "Test the extension" page: a spoken test sentence in any voice language.

The page plays it as the pretend other person, so a user can check both
directions of the extension without calling anyone.
"""
from __future__ import annotations

import threading
from urllib.parse import quote

from fastapi import APIRouter, Depends, HTTPException, Request, Response

from ..audio import to_wav_bytes
from ..deps import get_current_user
from ..languages import get_language
from ..models import User

router = APIRouter(prefix="/api", tags=["test"])

TEST_SENTENCES = {
    "en": "Hello! Can you hear me clearly? I'm calling to check if the translation works.",
    "hi": "नमस्ते! क्या आप मुझे साफ़ सुन पा रहे हैं? मैं देख रहा हूँ कि अनुवाद ठीक से काम करता है या नहीं।",
    "fr": "Bonjour ! Est-ce que vous m'entendez bien ? J'appelle pour vérifier que la traduction fonctionne.",
    "es": "¡Hola! ¿Me oyes bien? Te llamo para comprobar que la traducción funciona.",
    "it": "Ciao! Mi senti bene? Ti chiamo per controllare che la traduzione funzioni.",
    "pt": "Olá! Você está me ouvindo bem? Estou ligando para ver se a tradução funciona.",
    "ja": "もしもし、聞こえますか？翻訳がちゃんと動くか確認しています。",
    "zh": "你好！你能听清楚我说话吗？我在测试翻译是否正常。",
}

_cache: dict[str, bytes] = {}
_lock = threading.Lock()


@router.get("/test-speech")
def test_speech(request: Request, lang: str = "en", _: User = Depends(get_current_user)) -> Response:
    language = get_language(lang)
    if language is None or lang not in TEST_SENTENCES:
        raise HTTPException(422, f"No test sentence for {lang}")
    pipeline = request.app.state.pipeline
    if not pipeline.can_speak(lang):
        raise HTTPException(422, f"No voice for {language.name} yet")
    with _lock:
        wav = _cache.get(lang)
        if wav is None:
            result = pipeline.speak_text(TEST_SENTENCES[lang], lang)
            if result is None or result.audio is None:
                raise HTTPException(503, "Could not make the test sentence")
            wav = to_wav_bytes(result.audio, result.sample_rate)
            _cache[lang] = wav
    return Response(
        content=wav,
        media_type="audio/wav",
        headers={"Cache-Control": "private, max-age=3600", "X-Test-Sentence": quote(TEST_SENTENCES[lang])},
    )
