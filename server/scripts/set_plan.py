"""Owner tool: put a user on a plan (free, basic, pro) and optionally reset their minutes.

On the live server use the wrapper:  sudo bash deploy/set-plan.sh you@example.com pro --reset
Locally:                            python scripts/set_plan.py you@example.com pro
"""
from __future__ import annotations

import argparse
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from dotenv import load_dotenv  # noqa: E402
from sqlalchemy import func, select  # noqa: E402

from app.config import SERVER_DIR, Settings  # noqa: E402
from app.db import Database  # noqa: E402
from app.models import PLAN_MINUTES, User  # noqa: E402


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("email")
    parser.add_argument("plan", choices=sorted(PLAN_MINUTES))
    parser.add_argument("--reset", action="store_true", help="also set minutes used this month to 0")
    args = parser.parse_args()

    load_dotenv(SERVER_DIR / ".env")
    settings = Settings.from_env()
    db = Database(settings.database_url)
    db.create_all()
    with db.SessionLocal() as session:
        user = session.scalar(select(User).where(func.lower(User.email) == args.email.lower()))
        if user is None:
            print(f"No account with email {args.email}. Sign up on the website first.")
            return 1
        user.plan = args.plan
        if args.reset:
            user.seconds_used = 0.0
        session.commit()
        used = (user.seconds_used or 0) / 60
        print(f"{user.email}: plan {user.plan}, {PLAN_MINUTES[user.plan]} minutes a month, {used:.1f} used")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
