from __future__ import annotations

import time
import uuid
from typing import Optional

from sqlalchemy import ForeignKey, Index, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from emw_backend.db import Base


def _now_epoch() -> int:
    return int(time.time())


class User(Base):
    __tablename__ = "users"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    firebase_uid: Mapped[str] = mapped_column(String(128), unique=True, index=True)

    email: Mapped[Optional[str]] = mapped_column(String(256), nullable=True)
    display_name: Mapped[Optional[str]] = mapped_column(String(256), nullable=True)

    created_at: Mapped[int] = mapped_column(Integer, default=_now_epoch)
    last_seen_at: Mapped[int] = mapped_column(Integer, default=_now_epoch)

    files: Mapped[list["UserFile"]] = relationship(back_populates="user")


class UserFile(Base):
    __tablename__ = "files"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    user_id: Mapped[str] = mapped_column(String(36), ForeignKey("users.id"), index=True)

    kind: Mapped[str] = mapped_column(String(32), index=True)
    name: Mapped[str] = mapped_column(String(512), index=True)
    extension: Mapped[str] = mapped_column(String(32), default="")
    content_type: Mapped[Optional[str]] = mapped_column(String(128), nullable=True)

    # Storage
    storage_provider: Mapped[str] = mapped_column(String(32), default="azure_blob")
    blob_container: Mapped[str] = mapped_column(String(128), default="")
    blob_key: Mapped[str] = mapped_column(String(768), default="")

    # Legacy (kept for compatibility; new flows store content in Azure Blob only)
    content_text: Mapped[Optional[str]] = mapped_column(Text, nullable=True)

    size_bytes: Mapped[int] = mapped_column(Integer, default=0)

    etag: Mapped[str] = mapped_column(String(64), default=lambda: str(_now_epoch()))
    created_at: Mapped[int] = mapped_column(Integer, default=_now_epoch)
    updated_at: Mapped[int] = mapped_column(Integer, default=_now_epoch)

    user: Mapped[User] = relationship(back_populates="files")


Index("idx_files_user_kind_name", UserFile.user_id, UserFile.kind, UserFile.name, unique=True)
