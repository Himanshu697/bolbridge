"""The logged-in user: profile, usage, plan, contacts, call history, waitlist."""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Response, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..config import Settings
from ..deps import get_current_user, get_db, get_settings
from ..languages import get_language
from ..models import CallSession, Contact, User, WaitlistEntry
from ..schemas import (
    CallOut,
    ContactIn,
    ContactOut,
    ContactUpdate,
    PlanIn,
    UserOut,
    UserUpdate,
    WaitlistIn,
)
from ..usage import usage_summary

router = APIRouter(prefix="/api", tags=["account"])


def _check_lang(code: str) -> str:
    lang = get_language(code)
    if lang is None:
        raise HTTPException(422, f"Unsupported language: {code}")
    return lang.code


@router.get("/me", response_model=UserOut)
def me(user: User = Depends(get_current_user)) -> User:
    return user


@router.patch("/me", response_model=UserOut)
def update_me(body: UserUpdate, user: User = Depends(get_current_user), db: Session = Depends(get_db)) -> User:
    data = body.model_dump(exclude_unset=True)
    if "speaks" in data and data["speaks"] is not None:
        data["speaks"] = _check_lang(data["speaks"])
    for key, value in data.items():
        if value is not None:
            setattr(user, key, value)
    db.commit()
    return user


@router.get("/usage")
def usage(user: User = Depends(get_current_user), db: Session = Depends(get_db)) -> dict:
    summary = usage_summary(user)
    db.commit()
    return summary


@router.post("/me/plan", response_model=UserOut)
def change_plan(
    body: PlanIn,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
    settings: Settings = Depends(get_settings),
) -> User:
    """Dev-only plan switch. Real payments (Razorpay/Stripe) come later."""
    if not settings.dev_mode:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Plan changes go through checkout.")
    user.plan = body.plan
    db.commit()
    return user


# ---------- contacts ----------
@router.get("/contacts", response_model=list[ContactOut])
def list_contacts(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    return db.scalars(select(Contact).where(Contact.user_id == user.id).order_by(Contact.name)).all()


@router.post("/contacts", response_model=ContactOut, status_code=201)
def add_contact(body: ContactIn, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    contact = Contact(user_id=user.id, name=body.name.strip(), language=_check_lang(body.language), note=body.note)
    db.add(contact)
    db.commit()
    db.refresh(contact)
    return contact


def _own_contact(db: Session, user: User, contact_id: int) -> Contact:
    contact = db.get(Contact, contact_id)
    if contact is None or contact.user_id != user.id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Contact not found")
    return contact


@router.patch("/contacts/{contact_id}", response_model=ContactOut)
def update_contact(contact_id: int, body: ContactUpdate, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    contact = _own_contact(db, user, contact_id)
    data = body.model_dump(exclude_unset=True)
    if data.get("language"):
        data["language"] = _check_lang(data["language"])
    for key, value in data.items():
        if value is not None:
            setattr(contact, key, value)
    db.commit()
    return contact


@router.delete("/contacts/{contact_id}", status_code=204)
def delete_contact(contact_id: int, user: User = Depends(get_current_user), db: Session = Depends(get_db)) -> Response:
    db.delete(_own_contact(db, user, contact_id))
    db.commit()
    return Response(status_code=204)


# ---------- call history ----------
@router.get("/calls", response_model=list[CallOut])
def list_calls(limit: int = 20, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    limit = max(1, min(limit, 100))
    stmt = (
        select(CallSession)
        .where(CallSession.user_id == user.id)
        .order_by(CallSession.started_at.desc())
        .limit(limit)
    )
    return db.scalars(stmt).all()


# ---------- waitlist (AI tutor, video chat) ----------
@router.post("/waitlist", status_code=201)
def join_waitlist(body: WaitlistIn, db: Session = Depends(get_db)) -> dict:
    email = body.email.lower()
    exists = db.scalar(
        select(WaitlistEntry).where(WaitlistEntry.email == email, WaitlistEntry.product == body.product)
    )
    if exists is None:
        db.add(WaitlistEntry(email=email, product=body.product))
        db.commit()
    return {"ok": True}
