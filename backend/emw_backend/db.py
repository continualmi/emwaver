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

            # Add inline file bytes column for Postgres-backed storage migration.
            if "content" not in ucols:
                with _ENGINE.begin() as conn:
                    conn.execute(text("ALTER TABLE user_files ADD COLUMN content BLOB" if getattr(dialect, "name", "") == "sqlite" else "ALTER TABLE user_files ADD COLUMN content BYTEA"))

        # Society: add columns when running against an existing DB (create_all won't ALTER).
        if insp.has_table("society_posts"):
            cols = {c["name"] for c in insp.get_columns("society_posts")}
            with _ENGINE.begin() as conn:
                if "pro_only" not in cols:
                    conn.execute(text("ALTER TABLE society_posts ADD COLUMN pro_only INTEGER DEFAULT 0"))
                if "media_blob_key" not in cols:
                    conn.execute(text("ALTER TABLE society_posts ADD COLUMN media_blob_key VARCHAR(768) DEFAULT ''"))
                if "media_poster_blob_key" not in cols:
                    conn.execute(text("ALTER TABLE society_posts ADD COLUMN media_poster_blob_key VARCHAR(768) DEFAULT ''"))
                if "media_duration_s" not in cols:
                    conn.execute(text("ALTER TABLE society_posts ADD COLUMN media_duration_s INTEGER DEFAULT 0"))

        # Agent conversations: add agent_type for dual-mode identity if missing.
        if insp.has_table("agent_conversations"):
            cols = {c["name"] for c in insp.get_columns("agent_conversations")}
            if "agent_type" not in cols:
                with _ENGINE.begin() as conn:
                    conn.execute(text("ALTER TABLE agent_conversations ADD COLUMN agent_type VARCHAR(16) DEFAULT 'llm'"))

    except Exception:
        # Best-effort: if this fails (permissions/older DB), backend will still run.
        pass


def db_session():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
