from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from ..config import Settings
from ..deps import get_db, get_settings
from ..languages import get_language
from ..models import User, WaitlistEntry
from ..schemas import LoginIn, SignupIn, TokenOut, UserOut
from ..security import create_token, hash_password, verify_password

router = APIRouter(prefix="/api/auth", tags=["auth"])


@router.post("/signup", response_model=TokenOut, status_code=201)
def signup(body: SignupIn, db: Session = Depends(get_db), settings: Settings = Depends(get_settings)) -> TokenOut:
    email = body.email.lower()
    if db.scalar(select(User).where(func.lower(User.email) == email)):
        raise HTTPException(status.HTTP_409_CONFLICT, "An account with this email already exists. Please log in.")
    speaks = get_language(body.speaks)
    user = User(
        email=email,
        name=body.name.strip(),
        password_hash=hash_password(body.password),
        speaks=speaks.code if speaks else "hi",
        region=body.region,
    )
    db.add(user)
    if body.product in ("learn", "chat"):
        db.add(WaitlistEntry(email=email, product=body.product))
    db.commit()
    db.refresh(user)
    return TokenOut(token=create_token(user.id, settings.secret_key, settings.jwt_days), user=UserOut.model_validate(user))


@router.post("/login", response_model=TokenOut)
def login(body: LoginIn, db: Session = Depends(get_db), settings: Settings = Depends(get_settings)) -> TokenOut:
    user = db.scalar(select(User).where(func.lower(User.email) == body.email.lower()))
    if user is None or not verify_password(body.password, user.password_hash):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Wrong email or password.")
    return TokenOut(token=create_token(user.id, settings.secret_key, settings.jwt_days), user=UserOut.model_validate(user))
