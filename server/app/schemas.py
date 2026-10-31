from __future__ import annotations

import re
from datetime import datetime
from typing import Annotated, Literal

from pydantic import AfterValidator, BaseModel, ConfigDict, Field

Product = Literal["translate", "learn", "chat"]

_EMAIL = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]{2,}$")


def _email(value: str) -> str:
    value = value.strip().lower()
    if len(value) > 254 or not _EMAIL.match(value):
        raise ValueError("Please enter a valid email address")
    return value


EmailStr = Annotated[str, AfterValidator(_email)]


class SignupIn(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    email: EmailStr
    password: str = Field(min_length=8, max_length=200)
    speaks: str = "hi"
    region: Literal["IN", "INTL"] = "IN"
    product: Product = "translate"


class LoginIn(BaseModel):
    email: EmailStr
    password: str


class TokenOut(BaseModel):
    token: str
    user: "UserOut"


class UserOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    email: str
    name: str
    speaks: str
    voice_gender: str
    use_my_voice: bool
    plan: str
    region: str


class UserUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=120)
    speaks: str | None = None
    voice_gender: Literal["female", "male"] | None = None
    use_my_voice: bool | None = None
    region: Literal["IN", "INTL"] | None = None


class PlanIn(BaseModel):
    plan: Literal["free", "basic", "pro"]


class ContactIn(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    language: str
    note: str = Field(default="", max_length=255)


class ContactUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=120)
    language: str | None = None
    note: str | None = Field(default=None, max_length=255)


class ContactOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    name: str
    language: str
    note: str
    created_at: datetime


class CallOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    platform: str
    peer_name: str
    direction: str
    src_lang: str
    tgt_lang: str
    seconds_processed: float
    utterances: int
    started_at: datetime
    ended_at: datetime | None


class VoiceOut(BaseModel):
    has_voice: bool
    seconds: float = 0.0
    status: str = "none"
    cloning_available: bool = False
    created_at: datetime | None = None


class WaitlistIn(BaseModel):
    email: EmailStr
    product: Literal["learn", "chat"]


TokenOut.model_rebuild()
