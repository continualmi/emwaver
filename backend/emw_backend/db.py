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

    # Lightweight migrations (no Alembic yet): add missing columns.
    try:
        from sqlalchemy import inspect, text

        insp = inspect(_ENGINE)
        cols = {c["name"] for c in insp.get_columns("files")}
        if "content_sha256" not in cols:
            with _ENGINE.begin() as conn:
                conn.execute(text("ALTER TABLE files ADD COLUMN content_sha256 VARCHAR(64)"))
    except Exception:
        # Best-effort: if this fails (permissions/older DB), backend will still run;
        # the sha field will just be absent until DB is recreated.
        pass


def db_session():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
