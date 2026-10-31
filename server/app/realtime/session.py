"""One live translation stream over a WebSocket.

Protocol (see docs/API.md):
  client -> server  binary: PCM 16-bit little-endian, mono, 16 kHz, any chunk size
  client -> server  text:   {"type": "config"|"flush"|"ping", ...}
  server -> client  text:   {"type": "ready"|"vad"|"status"|"result"|"audio"|"usage"|"notice"|"error"|"pong", ...}
  server -> client  binary: PCM 16-bit audio, always right after an {"type": "audio"} header
"""
from __future__ import annotations

import asyncio
import json
import logging
import uuid
from dataclasses import dataclass, field
from datetime import datetime, timezone

import numpy as np
from fastapi import WebSocket, WebSocketDisconnect

from ..audio import duration_s, float_to_pcm16, pcm16_to_float
from ..config import Settings
from ..db import Database
from ..languages import get_language
from ..models import CallSession
from ..pipeline import TranslationPipeline, UtteranceResult, VoiceOptions
from ..usage import add_seconds
from .segmenter import UtteranceSegmenter

log = logging.getLogger(__name__)

MAX_BACKLOG = 4  # utterances waiting; older ones are dropped to stay live


@dataclass
class StreamOptions:
    src: str
    tgt: str
    direction: str = "out"  # out = my voice to them, in = their voice to me
    speak: bool = True
    use_my_voice: bool = False
    announce: bool = False
    gender: str = "female"
    platform: str = "web"
    peer: str = ""
    glossary: dict[str, str] = field(default_factory=dict)


