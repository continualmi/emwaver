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

    # Lightweight migrations (no Alembic yet): best-effort schema fixes.
    try:
        from sqlalchemy import inspect, text

        insp = inspect(_ENGINE)

        # Drop legacy table if it exists.
        if insp.has_table("files"):
            with _ENGINE.begin() as conn:
                conn.execute(text("DROP TABLE files"))

        # New index table: ensure BIGINT for ms timestamps and sizes.
        if insp.has_table("user_files"):
            ucols = {c["name"]: c for c in insp.get_columns("user_files")}

            def _coltype(name: str) -> str:
                t = ucols.get(name, {}).get("type")
                return str(t).lower() if t is not None else ""

            mtime_t = _coltype("mtime_ms")
            size_t = _coltype("size_bytes")

            # PostgreSQL: migrate INTEGER -> BIGINT if needed.
            dialect = getattr(_ENGINE, "dialect", None)
            if getattr(dialect, "name", "") == "postgresql":
                with _ENGINE.begin() as conn:
                    if "integer" in mtime_t and "bigint" not in mtime_t:
                        conn.execute(text("ALTER TABLE user_files ALTER COLUMN mtime_ms TYPE BIGINT"))
                    if "integer" in size_t and "bigint" not in size_t:
                        conn.execute(text("ALTER TABLE user_files ALTER COLUMN size_bytes TYPE BIGINT"))

    except Exception:
        # Best-effort: if this fails (permissions/older DB), backend will still run.
        pass


def db_session():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
