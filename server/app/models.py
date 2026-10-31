from __future__ import annotations

from datetime import date, datetime, timezone

from sqlalchemy import Boolean, Date, DateTime, Float, ForeignKey, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from .db import Base


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


PLAN_MINUTES = {"free": 15, "basic": 100, "pro": 300}


class User(Base):
    __tablename__ = "users"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    email: Mapped[str] = mapped_column(String(255), unique=True, index=True)
    name: Mapped[str] = mapped_column(String(120))
    password_hash: Mapped[str] = mapped_column(String(255))
    speaks: Mapped[str] = mapped_column(String(8), default="hi")
    voice_gender: Mapped[str] = mapped_column(String(8), default="female")
    use_my_voice: Mapped[bool] = mapped_column(Boolean, default=True)
    plan: Mapped[str] = mapped_column(String(16), default="free")
    region: Mapped[str] = mapped_column(String(8), default="IN")
    seconds_used: Mapped[float] = mapped_column(Float, default=0.0)
    period_start: Mapped[date] = mapped_column(Date, default=lambda: date.today().replace(day=1))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)

    @property
    def minutes_quota(self) -> int:
        return PLAN_MINUTES.get(self.plan, PLAN_MINUTES["free"])


class Contact(Base):
    __tablename__ = "contacts"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    name: Mapped[str] = mapped_column(String(120))
    language: Mapped[str] = mapped_column(String(8))
    note: Mapped[str] = mapped_column(String(255), default="")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class CallSession(Base):
    """One translated stream (one direction) of one call."""

    __tablename__ = "call_sessions"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    platform: Mapped[str] = mapped_column(String(40), default="web")
    peer_name: Mapped[str] = mapped_column(String(120), default="")
    direction: Mapped[str] = mapped_column(String(8), default="out")
    src_lang: Mapped[str] = mapped_column(String(8))
    tgt_lang: Mapped[str] = mapped_column(String(8))
    seconds_processed: Mapped[float] = mapped_column(Float, default=0.0)
    utterances: Mapped[int] = mapped_column(Integer, default=0)
    started_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    ended_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class VoiceProfile(Base):
    """A user's own voice sample, used for voice cloning (opt-in)."""

    __tablename__ = "voice_profiles"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), unique=True)
    file_path: Mapped[str] = mapped_column(Text)
    seconds: Mapped[float] = mapped_column(Float, default=0.0)
    status: Mapped[str] = mapped_column(String(16), default="saved")  # saved | ready | failed
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class WaitlistEntry(Base):
    __tablename__ = "waitlist"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    email: Mapped[str] = mapped_column(String(255), index=True)
    product: Mapped[str] = mapped_column(String(20))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
