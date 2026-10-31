"""Minutes metering: how much of the monthly allowance a user has left."""
from __future__ import annotations

from datetime import date

from sqlalchemy.orm import Session

from .models import User


def _roll_period(user: User) -> None:
    month_start = date.today().replace(day=1)
    if user.period_start is None or user.period_start < month_start:
        user.period_start = month_start
        user.seconds_used = 0.0


def minutes_left(user: User) -> float:
    _roll_period(user)
    left = user.minutes_quota - (user.seconds_used or 0.0) / 60.0
    return round(max(0.0, left), 2)


def add_seconds(db: Session, user_id: int, seconds: float) -> float:
    """Record processed audio and return the minutes left."""
    user = db.get(User, user_id)
    if user is None:
        return 0.0
    _roll_period(user)
    user.seconds_used = (user.seconds_used or 0.0) + max(0.0, seconds)
    db.commit()
    return minutes_left(user)


def usage_summary(user: User) -> dict:
    left = minutes_left(user)
    return {
        "plan": user.plan,
        "minutes_quota": user.minutes_quota,
        "minutes_used": round((user.seconds_used or 0.0) / 60.0, 1),
        "minutes_left": left,
        "period_start": user.period_start.isoformat(),
    }