class TranslationSession:
    def __init__(
        self,
        ws: WebSocket,
        pipeline: TranslationPipeline,
        db: Database,
        settings: Settings,
        options: StreamOptions,
        user_id: int | None,
        minutes_left: float | None,
        clone_profile: str | None,
    ) -> None:
        self.ws = ws
        self.pipeline = pipeline
        self.db = db
        self.settings = settings
        self.opts = options
        self.user_id = user_id
        self.minutes_left = minutes_left
        self.clone_profile = clone_profile
        self.id = uuid.uuid4().hex[:12]
        self.segmenter = UtteranceSegmenter(
            end_silence_ms=settings.vad_end_silence_ms,
            max_utterance_s=settings.vad_max_utterance_s,
            threshold_db=settings.vad_threshold_db,
        )
        self.queue: asyncio.Queue[np.ndarray | None] = asyncio.Queue()
        self.send_lock = asyncio.Lock()
        self.seconds = 0.0
        self.utterances = 0
        self.call_id: int | None = None
        self.started_at = datetime.now(timezone.utc)
        self.stopped = False
        self._was_speaking = False
        self._counter = 0
        self.pending = 0  # sentences waiting for or in translation

    # ---------- sending ----------
    async def send_json(self, payload: dict) -> None:
        async with self.send_lock:
            await self.ws.send_text(json.dumps(payload, ensure_ascii=False))

    async def send_result(self, result: UtteranceResult, kind: str = "result") -> None:
        self._counter += 1
        rid = self._counter
        payload = {
            "type": kind,
            "id": rid,
            "direction": self.opts.direction,
            "source_text": result.source_text,
            "translated_text": result.translated_text,
            "src": result.src,
            "tgt": result.tgt,
            "voice_cloned": result.voice_cloned,
            "timings_ms": result.timings_ms,
            "has_audio": result.audio is not None and len(result.audio) > 0,
        }
        async with self.send_lock:
            await self.ws.send_text(json.dumps(payload, ensure_ascii=False))
            if payload["has_audio"]:
                pcm = float_to_pcm16(result.audio)
                header = {"type": "audio", "id": rid, "sample_rate": result.sample_rate, "format": "pcm16", "bytes": len(pcm)}
                await self.ws.send_text(json.dumps(header))
                await self.ws.send_bytes(pcm)

    # ---------- main loop ----------
    async def run(self) -> None:
        tgt_voice = self.opts.speak and self.pipeline.can_speak(self.opts.tgt)
        await self.send_json(
            {
                "type": "ready",
                "session": self.id,
                "direction": self.opts.direction,
                "src": self.opts.src,
                "tgt": self.opts.tgt,
                "speech": tgt_voice,
                "voice_clone": bool(self.clone_profile),
                "engines": self.pipeline.engines.describe(),
                "minutes_left": self.minutes_left,
                "input": {"format": "pcm16", "sample_rate": 16000, "channels": 1},
            }
        )
        if self.minutes_left is not None and self.minutes_left <= 0:
            await self.send_json({"type": "error", "code": "quota_exceeded", "message": "No minutes left this month."})
            await self.ws.close(code=4402)
            return

        worker = asyncio.create_task(self._worker())
        try:
            while not self.stopped:
                message = await self.ws.receive()
                if message["type"] == "websocket.disconnect":
                    break
                if message.get("bytes") is not None:
                    await self._on_audio(message["bytes"])
                elif message.get("text") is not None:
                    await self._on_text(message["text"])
        except WebSocketDisconnect:
            pass
        except RuntimeError as exc:  # socket already closed
            log.debug("Session %s receive ended: %s", self.id, exc)
        finally:
            self.stopped = True
            log.info("Session %s closed after %d sentences (%d still pending)", self.id, self.utterances, max(0, self.pending))
            # Close the call record first (a quick write), so it is saved even
            # if the server cancels this task while shutting down.
            try:
                self._save_call(True)
            except Exception:
                log.exception("Could not save call %s", self.id)
            await self.queue.put(None)
            try:
                await asyncio.wait_for(worker, timeout=30)
            except (asyncio.TimeoutError, Exception):
                worker.cancel()
            # Update the totals with any sentence that finished after hang-up.
            await asyncio.get_running_loop().run_in_executor(None, self._save_call, True)

    async def _on_audio(self, data: bytes) -> None:
        samples = pcm16_to_float(data)
        for utterance in self.segmenter.push(samples):
            await self._enqueue(utterance)
        speaking = self.segmenter.in_speech
        if speaking != self._was_speaking:
            self._was_speaking = speaking
            await self.send_json({"type": "vad", "speaking": speaking, "direction": self.opts.direction})

    async def _enqueue(self, utterance: np.ndarray) -> None:
        if self.queue.qsize() >= MAX_BACKLOG:
            try:
                self.queue.get_nowait()
                self.pending -= 1
                await self.send_json({"type": "notice", "code": "dropped", "message": "Skipped an older sentence to stay live."})
            except asyncio.QueueEmpty:
                pass
        await self.queue.put(utterance)
        self.pending += 1
        await self._send_status()

    async def _send_status(self) -> None:
        """Tell the client how many sentences are still being translated."""
        await self._safe(self.send_json({"type": "status", "pending": max(0, self.pending), "direction": self.opts.direction}))

    async def _on_text(self, text: str) -> None:
        try:
            msg = json.loads(text)
        except json.JSONDecodeError:
            return
        kind = msg.get("type")
        if kind == "ping":
            await self.send_json({"type": "pong"})
        elif kind == "flush":
            for utterance in self.segmenter.flush():
                await self._enqueue(utterance)
        elif kind == "config":
            src, tgt = get_language(msg.get("src")), get_language(msg.get("tgt"))
            if src:
                self.opts.src = src.code
            if tgt:
                self.opts.tgt = tgt.code
            if "speak" in msg:
                self.opts.speak = bool(msg["speak"])
            await self.send_json({"type": "config", "src": self.opts.src, "tgt": self.opts.tgt, "speech": self.opts.speak and self.pipeline.can_speak(self.opts.tgt)})
        elif kind == "stop":
            self.stopped = True
            await self.ws.close()

    async def _worker(self) -> None:
        loop = asyncio.get_running_loop()
        voice = VoiceOptions(
            speak=self.opts.speak,
            gender=self.opts.gender,
            clone_profile=self.clone_profile if self.opts.use_my_voice else None,
        )
        if self.opts.announce and self.opts.direction == "out":
            lang = get_language(self.opts.tgt)
            if lang:
                notice = await loop.run_in_executor(None, self.pipeline.speak_text, lang.announce, lang.code, VoiceOptions(gender=self.opts.gender))
                if notice:
                    await self._safe(self.send_result(notice, kind="announcement"))

        while True:
            utterance = await self.queue.get()
            if utterance is None:
                break
            try:
                result = await loop.run_in_executor(
                    None, self.pipeline.process, utterance, self.opts.src, self.opts.tgt, voice, self.opts.glossary or None
                )
            except Exception as exc:
                log.exception("Pipeline failed")
                self.pending -= 1
                await self._safe(self.send_json({"type": "error", "code": "pipeline", "message": str(exc)[:200]}))
                await self._send_status()
                continue

            self.pending -= 1
            seconds = duration_s(utterance, 16000)
            self.seconds += seconds
            if result is None:
                log.info("Session %s: no words recognised in %.1fs of audio", self.id, seconds)
                await self._safe(
                    self.send_json({"type": "notice", "code": "no_speech", "message": "Didn't catch any words. Try again, a little louder and closer to the mic."})
                )
                await self._send_status()
                continue
            self.utterances += 1
            log.info("Session %s: sentence done %s", self.id, result.timings_ms)
            await self._safe(self.send_result(result))
            await self._send_status()

            if self.user_id is not None:
                left = await loop.run_in_executor(None, self._account, seconds)
                self.minutes_left = left
                await self._safe(self.send_json({"type": "usage", "minutes_left": left}))
                if left <= 0:
                    await self._safe(self.send_json({"type": "error", "code": "quota_exceeded", "message": "No minutes left this month."}))
                    self.stopped = True
                    await self._safe(self.ws.close(code=4402))
                    break

    async def _safe(self, coro) -> None:
        try:
            await coro
        except Exception as exc:  # client went away mid-send
            log.debug("Send failed: %s", exc)

    # ---------- persistence (runs in a thread) ----------
    def _account(self, seconds: float) -> float:
        with self.db.SessionLocal() as db:
            left = add_seconds(db, self.user_id, seconds)
        self._save_call(False)
        return left

    def _save_call(self, ended: bool) -> None:
        if self.user_id is None or self.utterances == 0:
            return
        with self.db.SessionLocal() as db:
            call = db.get(CallSession, self.call_id) if self.call_id else None
            if call is None:
                call = CallSession(
                    user_id=self.user_id,
                    platform=self.opts.platform[:40],
                    peer_name=self.opts.peer[:120],
                    direction=self.opts.direction,
                    src_lang=self.opts.src,
                    tgt_lang=self.opts.tgt,
                    started_at=self.started_at,
                )
                db.add(call)
            call.seconds_processed = round(self.seconds, 2)
            call.utterances = self.utterances
            if ended:
                call.ended_at = datetime.now(timezone.utc)
            db.commit()
            self.call_id = call.id
