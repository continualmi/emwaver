from __future__ import annotations

from sqlalchemy import create_engine
from sqlalchemy.orm import DeclarativeBase, sessionmaker


class Base(DeclarativeBase):
    pass


_ENGINE = None
SessionLocal = sessionmaker(autocommit=False, autoflush=False)


def init_db(database_url: str) -> None:
    global _ENGINE
    if _ENGINE is not None:
        return

    connect_args = {}
    if database_url.startswith("sqlite:"):
        connect_args = {"check_same_thread": False}

    _ENGINE = create_engine(database_url, pool_pre_ping=True, connect_args=connect_args)
    SessionLocal.configure(bind=_ENGINE)

    # Ensure tables exist for now (we can move to Alembic later).
    from emw_backend import models  # noqa: F401

    Base.metadata.create_all(bind=_ENGINE)


def db_session():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
