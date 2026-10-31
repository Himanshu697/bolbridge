from __future__ import annotations

from collections.abc import Iterator

from sqlalchemy import create_engine
from sqlalchemy.engine import Engine
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker


class Base(DeclarativeBase):
    pass


class Database:
    """Holds the engine and session factory for one app instance."""

    def __init__(self, url: str) -> None:
        connect_args = {"check_same_thread": False} if url.startswith("sqlite") else {}
        self.engine: Engine = create_engine(url, connect_args=connect_args, future=True)
        self.SessionLocal = sessionmaker(bind=self.engine, autoflush=False, expire_on_commit=False)

    def create_all(self) -> None:
        from . import models  # noqa: F401  (register tables)

        Base.metadata.create_all(self.engine)

    def session(self) -> Iterator[Session]:
        db = self.SessionLocal()
        try:
            yield db
        finally:
            db.close()
