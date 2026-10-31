from __future__ import annotations

import base64
import hashlib
import hmac
import os
from datetime import datetime, timedelta, timezone

import jwt

ALGORITHM = "HS256"

# scrypt from the Python standard library: memory-hard, no extra dependency.
_N, _R, _P = 2**14, 8, 1


def hash_password(password: str) -> str:
    salt = os.urandom(16)
    digest = hashlib.scrypt(password.encode("utf-8"), salt=salt, n=_N, r=_R, p=_P, dklen=32)
    return "scrypt${}${}${}${}${}".format(
        _N, _R, _P, base64.b64encode(salt).decode(), base64.b64encode(digest).decode()
    )


def verify_password(password: str, password_hash: str) -> bool:
    try:
        scheme, n, r, p, salt_b64, digest_b64 = password_hash.split("$")
        if scheme != "scrypt":
            return False
        salt, expected = base64.b64decode(salt_b64), base64.b64decode(digest_b64)
        digest = hashlib.scrypt(
            password.encode("utf-8"), salt=salt, n=int(n), r=int(r), p=int(p), dklen=len(expected)
        )
        return hmac.compare_digest(digest, expected)
    except (ValueError, TypeError):
        return False


def create_token(user_id: int, secret: str, days: int = 30) -> str:
    now = datetime.now(timezone.utc)
    payload = {"sub": str(user_id), "iat": now, "exp": now + timedelta(days=days)}
    return jwt.encode(payload, secret, algorithm=ALGORITHM)


def read_token(token: str, secret: str) -> int | None:
    try:
        payload = jwt.decode(token, secret, algorithms=[ALGORITHM])
        return int(payload["sub"])
    except (jwt.PyJWTError, KeyError, ValueError):
        return None
